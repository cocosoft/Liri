/**
 * Chat Message Slice — 消息操作实现（regenerate / retry / stop / delete / rollback / recovery）
 *
 * 从 chat-message.slice.ts 拆出（R04-001 文件行数限制治理）。
 * 均为围绕 messages 的轻量操作，通过 set/get 读写 store。
 */
import { sessionService } from "@/services/sessionService";
import { truncateMessages } from "@/services/chatService";
import { useFeatureFlagStore } from "@/stores/featureFlags";
import { handleClientError } from "@/utils/handleError";
import { createLogger } from "@/utils/logger";
import { removeStreamController } from "./chat-message-shared";
import { getHasPendingSave, flushSaveBlocks } from "./chat-history.slice";
import type { MessageSet, MessageGet } from "./chat-message.types";

const logger = createLogger("stores:chat:message");

/** 保存中止恢复检查点（fire-and-forget，供 stopMessage 使用） */
function saveAbortCheckpoint(sessionId: string): void {
  // M2 修复（2026-08-13）：改用 buildAuthHeaders（X-API-Key + Bearer 双注入）——
  // 原实现只注入 X-API-Key，登录态（M0d）下缺 Bearer 恒 401，中止恢复检查点保存失效。
  import("../../services/chatService")
    .then(async ({ buildAuthHeaders }) => {
      const { getBackendBaseUrl } = await import("../../services/backendUrl");
      fetch(
        `${getBackendBaseUrl()}/v1/sessions/${sessionId}/checkpoints/latest`,
        {
          method: "POST",
          headers: buildAuthHeaders(),
          body: JSON.stringify({
            label: `abort_${Date.now()}`,
            autoCreated: true,
            metadata: { abortRecovery: true },
          }),
        },
      ).catch((err) => {
        handleClientError(
          err,
          {
            module: "stores:chat:message",
            action: "stopMessage:saveCheckpoint",
          },
          "warn",
        );
      });
    })
    .catch(() => {
      /* backendUrl 动态加载失败，静默忽略 */
    });
}

/** 检测工作模式：若当前工作项活跃，传递 Plan/Do 模式到后端 */
async function resolveWorkMode(): Promise<"plan" | "do" | undefined> {
  try {
    const { useWorkStore } = await import("../workStore");
    const workState = useWorkStore.getState();
    if (workState.activeWorkItem) {
      return workState.mode;
    }
  } catch (err) {
    handleClientError(
      err,
      {
        module: "stores:chat:message",
        action: "resolveWorkMode",
      },
      "warn",
    );
  }
  return undefined;
}

/**
 * 重新生成指定 AI 回复（#2 修复）：
 * 原实现忽略点击哪条、永远找"最后一条 user 消息"截断重发——对历史消息点
 * 重新生成会误删其后所有对话（数据丢失），且重发的是最后一条回复。
 * 现在基于点击的 assistant 消息 id 定位其前置用户消息，只截断到该条。
 */
export async function regenerateMessageImpl(
  set: MessageSet,
  get: MessageGet,
  assistantMsgId?: string,
  sessionId?: string,
): Promise<void> {
  const { messages, isStreaming } = get();

  // 边界条件1：防止重复生成（流式输出中）
  if (isStreaming) {
    logger.warn("regenerateMessage: 流式输出中，忽略重新生成请求");
    return;
  }

  if (messages.length < 2) return;

  // 定位目标用户消息：优先基于点击的 assistant 消息向前找
  let targetUserIdx = -1;
  if (assistantMsgId) {
    const aiIdx = messages.findIndex((m) => m.id === assistantMsgId);
    if (aiIdx !== -1) {
      for (let i = aiIdx - 1; i >= 0; i--) {
        if (messages[i].role === "user") {
          targetUserIdx = i;
          break;
        }
      }
    }
  }
  // 兼容未传 assistantMsgId 的调用方：回退到最后一条 user 消息
  if (targetUserIdx === -1) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        targetUserIdx = i;
        break;
      }
    }
  }
  if (targetUserIdx === -1) return;

  const userMsg = messages[targetUserIdx];
  const content = typeof userMsg.content === "string" ? userMsg.content : "";

  // 边界条件2：空消息不重新生成
  if (!content.trim()) {
    logger.warn("regenerateMessage: 用户消息为空，跳过重新生成");
    return;
  }

  // 边界条件3：中止本会话的旧流（P2-2: 只影响本会话）
  const sid = sessionId || messages[0]?.session_id || "default";
  const prevController = get().streamControllers[sid];
  if (prevController) {
    prevController.abort();
  }

  // 移除目标 user 消息之后的 AI 回复（含可能的部分生成空消息），然后重新发送
  const truncated = messages.slice(0, targetUserIdx + 1);
  const nextControllers = removeStreamController(get().streamControllers, sid);
  set({
    messages: truncated,
    isStreaming: Object.keys(nextControllers).length > 0,
    isSending: false,
    isInputBlocked: false,
    streamControllers: nextControllers,
  });

  // AB-13 修复：同步截断后端持久化消息（regenerate 场景）。
  // fire-and-forget 不阻塞重新生成；旧流刚 abort，后端流式标记可能未清，
  // 若返回 409 仅记录日志，不影响本轮回显（下一轮编辑/重载时再截断）。
  truncateMessages(sid, userMsg.id).catch((e) =>
    handleClientError(
      e,
      { module: "stores:chat:message", action: "regenerateTruncate" },
      "warn",
    ),
  );

  // 检测工作模式：若当前工作项活跃，传递 Plan/Do 模式到后端
  const workMode = await resolveWorkMode();

  try {
    await get().streamMessage(
      content,
      sessionId || userMsg.session_id,
      workMode,
      undefined,
      userMsg.id, // AB-4 修复：复用原用户消息 id，避免重复显示/双写
    );
  } catch (error) {
    handleClientError(
      error,
      { module: "stores:chat:message", action: "regenerateMessage" },
      "warn",
    );
    set({
      error: String(error),
      isSending: false,
      isInputBlocked: false,
      isStreaming: Object.keys(get().streamControllers).length > 0,
    });
  }
}

/**
 * 重试出错的请求：传入出错的 assistant 消息 ID，找到前置用户消息重新发送
 */
export async function retryFromErrorImpl(
  set: MessageSet,
  get: MessageGet,
  assistantMsgId: string,
  sessionId?: string,
): Promise<void> {
  const { messages, isStreaming } = get();

  // 边界条件1：防止重复重试（流式输出中）
  if (isStreaming) {
    logger.warn("retryFromError: 流式输出中，忽略重试请求");
    return;
  }

  const aiIdx = messages.findIndex((m) => m.id === assistantMsgId);
  if (aiIdx === -1) return;

  // 向前找到最近的一条 user 消息
  let userMsgIdx = -1;
  for (let i = aiIdx - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      userMsgIdx = i;
      break;
    }
  }
  if (userMsgIdx === -1) return;

  const userMsg = messages[userMsgIdx];
  const content = typeof userMsg.content === "string" ? userMsg.content : "";

  // 边界条件2：空消息不重试
  if (!content.trim()) {
    logger.warn("retryFromError: 用户消息为空，跳过重试");
    return;
  }

  // 边界条件3：中止本会话的旧流（P2-2: 只影响本会话）
  const sid = sessionId || messages[0]?.session_id || "default";
  const prevController = get().streamControllers[sid];
  if (prevController) {
    prevController.abort();
  }

  // 移除该用户消息及其之后的所有消息（含可能的部分生成空消息），然后重新发送
  const truncated = messages.slice(0, userMsgIdx + 1);
  const nextControllers = removeStreamController(get().streamControllers, sid);
  set({
    messages: truncated,
    isStreaming: Object.keys(nextControllers).length > 0,
    isSending: false,
    isInputBlocked: false,
    streamControllers: nextControllers,
  });

  // AB-13 修复：同步截断后端持久化消息（retry 场景），同 regenerate 一致
  truncateMessages(sid, userMsg.id).catch((e) =>
    handleClientError(
      e,
      { module: "stores:chat:message", action: "retryTruncate" },
      "warn",
    ),
  );

  try {
    // 修复 BUG F3: 检测工作模式，传递给 streamMessage
    const workMode = await resolveWorkMode();
    await get().streamMessage(
      content,
      sessionId || userMsg.session_id,
      workMode,
      undefined,
      userMsg.id, // AB-4 修复：复用原用户消息 id，避免重复显示/双写
    );
  } catch (error) {
    handleClientError(
      error,
      { module: "stores:chat:message", action: "retryFromError" },
      "warn",
    );
    set({
      error: String(error),
      isSending: false,
      isInputBlocked: false,
      isStreaming: Object.keys(get().streamControllers).length > 0,
    });
  }
}

/**
 * B-C1 修复：真「继续生成」——以点击的 AI 消息为回复引用，自动发送"请继续"指令，
 * 后端以整轮对话（含该消息）为上下文，AI 接着输出（区别于旧"仅设为引用、需用户自己输入"）。
 */
export async function continueGenerationImpl(
  set: MessageSet,
  get: MessageGet,
  assistantMsgId: string,
  sessionId?: string,
  prompt?: string,
): Promise<void> {
  const { messages, isStreaming } = get();

  // 边界条件1：流式输出中（含其他会话并行流）忽略，防重复生成
  if (isStreaming) {
    logger.warn("continueGeneration: 流式输出中，忽略继续生成请求");
    return;
  }

  const aiMsg = messages.find((m) => m.id === assistantMsgId);
  if (!aiMsg || aiMsg.role !== "assistant") return;

  const sid = sessionId || aiMsg.session_id || messages[0]?.session_id;
  if (!sid) return;

  // 以该 AI 消息为回复引用（用户消息带 replyToId，AI 可见引用内容），
  // pendingReplyToId 由 streamMessageImpl 消费后自动清空
  set({ pendingReplyToId: assistantMsgId });

  try {
    await get().streamMessage(prompt || "请继续", sid);
  } catch (error) {
    handleClientError(
      error,
      { module: "stores:chat:message", action: "continueGeneration" },
      "warn",
    );
    set({
      error: String(error),
      isSending: false,
      isInputBlocked: false,
      isStreaming: Object.keys(get().streamControllers).length > 0,
    });
  }
}

/**
 * 取消当前流式请求（J1）
 */
export function stopMessageImpl(set: MessageSet, get: MessageGet): void {
  // P2-2: 仅中止当前 UI 会话的流，其他会话流不受影响
  const state = get();
  const sessionId = state.messages[0]?.session_id ?? "";
  const controller = sessionId ? state.streamControllers[sessionId] : undefined;
  if (controller) {
    // 阶段2：挂起中的流 —— 用户点停止 = 放弃本次回复
    // （终止挂起等待 + 中止控制器 + 清理暂停状态；不进入下方普通 abort 路径，
    //  避免检查点恢复提示与"放弃"语义冲突）
    if (sessionId && state.pausedStreams[sessionId]) {
      logger.warn("stopMessage: 挂起中的流被用户放弃", { sessionId });
      get().abortPausedStream(sessionId);
      return;
    }

    // P2-6: 保存中止恢复点（fire-and-forget，不阻塞 UI）
    if (sessionId) {
      const assistantMsg = [...state.messages]
        .reverse()
        .find((m) => m.role === "assistant");
      if (assistantMsg) {
        saveAbortCheckpoint(sessionId);
      }
    }

    controller.abort();
    const nextControllers = removeStreamController(
      get().streamControllers,
      sessionId,
    );
    set({
      isStreaming: Object.keys(nextControllers).length > 0,
      isSending: false,
      isInputBlocked: false,
      streamingStatus: "",
      streamControllers: nextControllers,
    });
    // 消息排队：停止后也消费队列
    const messageQueueEnabled =
      useFeatureFlagStore.getState().flags.message_queue;
    if (messageQueueEnabled && get().messageQueue.length > 0) {
      get()
        .dequeueAndSend()
        .catch((e) =>
          handleClientError(
            e,
            { module: "stores:chat:message", action: "stopMessage:dequeue" },
            "warn",
          ),
        );
    }
  }
}

/**
 * 立即 flush 待保存的 blocks（用于切换会话前）
 * 避免防抖窗口内的 blocks 丢失导致下次进入历史时出现块割裂
 */
export async function flushPendingSavesImpl(
  _set: MessageSet,
  _get: MessageGet,
): Promise<void> {
  if (getHasPendingSave()) {
    // 超时保护：最多等待 3 秒，防止 HTTP 挂起阻塞会话切换（方案 C）
    const timeout = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error("flushPendingSaves 超时")), 3000),
    );
    await Promise.race([flushSaveBlocks(), timeout]).catch((err) => {
      handleClientError(
        err,
        { module: "stores:chat:message", action: "flushPendingSaves" },
        "warn",
      );
    });
  }
}

/**
 * 删除单条消息（乐观更新 + 失败回滚）
 */
export async function deleteMessageImpl(
  set: MessageSet,
  get: MessageGet,
  messageId: string,
): Promise<void> {
  const { messages, isStreaming } = get();

  if (isStreaming) {
    logger.warn("deleteMessage: 流式输出中，忽略删除请求");
    return;
  }

  const targetMsg = messages.find((m) => m.id === messageId);
  if (!targetMsg || targetMsg.role !== "user") {
    logger.warn("deleteMessage: 目标消息不存在或非用户消息");
    return;
  }

  const sessionId = targetMsg.session_id;
  if (!sessionId) {
    logger.warn("deleteMessage: 消息缺少 session_id");
    return;
  }

  // 快照用于失败回滚
  const prev = [...messages];
  set({ messages: messages.filter((m) => m.id !== messageId) });

  try {
    await sessionService.deleteMessage(sessionId, messageId);
  } catch (err) {
    handleClientError(
      err,
      { module: "stores:chat:message", action: "deleteMessage" },
      "warn",
    );
    // 回滚 UI
    set({ messages: prev });
    throw err;
  }
}

/**
 * 回退到指定消息之前（截断此处及之后所有消息）
 */
export async function rollbackToMessageImpl(
  set: MessageSet,
  get: MessageGet,
  messageId: string,
) {
  const { messages, isStreaming } = get();

  if (isStreaming) {
    logger.warn("rollbackToMessage: 流式输出中，忽略回退请求");
    return { messages: [], remainingRollbacks: -1 };
  }

  const index = messages.findIndex((m) => m.id === messageId);
  if (index === -1 || messages[index].role !== "user") {
    logger.warn("rollbackToMessage: 目标消息不存在或非用户消息");
    return { messages: [], remainingRollbacks: -1 };
  }

  const sessionId = messages[index].session_id;
  if (!sessionId) {
    logger.warn("rollbackToMessage: 消息缺少 session_id");
    return { messages: [], remainingRollbacks: -1 };
  }

  // 快照用于失败回滚 + 撤销
  const prev = [...messages];
  set({ messages: messages.slice(0, index), rollbackSnapshot: prev });

  try {
    const res = await sessionService.truncateMessages(sessionId, messageId);
    return {
      messages: res.messages,
      remainingRollbacks: res.remainingRollbacks,
      undoResults: res.undoResults,
    };
  } catch (err) {
    handleClientError(
      err,
      { module: "stores:chat:message", action: "rollbackToMessage" },
      "warn",
    );
    // 回滚 UI
    set({ messages: prev, rollbackSnapshot: null });
    throw err;
  }
}

/**
 * 撤销最近一次回退（恢复快照中的消息）
 */
export function restoreRollbackImpl(set: MessageSet, get: MessageGet): void {
  const snapshot = get().rollbackSnapshot;
  if (!snapshot) return;
  set({ messages: snapshot, rollbackSnapshot: null });
}

/**
 * P2-6: 检查是否有可恢复的中止检查点
 * 如果存在 abortRecovery 检查点，设置 recoverySessionId 以触发 UI 提示
 * @returns true 如果有待恢复的检查点（调用方应停止发送并等待用户确认）
 */
export async function checkAbortRecoveryImpl(
  set: MessageSet,
  _get: MessageGet,
  sessionId: string,
): Promise<boolean> {
  try {
    // M2 修复：改用 buildAuthHeaders（X-API-Key + Bearer 双注入），登录态下恢复检查点查询不再 401
    const { buildAuthHeaders } = await import("../../services/chatService");
    const { getBackendBaseUrl } = await import("../../services/backendUrl");
    const resp = await fetch(
      `${getBackendBaseUrl()}/v1/sessions/${sessionId}/checkpoints/latest`,
      { headers: buildAuthHeaders() },
    );
    if (!resp.ok) return false;
    const data = await resp.json();
    if (data?.metadata?.abortRecovery) {
      set({ recoverySessionId: sessionId });
      return true;
    }
  } catch {
    // 检查点查询失败静默处理
  }
  return false;
}

/** P2-6: 关闭恢复提示并清理 abortRecovery 标记 */
export function dismissRecoveryImpl(set: MessageSet, get: MessageGet): void {
  const sid = get().recoverySessionId;
  set({ recoverySessionId: null });
  if (sid) {
    // M2 修复：改用 buildAuthHeaders（X-API-Key + Bearer 双注入），登录态下删除检查点不再 401
    import("../../services/chatService")
      .then(async ({ buildAuthHeaders }) => {
        const { getBackendBaseUrl } = await import("../../services/backendUrl");
        fetch(`${getBackendBaseUrl()}/v1/sessions/${sid}/checkpoints/latest`, {
          method: "DELETE",
          headers: buildAuthHeaders(),
        }).catch(() => {});
      })
      .catch(() => {
        /* chatService 动态加载失败，静默忽略 */
      });
  }
}

/** P2-6: 用户确认恢复 — 关闭提示，允许下一条消息通过 */
export function resumeRecoveryImpl(
  set: MessageSet,
  _get: MessageGet,
  _sessionId: string,
): void {
  set({ recoverySessionId: null });
  // 不清除后端检查点 — resume 端点需要它来恢复生成器状态
}
