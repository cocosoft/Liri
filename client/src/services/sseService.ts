import { getBackendBaseUrl } from "./backendUrl";
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
const POLL_INTERVAL = 15000;

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
  private eventSource: EventSource | null = null;

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

  // ── 公共 API ──────────────────────────────────────────────────

  /**
   * 建立 SSE 连接
   */
  connect(): void {
    if (this.eventSource) {
      logger.debug("[connect] 已有连接，跳过");
      return;
    }

    logger.info("[connect] 开始建立 SSE 连接");
    // 停止轮询（如果正在运行）
    this.stopPolling();

    try {
      // P1-2.16: 注入 traceparent 查询参数，实现跨进程 TraceContext 传递
      const tp = buildTraceparentParam();
      const sseUrl = `${getBackendBaseUrl()}/v1/events${tp ? `?${tp}` : ""}`;
      this.eventSource = new EventSource(sseUrl);

      this.eventSource.onopen = () => {
        // 连接成功：重置重连间隔，启动心跳，停止轮询
        const wasReconnecting = this.reconnectFailCount > 0;
        logger.info(`[onopen] SSE 连接成功 wasReconnecting=${wasReconnecting}`);
        this.reconnectDelay = INITIAL_RECONNECT_DELAY;
        this.reconnectFailCount = 0;
        this.startHeartbeat();
        this.stopPolling();

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
      };

      this.eventSource.onerror = () => {
        logger.warn(
          `[onerror] SSE 连接错误 failCount=${this.reconnectFailCount + 1} readyState=${this.eventSource?.readyState}`,
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
      };

      this.eventSource.onmessage = (e) => {
        this.dispatch("message", this.parse(e.data));
      };

      this.eventSource.addEventListener("heartbeat", (e: Event) => {
        const msg = e as MessageEvent;
        this.dispatch("heartbeat", this.parse(msg.data));
      });

      // ── 后台操作进度事件 ──
      const progressEvents = [
        "dream:phase:changed",
        "dream:cycle:completed",
        "dream:cycle:failed",
        "knowledge:compile:started",
        "knowledge:compile:progress",
        "knowledge:compile:completed",
        "knowledge:compile:aborted",
        "task:queue:progress",
        // §5 P2: 长程任务进度/完成事件（LongRunningTaskOrchestrator 广播）
        "task:progress",
        "task:completed",
        // P0b-3: AI 自动建项目通知 — 前端监听后同步创建 worktree
        "project:auto_created",
        // P2（08-09）：PlanDrivenLoop TaskCard 实时进度事件
        "plan:task_card",
        "plan:step_progress",
        "plan:completed",
        // 根因 C：后端崩溃恢复把会话标记 PAUSED 后的主动通知
        "session:paused",
        // §十 阶段 B：后台任务状态机转移实时广播（background:{taskId}）
        "background:state",
        // §十 阶段 C：task-system 任务状态机转移实时广播（task:{taskId}）
        "task:state",
      ];
      logger.info(`[connect] 注册进度事件监听 count=${progressEvents.length}`);
      for (const evt of progressEvents) {
        this.eventSource.addEventListener(evt, (e: Event) => {
          const msg = e as MessageEvent;
          const data = this.parse(msg.data);
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
          this.dispatch(evt, data);
        });
      }
    } catch {
      // 创建 EventSource 失败，直接进入重连
      this.scheduleReconnect();
    }

    // 绑一次可见性监听（全局、只绑一次）
    this.bindVisibilityListener();
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
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

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
  }

  /**
   * 设置轮询兜底回调
   *
   * SSE 连接断开期间，每隔 POLL_INTERVAL 调用一次该回调；
   * 重连成功后自动停止调用。
   */
  setPollHandler(handler: (() => void) | null): void {
    this.pollHandler = handler;
  }

  /**
   * 检查当前连接状态
   */
  isConnected(): boolean {
    return (
      this.eventSource !== null &&
      this.eventSource.readyState === EventSource.OPEN
    );
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
      // 仅当 SSE 连接正常时才发送心跳
      if (!this.isConnected()) return;

      fetch(`${getBackendBaseUrl()}/v1/events`, { method: "HEAD" }).catch(
        () => {
          // 心跳失败静默处理，不干扰主流程
        },
      );
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
   * 断开期间每隔 POLL_INTERVAL 调用 pollHandler。
   */
  private startPolling(): void {
    if (this.pollingTimer) return; // 已运行
    if (!this.pollHandler) return; // 未设置回调

    this.pollingTimer = setInterval(() => {
      this.pollHandler?.();
    }, POLL_INTERVAL);
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
    if (this.visibilityBound) return;
    this.visibilityBound = true;

    this._onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      if (this.isConnected()) return;

      // 清除已调度的重连，立即重连
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      this.reconnectDelay = INITIAL_RECONNECT_DELAY;
      this.connect();
    };
    document.addEventListener("visibilitychange", this._onVisibilityChange);
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
