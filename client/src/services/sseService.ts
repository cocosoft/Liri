import { getBackendBaseUrl } from "./backendUrl";
// BUG-4 修复：心跳 HEAD 复用统一鉴权头（配置 LIRI_API_SECRET 时缺头恒 401 → 保活失效）
import { buildAuthHeaders } from "./chatService";
import { getOTelTracing } from "../monitoring/otel/OTelTracing";
import { createLogger } from "../utils/logger";

const logger = createLogger("sseService");

/** 构建 W3C traceparent 查询参数 */
function buildTraceparentParam(): string {
  const span = getOTelTracing().getActiveSpan();
  if (!span) return "";
  const ctx = span.spanContext();
  if (!ctx.traceId) return "";
  return `traceparent=00-${ctx.traceId}-${ctx.spanId}-0${ctx.traceFlags}`;
}

type EventHandler = (data: Record<string, unknown>) => void;

// ── 常量 ──────────────────────────────────────────────────────────

/** 重连初始间隔（毫秒） */
const INITIAL_RECONNECT_DELAY = 1000;

/** 重连最大间隔（毫秒） */
const MAX_RECONNECT_DELAY = 30000;

/** 轮询兜底间隔（毫秒） */
const SSE_FALLBACK_POLL_INTERVAL_MS = 15000;

/**
 * U-04（2026-10-19）：链路健康判定阈值。
 *
 * 后端口每 15s 广播一次 `event: heartbeat` ⇒ 45s 未收到任何数据 = 连续错过 3 个心跳，
 * 判定为半开/假连接并强制重连（原实现只看 `streamController !== null`，恒为 true）。
 */
const CONNECTION_STALE_MS = 45000;

/** 心跳 HEAD 连续失败阈值（每 30s 一次 ⇒ 60s 内判定） */
const HEARTBEAT_FAILURE_THRESHOLD = 2;

/**
 * SSE 长连接服务
 *
 * 提供 Server-Sent Events 的连接、重连、心跳保活和轮询兜底能力。
 *
 * ## 重连策略
 * - 断开后指数退避重连：1s → 2s → 4s → ... → 30s（上限）
 * - 连接成功后重置为 1s
 *
 * ## 轮询兜底
 * - 断开时自动启动轮询（间隔 15s），通过 setPollHandler 设置回调
 * - 重连成功后自动停止轮询
 *
 * ## 可见性监听
 * - 浏览器标签页切回时，若连接断开则立即重连
 */
class SSEService {
  /** SSE 流控制器（fetch + ReadableStream，可携带鉴权头；非 null = 连接中） */
  private streamController: AbortController | null = null;

  /** 事件处理器 Map */
  private handlers = new Map<string, Set<EventHandler>>();

  /** 重连定时器 */
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /** 当前重连延迟（指数退避） */
  private reconnectDelay = INITIAL_RECONNECT_DELAY;

  /** 连续重连失败次数（达到阈值后显示 toast） */
  private reconnectFailCount = 0;

  /** 心跳保活定时器（HEAD 请求防代理超时） */
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  /** 轮询兜底定时器 */
  private pollingTimer: ReturnType<typeof setInterval> | null = null;

  /** 轮询回调（由消费者设置） */
  private pollHandler: (() => void) | null = null;

  /** 是否已绑定 visibilitychange 监听 */
  private visibilityBound = false;
  /** visibilitychange 处理器引用（保留以便移除） */
  private _onVisibilityChange: (() => void) | null = null;

  /** U-04：最近一次收到 SSE 数据（任意 chunk/事件）的时间 */
  private lastEventAt = 0;

  /** U-04：心跳 HEAD 连续失败次数 */
  private heartbeatFailures = 0;

  /**
   * U-04 残余（2026-10-19）：最近一次收到的事件 id（SSE `id:` 字段）。
   * 重连时通过 `Last-Event-ID` 头请求后端补发缺失事件（跨会话展示用）。
   */
  private lastEventId = 0;

  /** U-04：是否已绑定浏览器 online 监听 */
  private onlineBound = false;
  /** online 处理器引用（保留以便移除） */
  private _onOnline: (() => void) | null = null;

  // ── 公共 API ──────────────────────────────────────────────────

  /**
   * 建立 SSE 连接
   *
   * 加固部署专项（2026-08-30）：原实现用 EventSource——浏览器 API 无法携带自定义
   * header，配置 LIRI_API_SECRET 时 /v1/events 只能依赖后端白名单豁免。
   * 改为 fetch + ReadableStream 解析 SSE（携带 buildAuthHeaders），与普通请求
   * 同一鉴权，后端 /v1/events 白名单随之移除。
   */
  connect(): void {
    if (this.streamController) {
      logger.debug("[connect] 已有连接，跳过");
      return;
    }

    logger.info("[connect] 开始建立 SSE 连接");
    // U-04：新连接起始时刻作为“尚未收到首块”的宽限基准
    this.lastEventAt = 0;
    this.heartbeatFailures = 0;
    // 停止轮询（如果正在运行）
    this.stopPolling();

    try {
      // P1-2.16: 注入 traceparent 查询参数，实现跨进程 TraceContext 传递
      const tp = buildTraceparentParam();
      const sseUrl = `${getBackendBaseUrl()}/v1/events${tp ? `?${tp}` : ""}`;
      const controller = new AbortController();
      this.streamController = controller;
      const headers = buildAuthHeaders();
      // U-04 残余：重连时用 Last-Event-ID 请求补发断线期间的事件
      if (this.lastEventId > 0) {
        headers["Last-Event-ID"] = String(this.lastEventId);
      }
      logger.debug("[connect] 发起 SSE fetch", {
        url: sseUrl,
        hasAuth: !!headers["X-API-Key"],
        lastEventId: this.lastEventId,
      });

      fetch(sseUrl, { headers, signal: controller.signal })
        .then(async (res) => {
          if (this.streamController !== controller) return; // 已被断开
          if (!res.ok || !res.body) {
            logger.warn(`[fetch] SSE 响应异常 status=${res.status}`);
            this.handleConnectionError();
            return;
          }
          this.handleConnected();
          await this.readStream(controller, res.body);
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return; // 主动断开
          if (this.streamController !== controller) return;
          logger.warn("[fetch] SSE 连接错误", {
            error: err instanceof Error ? err.message : String(err),
          });
          this.handleConnectionError();
        });
    } catch {
      // 创建连接失败，直接进入重连
      this.scheduleReconnect();
    }

    // 绑一次可见性监听（全局、只绑一次）
    this.bindVisibilityListener();
  }

  /**
   * SSE 连接建立成功：重置重连间隔，启动心跳，停止轮询
   */
  private handleConnected(): void {
    // 连接成功：重置重连间隔，启动心跳，停止轮询
    const wasReconnecting = this.reconnectFailCount > 0;
    logger.info(`[onopen] SSE 连接成功 wasReconnecting=${wasReconnecting}`);
    this.reconnectDelay = INITIAL_RECONNECT_DELAY;
    this.reconnectFailCount = 0;
    // U-04：连接建立即视为“链路新鲜”，并清零心跳失败计数
    this.lastEventAt = Date.now();
    this.heartbeatFailures = 0;
    this.startHeartbeat();
    this.stopPolling();

    // TB-5（2026-09-23）：广播"连接已建立/重建"。
    // 用途：让原先**自建 EventSource** 的消费者（`useNotificationSSE` 靠 `EventSource.onopen`
    // 做"重连后增量补拉列表 + 刷新计数"）能复用**单一事件源** ⇒ 消除同一端点两条常驻 SSE
    // （dev 与 prod 构建产物实测均为 2），并顺带消除 `EventSource` 无法携带鉴权头的问题。
    this.dispatch("connection:open", { wasReconnecting });

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    // 如果之前曾断开过，提示连接已恢复
    if (wasReconnecting) {
      import("../stores/toastStore")
        .then(({ toastInfo }) => {
          toastInfo("实时连接已恢复");
        })
        .catch(() => {
          /* toastStore 动态加载失败，静默忽略 */
        });
    }
  }

  /**
   * SSE 连接断开：清理连接、递增失败计数、轮询兜底 + 调度重连
   */
  private handleConnectionError(): void {
    logger.warn(
      `[onerror] SSE 连接错误 failCount=${this.reconnectFailCount + 1}`,
    );
    this.disconnect();
    this.reconnectFailCount++;
    // 首次断开：即时提示正在重连
    if (this.reconnectFailCount === 1) {
      import("../stores/toastStore")
        .then(({ toastWarning }) => {
          toastWarning("实时连接已断开，正在重连...");
        })
        .catch(() => {
          /* toastStore 动态加载失败，静默忽略 */
        });
    }
    // 连续失败 3 次后显示详细错误
    if (this.reconnectFailCount === 3) {
      import("../stores/toastStore")
        .then(({ toastError }) => {
          toastError(new Error("Failed to fetch"));
        })
        .catch(() => {
          /* toastStore 动态加载失败，静默忽略 */
        });
    }
    // 断开时启动轮询兜底 + 调度重连
    this.startPolling();
    this.scheduleReconnect();
  }

  /**
   * 读取并解析 SSE 流（fetch ReadableStream）
   *
   * 兼容 EventSource 语义：`event:` 命名事件、`data:` 多行 continuation、
   * 空行 = 事件结束。事件名默认 "message"。命名事件统一 dispatch（无 handler
   * 时 no-op），不再需要预注册——原 EventSource 的 addEventListener 注册循环
   * 一并移除。
   */
  private async readStream(
    controller: AbortController,
    body: ReadableStream<Uint8Array>,
  ): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = "message";
    /** U-04 残余：当前事件的 `id:` 字段（无则沿用上一条，SSE 语义） */
    let currentId = this.lastEventId;
    const pendingData: string[] = [];

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        // U-04：任意数据到达都刷新“链路新鲜度”（含服务端 heartbeat 事件）
        this.lastEventAt = Date.now();
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            // 空行 = SSE 事件结束：处理累积的多行 data
            if (pendingData.length === 0) {
              currentEvent = "message";
              continue;
            }
            const payload = pendingData.join("\n");
            pendingData.length = 0;
            const evt = currentEvent;
            currentEvent = "message";
            if (payload === "[DONE]") continue;
            // U-04 残余：记录事件 id（重连补发游标），在 dispatch 前更新
            if (currentId > 0) this.lastEventId = currentId;
            const data = this.parse(payload);
            this.logEventReceived(evt, payload, data);
            this.dispatch(evt, data);
            this.logEventDispatched(evt);
            continue;
          }
          if (trimmed.startsWith("event:")) {
            currentEvent = trimmed.slice(6).trim() || "message";
          } else if (trimmed.startsWith("data:")) {
            pendingData.push(trimmed.slice(5).trimStart());
          } else if (trimmed.startsWith("id:")) {
            const parsed = Number.parseInt(trimmed.slice(3).trim(), 10);
            if (Number.isFinite(parsed) && parsed >= 0) currentId = parsed;
          }
          // 其他 SSE 字段（retry:）忽略
        }
      }
      // 流正常结束（后端关闭连接）→ 视为断开，走重连
      if (this.streamController === controller) {
        logger.info("[readStream] SSE 流结束，后端关闭连接");
        this.handleConnectionError();
      }
    } catch (err: unknown) {
      if (controller.signal.aborted) return; // 主动断开
      if (this.streamController !== controller) return;
      logger.warn("[readStream] SSE 流读取异常", {
        error: err instanceof Error ? err.message : String(err),
      });
      this.handleConnectionError();
    }
  }

  /**
   * 事件收到日志（保留 plan/session 链路排查埋点，A4）
   */
  private logEventReceived(
    evt: string,
    rawData: string,
    data: Record<string, unknown>,
  ): void {
    // 对 plan 事件输出详细日志
    if (evt.startsWith("plan:")) {
      const planId = data.planId as string | undefined;
      const sessionId = data.sessionId as string | undefined;
      if (evt === "plan:step_progress") {
        logger.debug(
          `[dispatch] ${evt} planId=${planId} sessionId=${sessionId} stepId=${data.stepId} status=${data.status}`,
        );
      } else {
        logger.debug(
          `[dispatch] ${evt} planId=${planId} sessionId=${sessionId} title=${data.title ?? "-"} status=${data.status ?? "-"}`,
        );
      }
    }
    // 对会话事件输出详细日志（A4 排查：标题实时刷新依赖此链路）
    if (evt.startsWith("session:")) {
      const handlerCount = this.handlers.get(evt)?.size ?? 0;
      logger.info(`[SSE] 收到会话事件 ${evt}（A4 链路）`, {
        eventName: evt,
        rawData: String(rawData),
        parsedData: {
          id: (data.id as string) ?? null,
          title: (data.title as string) ?? null,
          ts: (data.ts as number) ?? null,
        },
        handlerCount,
        hasHandler: handlerCount > 0,
      });
    }
  }

  /**
   * 事件 dispatch 完成日志（区分「事件收到但 handler 未生效」，A4）
   */
  private logEventDispatched(evt: string): void {
    if (evt.startsWith("session:")) {
      logger.info(`[SSE] ${evt} dispatch 完成（A4 链路）`, {
        eventName: evt,
        dispatchedTo: this.handlers.get(evt)?.size ?? 0,
      });
    }
  }

  /**
   * 注册事件处理器
   */
  on(event: string, handler: EventHandler): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
  }

  /**
   * 移除事件处理器
   */
  off(event: string, handler: EventHandler): void {
    this.handlers.get(event)?.delete(handler);
  }

  /**
   * 断开 SSE 连接，清理所有定时器
   */
  disconnect(): void {
    logger.info(
      `[disconnect] 断开 SSE 连接 handlerCount=${this.handlers.size}`,
    );
    if (this.streamController) {
      this.streamController.abort();
      this.streamController = null;
    }

    // U-04：重置链路健康计时（下次 connect 从“握手宽限”重新开始）
    this.lastEventAt = 0;
    this.heartbeatFailures = 0;

    this.stopHeartbeat();
    this.stopPolling();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // 移除 visibilitychange 监听器
    if (this.visibilityBound && this._onVisibilityChange) {
      document.removeEventListener(
        "visibilitychange",
        this._onVisibilityChange,
      );
      this._onVisibilityChange = null;
      this.visibilityBound = false;
    }

    // U-04：移除 online 监听器
    if (this.onlineBound && this._onOnline) {
      window.removeEventListener("online", this._onOnline);
      this._onOnline = null;
      this.onlineBound = false;
    }
  }

  /**
   * 设置轮询兜底回调
   *
   * SSE 连接断开期间，每隔 SSE_FALLBACK_POLL_INTERVAL_MS 调用一次该回调；
   * 重连成功后自动停止调用。
   */
  setPollHandler(handler: (() => void) | null): void {
    this.pollHandler = handler;
  }

  /**
   * 检查当前连接状态
   *
   * U-04（2026-10-19）：不再只看“句柄是否存在”——半开连接/TCP 假活时句柄仍在，
   * 原实现会让 `visibilitychange` 早退、永不重连。现以“最近一次收到数据的时间”判定：
   * 超过 {@link CONNECTION_STALE_MS} 视为假连接。
   */
  isConnected(): boolean {
    if (this.streamController === null) return false;
    // 刚发起、尚未收到首块：给握手宽限期（避免 connect 后立即被判假连接）
    if (this.lastEventAt === 0) return true;
    return Date.now() - this.lastEventAt < CONNECTION_STALE_MS;
  }

  /**
   * U-04：强制重建连接（网络恢复 / 切回前台 / 后端重启）。
   * 先断开旧流（abort 不会触发错误重连），再立即重连并重置退避。
   */
  reconnectNow(): void {
    if (this.streamController) {
      logger.info("[reconnectNow] 丢弃旧连接并立即重建");
      this.disconnect();
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectDelay = INITIAL_RECONNECT_DELAY;
    this.connect();
  }

  // ── 心跳保活 ──────────────────────────────────────────────────

  /**
   * 启动心跳保活
   *
   * 每隔 30s 发一个 HEAD 请求，防止中间代理因空闲超时断开连接。
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.pingTimer = setInterval(() => {
      // 无连接句柄 ⇒ 无事可做（重连由 scheduleReconnect 负责）
      if (!this.streamController) return;

      // U-04：先判“链路静默”再看健康状态 —— 假连接时 isConnected() 已返回 false，
      // 若先 return 就永远不会触发重连。
      if (
        this.lastEventAt > 0 &&
        Date.now() - this.lastEventAt >= CONNECTION_STALE_MS
      ) {
        logger.warn("[heartbeat] 链路静默超过阈值，判定假连接并重连", {
          silentMs: Date.now() - this.lastEventAt,
          thresholdMs: CONNECTION_STALE_MS,
        });
        this.handleConnectionError();
        return;
      }

      const startedAt = Date.now();
      // 构建一次鉴权头：同时供请求与日志 hasAuth 判断复用（不打印 secret 明文）
      const headers = buildAuthHeaders();
      const url = `${getBackendBaseUrl()}/v1/events`;
      logger.debug("[heartbeat] 心跳发起", {
        url,
        method: "HEAD",
        hasAuth: !!headers["X-API-Key"],
      });

      fetch(url, {
        method: "HEAD",
        // BUG-4 修复：与主连接鉴权一致，配置 LIRI_API_SECRET 时心跳不再 401
        headers,
      })
        .then((res) => {
          // U-04：HEAD 成功 ⇒ 网络/后端可达，清零失败计数
          this.heartbeatFailures = 0;
          logger.debug("[heartbeat] 心跳完成", {
            url,
            status: res.status,
            ok: res.ok,
            durationMs: Date.now() - startedAt,
          });
        })
        .catch((err: unknown) => {
          // 排查保活失效的关键日志：代理断连 / 鉴权失败 / 网络中断
          this.heartbeatFailures++;
          logger.warn("[heartbeat] 心跳失败", {
            url,
            error: err instanceof Error ? err.message : String(err),
            durationMs: Date.now() - startedAt,
            consecutiveFailures: this.heartbeatFailures,
          });
          // U-04：连续失败达阈值 ⇒ 判定假连接并重连（原实现只 warn，永不恢复）
          if (this.heartbeatFailures >= HEARTBEAT_FAILURE_THRESHOLD) {
            logger.warn("[heartbeat] 心跳连续失败，强制重建 SSE 连接", {
              consecutiveFailures: this.heartbeatFailures,
            });
            this.handleConnectionError();
          }
        });
    }, 30000);
  }

  /**
   * 停止心跳保活
   */
  private stopHeartbeat(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  // ── 指数退避重连 ──────────────────────────────────────────────

  /**
   * 调度一次重连
   *
   * 使用指数退避策略：1s → 2s → 4s → 8s → 16s → 30s（上限）
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      logger.debug(
        `[scheduleReconnect] 已有重连定时器，跳过 delay=${this.reconnectDelay}ms`,
      );
      return; // 已调度
    }

    logger.info(
      `[scheduleReconnect] 调度重连 delay=${this.reconnectDelay}ms failCount=${this.reconnectFailCount}`,
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);

    // 指数退避，上限 MAX_RECONNECT_DELAY
    this.reconnectDelay = Math.min(
      this.reconnectDelay * 2,
      MAX_RECONNECT_DELAY,
    );
  }

  // ── 轮询兜底 ──────────────────────────────────────────────────

  /**
   * 启动轮询兜底
   *
   * 断开期间每隔 SSE_FALLBACK_POLL_INTERVAL_MS 调用 pollHandler。
   */
  private startPolling(): void {
    if (this.pollingTimer) return; // 已运行
    if (!this.pollHandler) return; // 未设置回调

    this.pollingTimer = setInterval(() => {
      this.pollHandler?.();
    }, SSE_FALLBACK_POLL_INTERVAL_MS);
  }

  /**
   * 停止轮询兜底
   */
  private stopPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  // ── 可见性监听 ────────────────────────────────────────────────

  /**
   * 绑定浏览器可见性监听
   *
   * 标签页从后台切回前台时，若 SSE 连接断开则立即尝试重连。
   */
  private bindVisibilityListener(): void {
    if (!this.visibilityBound) {
      this.visibilityBound = true;

      this._onVisibilityChange = () => {
        if (document.visibilityState !== "visible") return;
        // U-04：isConnected 已改为健康判定（含 45s 静默）⇒ 假连接也会走到这里重连
        if (this.isConnected()) return;
        logger.info("[visibilitychange] 切回前台且链路不健康，立即重建 SSE");
        this.reconnectNow();
      };
      document.addEventListener("visibilitychange", this._onVisibilityChange);
    }

    // U-04：浏览器网络恢复（online）⇒ 立即重建事件通道；
    // 原实现只由 connectionMonitor 唤醒挂起的对话流，不重建 /v1/events。
    if (!this.onlineBound) {
      this.onlineBound = true;
      this._onOnline = () => {
        logger.info("[online] 网络恢复，立即重建 SSE 连接");
        this.reconnectNow();
      };
      window.addEventListener("online", this._onOnline);
    }
  }

  // ── 内部工具 ──────────────────────────────────────────────────

  /**
   * 分发事件给所有已注册的处理器
   */
  private dispatch(event: string, data: Record<string, unknown>): void {
    this.handlers.get(event)?.forEach((h) => h(data));
  }

  /**
   * 解析 SSE 消息数据为 JSON 对象
   */
  private parse(data: string): Record<string, unknown> {
    try {
      return JSON.parse(data);
    } catch {
      return {};
    }
  }
}

export const sseService = new SSEService();
