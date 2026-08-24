import type { LiriEvent, Message, Session } from "../types";
import { http as apiHttp } from "./httpClient";
import { createLogger } from "../utils/logger";
import { handleClientError } from "../utils/handleError";
import { getOTelTracing } from "../monitoring/otel";
import { setSessionCache } from "../stores/chat/chat-history.slice";
import { importLegacyMessages } from "../stores/chat/legacyMessageImporter";

const logger = createLogger("sessionService");

const isTauri =
  typeof window !== "undefined" &&
  ("__TAURI__" in window || "__TAURI_INTERNALS__" in window);

// 是否已降级到内存模式（后端不可用时设为 true）
let _isUsingFallback = false;

/** 获取当前是否处于降级模式 */
export function isUsingFallback(): boolean {
  return _isUsingFallback;
}

// ─── A2：events 回放规范化（防重复渲染的双保险防线） ───
/**
 * normalizeEventsForReplay — 回放前对 events 做规范化，防御重复渲染。
 *
 * 后端写入层只保证 seq 单调递增（相同 seq 拒绝），但无法拦截以下异常：
 *   ① 同一个 turn 块（turn/start → assistant/* → turn/end）被完整回放多次
 *      （每次 seq 递增，写入层无法识别内容重复）
 *   ② 增量合并缓存时出现 seq 重叠（cached tailSeq ≥ 新拉 fromSeq）
 *   ③ 历史损坏行 / 非法 seq 行
 *
 * 处理步骤（按优先级）：
 *   Step 1: 过滤无效事件（seq 非正整数 / JSON 损坏）
 *   Step 2: 按 seq 去重（保留 seq 第一次出现的事件，后者丢弃）
 *   Step 3: 按 seq 升序排序（后端保证单调，但缓存合并 + 增量可能乱序）
 *   Step 4: 重复 turn 块跳过 —— turn/start 的 turn 号已出现过，
 *           则从该 turn/start 起（含）直到下一个 turn/end（含）之间的所有事件全部丢弃。
 *           这是修复 "重新打开会话 AI 输出重复 N 次" 的关键防线。
 *
 * @param events 原始 events（可能含重复 seq / 重复 turn 块）
 * @param loggerLabel 用于日志的标签（如 sessionId）
 * @returns 规范化后的 events（保证 seq 唯一 + 单调 + 无重复 turn 回放）
 */
export function normalizeEventsForReplay(
  events: LiriEvent[],
  loggerLabel: string = "unknown",
): LiriEvent[] {
  // Step 1: 过滤无效事件
  const validEvents = events.filter(
    (e) =>
      e && typeof e.seq === "number" && Number.isFinite(e.seq) && e.seq > 0,
  );
  const invalidCount = events.length - validEvents.length;

  // Step 2: 按 seq 去重（保留首次出现）
  const seenSeqs = new Set<number>();
  const dedupSeqs: LiriEvent[] = [];
  let duplicateSeqCount = 0;
  for (const e of validEvents) {
    if (seenSeqs.has(e.seq)) {
      duplicateSeqCount++;
      continue;
    }
    seenSeqs.add(e.seq);
    dedupSeqs.push(e);
  }

  // Step 3: 按 seq 升序排序
  dedupSeqs.sort((a, b) => a.seq - b.seq);

  // Step 4: 重复 turn 块跳过（仅限"连续重复回放"）
  // 场景：后端异常时同一个 turn 块被完整回放多次（seq 递增但 turn 号相同、内容相同）。
  //
  // ⚠ 修复（2026-08-23，根因：后端重启后 _toolRoundCount 归零 → turn 号重新从 1 开始）：
  // 原实现用全局 seenTurns 集合判断"turn 号是否出现过"，会把重启后的新对话
  // （turn=1 与历史 turn=1 同号，但中间隔着其他 turn / user/message，是合法的新一轮）
  // 误判为"重复回放"并整块删除 → 重新进入会话时信息不全、顺序错乱。
  // 修复：改为"连续重复"判定——仅当上一次 turn 与本 turn 号相同且已正常 turn/end
  // （紧邻重复）才跳过；user/message 是对话边界，遇到时重置判定状态。
  let lastTurnNo: number | null = null; // 上一次 turn/start 的 turn 号
  let lastTurnEnded = false; // 上一次 turn 是否已 turn/end（紧邻重复的必要条件）
  const normalized: LiriEvent[] = [];
  let skipUntilTurnEnd = false;
  let skipStartSeq = 0;
  let skipCount = 0;
  let skippedTurnsCount = 0;

  for (const e of dedupSeqs) {
    if (skipUntilTurnEnd) {
      skipCount++;
      if (e.type === "turn/end") {
        skipUntilTurnEnd = false;
        skippedTurnsCount++;
        logger.warn("[normalizeEvents] 跳过重复 turn 块结束", {
          sessionId: loggerLabel,
          seq: e.seq,
          skipStartSeq,
          skipCount,
        });
      }
      continue;
    }

    if (e.type === "turn/start") {
      const data = e.data as { turn: number } | undefined;
      const turnNo = data?.turn;
      if (
        typeof turnNo === "number" &&
        Number.isFinite(turnNo) &&
        lastTurnNo === turnNo &&
        lastTurnEnded
      ) {
        // 连续重复（同 turn 号紧邻且已完整结束）→ 开启跳过模式直到 turn/end
        skipUntilTurnEnd = true;
        skipStartSeq = e.seq;
        skipCount = 1;
        logger.warn(
          "[normalizeEvents] 检测到连续重复 turn/start，开启跳过至 turn/end",
          {
            sessionId: loggerLabel,
            turn: turnNo,
            seq: e.seq,
          },
        );
        continue;
      }
      if (typeof turnNo === "number" && Number.isFinite(turnNo)) {
        lastTurnNo = turnNo;
      }
      lastTurnEnded = false;
    } else if (e.type === "turn/end") {
      // 记录上一次 turn 已正常结束（供"连续重复"判定）
      lastTurnEnded = true;
    } else if (e.type === "user/message") {
      // 用户消息是新的对话边界：后端重启后 turn 号重新计数是合法场景，
      // 重置判定状态，避免把重启后的新 turn 误判为重复回放
      lastTurnNo = null;
      lastTurnEnded = false;
    }

    normalized.push(e);
  }

  // 如果遇到文件末尾仍在 skipUntilTurnEnd（缺少 turn/end 收尾），记录一条 warn
  if (skipUntilTurnEnd) {
    logger.warn("[normalizeEvents] 文件尾仍在跳过态（缺少 turn/end 收尾）", {
      sessionId: loggerLabel,
      skipStartSeq,
      skipCount,
    });
  }

  const totalRemoved =
    invalidCount + duplicateSeqCount + (dedupSeqs.length - normalized.length);
  if (totalRemoved > 0 || skippedTurnsCount > 0) {
    logger.info("[normalizeEvents] events 规范化完成", {
      sessionId: loggerLabel,
      input: events.length,
      output: normalized.length,
      removed: totalRemoved,
      invalid: invalidCount,
      duplicateSeq: duplicateSeqCount,
      skippedTurns: skippedTurnsCount,
    });
  }
  return normalized;
}

async function getTauriCore() {
  if (!isTauri) return null;
  try {
    return await import("@tauri-apps/api/core");
  } catch (e) {
    handleClientError(e, {
      module: "services:session",
      action: "getTauriCore",
    });
    return null;
  }
}

function createMemorySessionService() {
  _isUsingFallback = true;
  return {
    list: async (): Promise<Session[]> => [],
    create: async (title: string): Promise<Session> => ({
      id: `local-${Date.now()}`,
      title,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messageCount: 0,
      roundCount: 0,
    }),
    switch: async (_id: string): Promise<Session> => ({
      id: _id,
      title: "恢复的会话",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messageCount: 0,
      roundCount: 0,
    }),
    delete: async (_id: string): Promise<void> => {},
    rename: async (_id: string, _title: string): Promise<void> => {},
    getCurrent: async (): Promise<Session | null> => null,
  };
}

async function tryTauri<T>(
  method: string,
  args?: Record<string, unknown>,
): Promise<T | null> {
  const core = await getTauriCore();
  if (!core) return null;
  try {
    return await core.invoke<T>(method, args);
  } catch (e) {
    handleClientError(e, { module: "services:session", action: "tryTauri" });
    return null;
  }
}

/**
 * 展平 metadata 字段到顶级（BUG #12 展平修复）
 * 后端在 metadata 中存储 titleAutoGenerated，统一提取到顶层字段
 * 同时提取 model → modelId, workspaceId, tasksOverride 等会话绑定资源
 */
function flattenSession<S extends Session | null>(session: S): S {
  if (!session) return session;
  const raw = session as unknown as {
    metadata?: {
      titleAutoGenerated?: boolean;
      model?: string;
      workspaceId?: string;
      providerId?: string;
      workspacePath?: string;
      tasksOverride?: Record<string, string>;
    };
  };
  return {
    ...session,
    titleAutoGenerated: raw.metadata?.titleAutoGenerated,
    modelId: raw.metadata?.model || session.modelId,
    providerId: raw.metadata?.providerId || session.providerId,
    workspaceId: raw.metadata?.workspaceId || session.workspaceId,
    workspacePath:
      raw.metadata?.workspacePath ||
      (session as { workspacePath?: string }).workspacePath,
    tasksOverride:
      (raw.metadata?.tasksOverride as Record<string, string> | undefined) ||
      session.tasksOverride,
  };
}

/**
 * 创建会话
 * @param title 会话标题
 * @param options 可选：绑定模型ID、工作空间ID
 */
export const sessionService = {
  list: (): Promise<Session[]> => {
    return getOTelTracing().asyncWrap("services:session:list", async () => {
      try {
        const res = await apiHttp.get<Session[]>("/v1/sessions");
        if (res.ok) {
          _isUsingFallback = false;
          return (res.data ?? []).map(flattenSession);
        }
        logger.warn("获取会话列表失败", { error: res.error });
      } catch (e) {
        handleClientError(e, { module: "services:session", action: "list" });
        // 网络错误，尝试降级
      }
      const result = await tryTauri<Session[]>("list_sessions");
      if (result) return result.map(flattenSession);
      return createMemorySessionService().list();
    });
  },

  create: (
    title: string,
    options?: {
      modelId?: string;
      workspaceId?: string;
      workspacePath?: string;
      moduleType?: string;
      projectId?: string;
    },
  ): Promise<Session> => {
    return getOTelTracing().asyncWrap(
      "services:session:createSession",
      async () => {
        try {
          const body: Record<string, unknown> = { title };
          if (options?.modelId) body.model = options.modelId;
          if (options?.workspaceId) body.workspaceId = options.workspaceId;
          if (options?.workspacePath)
            body.workspace_path = options.workspacePath;
          if (options?.moduleType) body.moduleType = options.moduleType;
          if (options?.projectId) body.projectId = options.projectId;
          const res = await apiHttp.post<Session>("/v1/sessions", body);
          if (res.ok) {
            _isUsingFallback = false;
            return flattenSession(res.data as Session);
          }
          logger.warn("创建会话失败", { error: res.error });
        } catch (e) {
          handleClientError(e, {
            module: "services:session",
            action: "create",
          });
          // 网络错误
        }
        const result = await tryTauri<Session>("create_session", { title });
        if (result) return flattenSession(result);
        // W1 修复：HTTP 与 Tauri 均不可用时，原实现返回内存假会话（id 为 local-*，
        // list() 返回空、刷新即失，UI 却显示"创建成功"——静默假成功）。
        // 改为显式抛错，由调用方展示失败（对齐 switch() 的 N1 404 上抛语义）。
        throw new Error("无法创建会话：后端服务不可用");
      },
    );
  },

  /**
   * D3（2026-08-24）：事件级 fork——复制源会话事件前缀生成分支会话
   * @param sourceId 源会话 ID
   * @param options boundary（缺省 = 源 tailSeq，fork 全量历史）、childTitle
   * @returns 子会话 + 复制边界与数量；open turn / 无效 boundary 时后端 400 → 抛错
   */
  forkSession: (
    sourceId: string,
    options?: { boundary?: number; childTitle?: string },
  ): Promise<{ session: Session; boundary: number; copied: number }> => {
    return getOTelTracing().asyncWrap(
      "services:session:forkSession",
      async () => {
        const body: Record<string, unknown> = {};
        if (options?.boundary !== undefined) body.boundary = options.boundary;
        if (options?.childTitle !== undefined)
          body.childTitle = options.childTitle;
        const res = await apiHttp.post<{
          session: Session;
          boundary: number;
          copied: number;
        }>(`/v1/sessions/${sourceId}/fork`, body);
        if (!res.ok) {
          const msg = (res.data as { error?: { message?: string } } | null)
            ?.error?.message;
          throw new Error(msg ?? "分支创建失败");
        }
        return {
          session: flattenSession(res.data?.session as Session),
          boundary: res.data?.boundary ?? 0,
          copied: res.data?.copied ?? 0,
        };
      },
    );
  },

  switch: (id: string): Promise<Session> => {
    return getOTelTracing().asyncWrap(
      "services:session:switchSession",
      async () => {
        try {
          const res = await apiHttp.post<Session>(`/v1/sessions/${id}/switch`);
          if (res.ok) {
            _isUsingFallback = false;
            return flattenSession(res.data as Session);
          }
          // N1 修复：404 = 会话不存在（后端 P2-3 已改为显式 404，不再静默重建空会话）。
          // 原实现静默降级到内存假会话（title:"恢复的会话"），switchChatSession 无
          // 假会话检测 → 空壳会话"复活"。404 直接抛出，由调用方清理残留并切换。
          // #10 修复：与 delete/rename 统一为 status>=400 上抛——原实现仅 404 上抛，
          // HTTP 500 等业务失败仍降级到内存假会话，switchChatSession 用它覆盖标题并
          // set currentSessionId，制造"切换成功"假象。
          const status = res.error?.code ?? 500;
          logger.warn("切换会话失败（后端明确错误，不再降级）", {
            id,
            error: res.error,
          });
          if (status >= 400) {
            const err = new Error(
              `切换会话失败: ${res.error?.message ?? `HTTP ${status}`}`,
            );
            (err as unknown as Record<string, unknown>).statusCode = status;
            throw err;
          }
        } catch (e) {
          // 业务错误（带 statusCode）直接上抛（不做 Tauri/内存降级）
          if ((e as { statusCode?: number })?.statusCode) throw e;
          handleClientError(e, {
            module: "services:session",
            action: "switch",
          });
          // 网络错误
        }
        const result = await tryTauri<Session>("switch_session", { id });
        if (result) return flattenSession(result);
        return createMemorySessionService().switch(id);
      },
    );
  },

  delete: (id: string): Promise<void> => {
    return getOTelTracing().asyncWrap(
      "services:session:deleteSession",
      async () => {
        try {
          const res = await apiHttp.delete<void>(`/v1/sessions/${id}`);
          if (res.ok) {
            _isUsingFallback = false;
            return;
          }
          // R1 修复（复查闭环 BUG-3）：后端明确失败（5xx）时抛错、不做降级——
          // BUG-3 后端已改为持久化删除失败返回 500，若前端仍静默降级成功，
          // deleteChatSession 会清理本地记录 → 用户看到删除成功但磁盘残留，
          // 刷新后会话"复活"（BUG-3 想消灭的场景依然存在）。
          // 与 switch 的 N1（404 抛错）同思路：明确业务错误上抛，仅纯网络错误
          // （fetch 抛出进 catch）才尝试 Tauri/内存降级。
          const status = res.error?.code ?? 500;
          logger.warn("删除会话失败（后端明确错误，不再降级）", {
            id,
            error: res.error,
          });
          // P3 修复（2026-08-14 排查）：status >= 400 上抛——原实现仅覆盖 5xx，
          // 404（会话不存在）仍走 Tauri/内存降级 →「假删除成功」残留（R1 只覆盖 5xx）。
          // 404 与 switch 的 N1 一致：明确业务错误上抛，由调用方清理残留并切换。
          if (status >= 400) {
            const err = new Error(
              `删除会话失败: ${res.error?.message ?? `HTTP ${status}`}`,
            );
            (err as unknown as Record<string, unknown>).statusCode = status;
            throw err;
          }
        } catch (e) {
          handleClientError(e, {
            module: "services:session",
            action: "delete",
          });
          // 纯网络错误（fetch 抛出）→ 尝试 Tauri/内存降级；业务错误（5xx）直接上抛
          if ((e as { statusCode?: number })?.statusCode) throw e;
          // 网络错误
        }
        const result = await tryTauri<void>("delete_session", { id });
        if (result !== null) return;
        return createMemorySessionService().delete(id);
      },
    );
  },

  rename: (id: string, title: string): Promise<void> => {
    return getOTelTracing().asyncWrap(
      "services:session:renameSession",
      async () => {
        // 排查日志：rename 全链路（开始/后端成功/业务失败/网络降级），
        // 与 switchChatSession 的"①开始/✅完成"风格对齐
        logger.info("rename:①开始", { id, title });
        try {
          const res = await apiHttp.put<void>(`/v1/sessions/${id}`, { title });
          if (res.ok) {
            _isUsingFallback = false;
            logger.info("rename:✅后端重命名成功", { id });
            return;
          }
          // L6 修复（会话系统排查 2026-08-13）：后端明确失败（4xx/5xx）时抛带
          // statusCode 的错误并上抛，不做 Tauri/内存降级——与 delete 的 R1 修复、
          // switch 的 N1 修复策略一致。原实现所有错误都降级到内存 fallback，
          // 重命名失败被"假成功"吞掉（内存改了、刷新丢），用户无法感知后端失败。
          const status = res.error?.code ?? 500;
          logger.warn("rename:❌后端明确失败（业务错误，不再降级）", {
            id,
            title,
            status,
            error: res.error,
          });
          const err = new Error(
            `重命名会话失败: ${res.error?.message ?? `HTTP ${status}`}`,
          );
          (err as unknown as Record<string, unknown>).statusCode = status;
          throw err;
        } catch (e) {
          handleClientError(e, {
            module: "services:session",
            action: "rename",
          });
          // 业务错误（带 statusCode）直接上抛；仅纯网络错误（fetch 抛出）降级
          if ((e as { statusCode?: number })?.statusCode) throw e;
          // 网络错误路径：先尝试 Tauri fallback，再内存 fallback
          logger.warn("rename:网络错误，尝试 Tauri 降级", {
            id,
            title,
            error: e instanceof Error ? e.message : String(e),
          });
          const result = await tryTauri<void>("rename_session", { id, title });
          if (result !== null) {
            logger.info("rename:✅Tauri 降级成功", { id });
            return;
          }
          // 内存 fallback（与 delete/switch 一致）
          logger.warn("rename:Tauri 不可用，降级内存模式（重启后不生效）", {
            id,
          });
          return createMemorySessionService().rename(id, title);
        }
      },
    );
  },

  getCurrent: async (): Promise<Session | null> => {
    try {
      const res = await apiHttp.get<Session | null>("/v1/sessions/current");
      if (res.ok) {
        _isUsingFallback = false;
        return flattenSession(res.data as Session | null);
      }
      logger.warn("获取当前会话失败", { error: res.error });
    } catch (e) {
      handleClientError(e, {
        module: "services:session",
        action: "getCurrent",
      });
      // 网络错误
    }
    const result = await tryTauri<Session | null>("get_current_session");
    if (result !== null) return flattenSession(result);
    return createMemorySessionService().getCurrent();
  },

  get: async (id: string): Promise<Session | null> => {
    try {
      const res = await apiHttp.get<Session>(`/v1/sessions/${id}`);
      if (res.ok) {
        _isUsingFallback = false;
        return flattenSession(res.data as Session);
      }
      logger.warn("获取会话失败", { id, error: res.error });
    } catch (e) {
      handleClientError(e, { module: "services:session", action: "get" });
      // 网络错误
    }
    const result = await tryTauri<Session | null>("get_session", { id });
    if (result !== null) return flattenSession(result);
    return createMemorySessionService()
      .list()
      .then((sessions) => sessions.find((s) => s.id === id) || null)
      .catch(() => null);
  },

  getMessages: (sessionId: string): Promise<Message[]> => {
    return getOTelTracing().asyncWrap(
      "services:session:getMessages",
      async () => {
        try {
          const res = await apiHttp.get<Message[]>(
            `/v1/sessions/${sessionId}/messages`,
          );
          if (res.ok) {
            _isUsingFallback = false;
            return res.data ?? [];
          }
          logger.warn("获取会话消息失败", { sessionId, error: res.error });
        } catch (e) {
          handleClientError(e, {
            module: "services:session",
            action: "getMessages",
          });
          // 网络错误
        }
        const result = await tryTauri<Message[]>("get_session_messages", {
          sessionId,
        });
        if (result) return result;
        return [];
      },
    );
  },

  /**
   * M2-3 + G7（2026-08-23 更新）：加载会话对话数据（后端统一派生）
   *
   * P2-2（2026-08-23）：统一消费后端派生结果——后端 getSessionMessages 已实现
   * "事件派生优先（事件聚合 + 投影 lastEventSeq 版本覆盖）+ 投影兜底"，前端不再
   * 自行 events 派生 / 3 信号损坏检测 / legacy 合并 / 10 分钟匹配窗 / timestamp 二次排序。
   * （v0.1 的"增量双通道"设计已被后端派生内部吸收：覆盖判定在后端完成，前端无需
   * events 增量 + 投影增量双通道。）
   *
   * 回退：后端派生/投影失败（网络/异常）→ legacy messages 规整。
   */
  loadConversation: (
    sessionId: string,
  ): Promise<{ messages: Message[]; source: "events" | "legacy" }> => {
    return getOTelTracing().asyncWrap(
      "services:session:loadConversation",
      async () => {
        // P2-2（2026-08-23）：统一消费后端派生结果（评审 G7）——
        // 后端 getSessionMessages 已实现"事件派生优先（事件聚合 + 投影覆盖）+ 投影兜底"，
        // 前端不再自行 events 派生 / 3 信号损坏检测 / legacy 合并 / 10 分钟匹配窗。
        try {
          const res = await apiHttp.get<Message[]>(
            `/v1/sessions/${sessionId}/messages`,
          );
          if (res.ok && Array.isArray(res.data)) {
            // 评审 #3：排序键 = 首事件 seq——后端派生（EventMessageDeriver）已按首事件 seq 升序
            // 返回（纯投影按 lastEventSeq 插入），前端**不再二次 timestamp 排序**（否则可能
            // 打乱派生顺序，尤其 timestamp 相同/缺失的异常消息）。
            const messages = res.data.slice();
            if (messages.length > 0) {
              setSessionCache(sessionId, messages);
            }
            logger.info("loadConversation: 消费后端派生结果", {
              sessionId,
              messageCount: messages.length,
            });
            return { messages, source: "events" };
          }
          logger.warn("loadConversation 获取会话消息失败", {
            sessionId,
            error: res.error,
          });
        } catch (e) {
          handleClientError(e, {
            module: "services:session",
            action: "loadConversation",
          });
        }

        // 回退：投影路径（后端 getMessages 已派生/投影，importLegacyMessages 规整）
        const rawFallback = await sessionService.getMessages(sessionId);
        const fallbackMessages = importLegacyMessages(rawFallback);
        return { messages: fallbackMessages, source: "legacy" };
      },
    );
  },

  clearAll: async (): Promise<void> => {
    try {
      const res = await apiHttp.delete<void>("/v1/sessions");
      if (res.ok) {
        _isUsingFallback = false;
        return;
      }
      logger.warn("清除所有会话失败", { error: res.error });
    } catch (e) {
      handleClientError(e, { module: "services:session", action: "clearAll" });
      // 网络错误
    }
    const result = await tryTauri<void>("clear_all_sessions");
    if (result !== null) return;
  },

  /**
   * 删除单条消息
   */
  deleteMessage: async (
    sessionId: string,
    messageId: string,
  ): Promise<{ messages: Array<Record<string, unknown>> }> => {
    try {
      const res = await apiHttp.delete<{
        success: boolean;
        messages: Array<Record<string, unknown>>;
      }>(`/v1/sessions/${sessionId}/messages/${messageId}`);
      if (res.ok && res.data) {
        _isUsingFallback = false;
        return { messages: res.data.messages };
      }
    } catch (e) {
      handleClientError(e, {
        module: "services:session",
        action: "deleteMessage",
      });
      throw e;
    }
    throw new Error("Delete message failed");
  },

  /**
   * 截断消息（回退到指定消息之前）
   */
  truncateMessages: async (
    sessionId: string,
    beforeMessageId: string,
  ): Promise<{
    messages: Array<Record<string, unknown>>;
    remainingRollbacks: number;
    undoResults?: Array<{ roundId: number; success: boolean; error?: string }>;
  }> => {
    try {
      const res = await apiHttp.post<{
        success: boolean;
        messages: Array<Record<string, unknown>>;
        remainingRollbacks: number;
        undoResults?: Array<{
          roundId: number;
          success: boolean;
          error?: string;
        }>;
      }>(`/v1/sessions/${sessionId}/messages/truncate`, {
        beforeMessageId,
      });
      if (res.ok && res.data) {
        _isUsingFallback = false;
        return {
          messages: res.data.messages,
          remainingRollbacks: res.data.remainingRollbacks,
          undoResults: res.data.undoResults,
        };
      }
    } catch (e) {
      handleClientError(e, {
        module: "services:session",
        action: "truncateMessages",
      });
      throw e;
    }
    throw new Error("Truncate messages failed");
  },

  /**
   * 更新会话元数据（绑定模型、工作空间等）
   * 后端 PATCH API 不存在时静默降级
   */
  updateSessionMeta: async (
    sessionId: string,
    meta: {
      modelId?: string;
      providerId?: string;
      workspaceId?: string;
      tasksOverride?: Record<string, string>;
    },
  ): Promise<boolean> => {
    try {
      const body: Record<string, unknown> = {};
      if (meta.modelId !== undefined) body.model = meta.modelId;
      if (meta.providerId !== undefined) body.provider_id = meta.providerId;
      if (meta.workspaceId !== undefined) body.workspace_id = meta.workspaceId;
      if (meta.tasksOverride !== undefined)
        body.tasks_override = meta.tasksOverride;
      const res = await apiHttp.patch(`/v1/sessions/${sessionId}/meta`, body);
      if (res.ok) {
        _isUsingFallback = false;
        return true;
      }
    } catch (e) {
      handleClientError(e, {
        module: "services:session",
        action: "updateSessionMeta",
      });
      // 网络错误
    }
    logger.debug("updateSessionMeta 静默降级：PATCH API 不可用", { sessionId });
    return false;
  },

  compact: async (sessionId: string): Promise<unknown | null> => {
    try {
      const res = await apiHttp.post(`/v1/sessions/${sessionId}/compact`);
      if (res.ok) {
        _isUsingFallback = false;
        return res.data;
      }
    } catch (e) {
      handleClientError(e, { module: "services:session", action: "compact" });
      // 网络错误
    }
    logger.debug("compact 静默降级：API 不可用", { sessionId });
    return null;
  },

  // P2-22 同步：后端 prune 为全量修剪（无单会话实现），路由为 POST /v1/sessions/prune
  prune: async (): Promise<unknown | null> => {
    try {
      const res = await apiHttp.post(`/v1/sessions/prune`);
      if (res.ok) {
        _isUsingFallback = false;
        return res.data;
      }
    } catch (e) {
      handleClientError(e, { module: "services:session", action: "prune" });
      // 网络错误
    }
    logger.debug("prune 静默降级：API 不可用");
    return null;
  },

  getMemory: async (
    sessionId: string,
    query?: string,
    topK?: number,
  ): Promise<{ items: unknown[]; sessionId: string } | null> => {
    try {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (topK) params.set("topK", String(topK));
      const qs = params.toString();
      const url = `/v1/sessions/${sessionId}/memory${qs ? `?${qs}` : ""}`;
      const res = await apiHttp.get<{ items: unknown[]; sessionId: string }>(
        url,
      );
      if (res.ok) {
        _isUsingFallback = false;
        return res.data as { items: unknown[]; sessionId: string } | null;
      }
    } catch (e) {
      handleClientError(e, { module: "services:session", action: "getMemory" });
      // 网络错误
    }
    logger.debug("getMemory 静默降级：API 不可用", { sessionId });
    return null;
  },
};
