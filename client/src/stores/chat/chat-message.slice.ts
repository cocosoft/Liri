/**
 * Chat Message Slice — 消息发送、流式响应、队列管理
 *
 * 核心 slice，包含流式聊天的主要逻辑。
 * 使用 Zustand StateCreator 模式。
 *
 * 大方法实现已拆出（R04-001 文件行数限制治理）：
 *   - sendMessage  → chat-message-send.ts（sendMessageImpl）
 *   - streamMessage → chat-message-stream.ts（streamMessageImpl）
 *   - setMessages  → chat-message-set-messages.ts（setMessagesImpl）
 *   - 其余操作     → chat-message-actions.ts（*Impl）
 * 本文件仅保留状态定义、简单方法与委托。
 */
import type { StateCreator } from "zustand";
import type { Message } from "@/types";
import type { FileSlice } from "./chat-file.slice";
import { createLogger } from "@/utils/logger";
import { handleClientError } from "@/utils/handleError";
import { truncateMessages } from "@/services/chatService";
import { connectionMonitor } from "@/services/connectionMonitor";
import { resolveResumeWaiter } from "@/services/streamPause";
import type {
  MessageSlice,
  MessageSet,
  MessageGet,
} from "./chat-message.types";
import { sendMessageImpl } from "./chat-message-send";
import { streamMessageImpl } from "./chat-message-stream";
import { setMessagesImpl } from "./chat-message-set-messages";
import {
  regenerateMessageImpl,
  retryFromErrorImpl,
  stopMessageImpl,
  flushPendingSavesImpl,
  deleteMessageImpl,
  rollbackToMessageImpl,
  restoreRollbackImpl,
  checkAbortRecoveryImpl,
  dismissRecoveryImpl,
  resumeRecoveryImpl,
  continueGenerationImpl,
} from "./chat-message-actions";

const logger = createLogger("stores:chat:message");

/** 阶段2：后端恢复后自动续传的倒计时（毫秒，可被手动"立即恢复"/"放弃"抢先取消） */
const AUTO_RESUME_DELAY_MS = 3_000;
/** N8-1：挂起期间自动恢复的 /health 探测间隔（毫秒）——覆盖 <30s 最短掉线场景 */
const AUTO_RESUME_POLL_MS = 3_000;

/** 从 pausedStreams Record 中移除指定会话的暂停记录 */
function omitPausedKey(
  map: MessageSlice["pausedStreams"],
  key: string,
): MessageSlice["pausedStreams"] {
  const next = { ...map };
  delete next[key];
  return next;
}

export type { MessageSlice } from "./chat-message.types";
export { getToolResultFull } from "./chat-message-shared";

/**
 * 创建 Message Slice（Zustand StateCreator 模式）
 */
export const createMessageSlice: StateCreator<
  MessageSlice & FileSlice,
  [],
  [],
  MessageSlice
> = (set, get) => {
  const messageSet: MessageSet = set;
  const messageGet: MessageGet = get;

  // 阶段2：后端恢复 → 挂起流自动续传（全局只订阅一次，惰性注册）
  let autoResumeSubscribed = false;
  /** N8-1：<30s 最短掉线场景的兜底轮询定时器（见 ensureAutoResumeListener） */
  let autoResumePollTimer: ReturnType<typeof setInterval> | null = null;

  /** 进入自动恢复倒计时（phase → recovering，3s 后自动续传；手动恢复/放弃可抢先） */
  function triggerAutoResume(): void {
    const paused = get().pausedStreams;
    const ids = Object.keys(paused);
    if (ids.length === 0) return;
    logger.info("connectionMonitor:后端恢复，挂起流进入自动恢复倒计时", {
      sessions: ids,
    });
    // 倒计时期间 phase → recovering（Banner 显示"正在自动恢复…"）
    const nextPaused: MessageSlice["pausedStreams"] = {};
    for (const [sid, p] of Object.entries(paused)) {
      nextPaused[sid] = { ...p, phase: "recovering" };
    }
    set({ pausedStreams: nextPaused });
    // 3 秒倒计时后自动续传；期间用户点"立即恢复"/"放弃"会抢先结算（resumeStream 幂等）
    setTimeout(() => {
      for (const sid of ids) {
        get().resumeStream(sid);
      }
    }, AUTO_RESUME_DELAY_MS);
  }

  function ensureAutoResumeListener(): void {
    // ① >30s 掉线场景：状态机经历 DISCONNECTED→CONNECTED 转移 → onBackendUp 事件驱动
    if (!autoResumeSubscribed) {
      autoResumeSubscribed = true;
      connectionMonitor.onBackendUp(triggerAutoResume);
    }
    // ② N8-1：<30s 最短掉线场景——connectionMonitor 健康检查 10s×3 才判定 DISCONNECTED，
    // 后端 5-15s 内恢复时状态机从未转移，onBackendUp 不触发。pausedStreams 非空时
    // 每 3s 主动探测 /health，通过即自动恢复（不完全依赖状态转移事件）。
    if (!autoResumePollTimer) {
      autoResumePollTimer = setInterval(async () => {
        const ids = Object.keys(get().pausedStreams);
        if (ids.length === 0) {
          clearInterval(autoResumePollTimer!);
          autoResumePollTimer = null;
          return;
        }
        const healthy = await connectionMonitor.healthCheckOnce();
        if (healthy) {
          logger.info("autoResumePoll:健康检查通过，触发自动恢复", {
            sessions: ids,
          });
          clearInterval(autoResumePollTimer!);
          autoResumePollTimer = null;
          triggerAutoResume();
        }
      }, AUTO_RESUME_POLL_MS);
    }
  }

  return {
    messages: [],
    isSending: false,
    isInputBlocked: false,
    isStreaming: false,
    streamingStatus: "",
    executionPhase: null,
    error: null,
    errorCode: null,
    replyMessage: null,
    pendingReplyToId: null,
    editTarget: null,
    streamControllers: {},
    messageQueue: [],
    rollbackSnapshot: null,
    hasPendingQuestion: {},
    recoverySessionId: null,
    pausedStreams: {},

    addMessage: (message: Message) => {
      set({ messages: [...get().messages, message] });
    },

    sendMessage: async (
      content: string,
      sessionId?: string,
      images?: import("@/types").AttachedImage[],
    ) => {
      await sendMessageImpl(messageSet, messageGet, content, sessionId, images);
    },

    enqueueMessage: (content: string, sessionId?: string) => {
      // 仅在有会话时入队；无会话直接忽略（无会话无流可等）
      if (!sessionId && !get().messages[0]?.session_id) {
        logger.debug("enqueueMessage: 无活动会话，忽略入队");
        return;
      }
      set({
        messageQueue: [
          ...get().messageQueue,
          { content, sessionId: sessionId || get().messages[0]?.session_id },
        ],
      });
    },

    dequeueAndSend: async (sessionId?: string) => {
      const queue = get().messageQueue;
      if (queue.length === 0) return;
      const next = queue[0];
      set({ messageQueue: queue.slice(1) });
      await sendMessageImpl(
        messageSet,
        messageGet,
        next.content,
        next.sessionId || sessionId,
      );
    },

    streamMessage: async (
      content: string,
      sessionId?: string,
      workMode?: "plan" | "do",
      attachedImages?: import("@/types").AttachedImage[],
      existingUserMessageId?: string,
    ) => {
      await streamMessageImpl(
        messageSet,
        messageGet,
        content,
        sessionId,
        workMode,
        attachedImages,
        existingUserMessageId,
      );
    },

    regenerateMessage: async (assistantMsgId: string, sessionId?: string) => {
      await regenerateMessageImpl(
        messageSet,
        messageGet,
        assistantMsgId,
        sessionId,
      );
    },

    retryFromError: async (assistantMsgId: string, sessionId?: string) => {
      await retryFromErrorImpl(
        messageSet,
        messageGet,
        assistantMsgId,
        sessionId,
      );
    },

    continueGeneration: async (
      assistantMsgId: string,
      sessionId?: string,
      prompt?: string,
    ) => {
      await continueGenerationImpl(
        messageSet,
        messageGet,
        assistantMsgId,
        sessionId,
        prompt,
      );
    },

    clearMessages: () => {
      set({ messages: [], error: null, errorCode: null });
    },

    // R-A 修复：清空当前会话需同步后端，否则切走再切回"消息复活"。
    // 后端无"清空单会话"端点，复用 truncateMessages(首条消息 id) 删除全部。
    clearSessionMessages: async () => {
      const messages = get().messages;
      const first = messages[0];
      const sessionId = first?.session_id;
      if (sessionId && first?.id) {
        await truncateMessages(sessionId, first.id).catch((e) => {
          handleClientError(
            e,
            {
              module: "stores:chat:message",
              action: "clearSessionMessages",
            },
            "warn",
          );
        });
      }
      set({ messages: [], error: null, errorCode: null });
    },

    setMessages: (messages: Message[]) => {
      setMessagesImpl(messageSet, messageGet, messages);
    },

    setReplyMessage: (replyMessage: Message | null) => {
      set({ replyMessage });
    },

    setEditTarget: (editTarget: Message | null) => {
      set({ editTarget });
    },

    stopMessage: () => {
      stopMessageImpl(messageSet, messageGet);
    },

    flushPendingSaves: async () => {
      await flushPendingSavesImpl(messageSet, messageGet);
    },

    deleteMessage: async (messageId: string) => {
      await deleteMessageImpl(messageSet, messageGet, messageId);
    },

    rollbackToMessage: async (messageId: string) => {
      return rollbackToMessageImpl(messageSet, messageGet, messageId);
    },

    restoreRollback: () => {
      restoreRollbackImpl(messageSet, messageGet);
    },

    checkAbortRecovery: async (sessionId: string) => {
      return checkAbortRecoveryImpl(messageSet, messageGet, sessionId);
    },

    dismissRecovery: () => {
      dismissRecoveryImpl(messageSet, messageGet);
    },

    resumeRecovery: (sessionId: string) => {
      resumeRecoveryImpl(messageSet, messageGet, sessionId);
    },

    // ── 阶段2 断连挂起-恢复 ──
    pauseStream: (sessionId: string) => {
      if (get().pausedStreams[sessionId]) return; // 已挂起，幂等
      ensureAutoResumeListener();
      logger.warn("pauseStream: 会话流已挂起", { sessionId });
      // N8-2：把 controller 移出 streamControllers 存入 pausedStreams——
      // 挂起流从全局 isStreaming 推导中排除（Object.keys(streamControllers)），
      // 避免阻塞其他会话的输入/消息队列；abort/resume 时从 pausedStreams 取用。
      const controller = get().streamControllers[sessionId];
      const nextControllers = { ...get().streamControllers };
      delete nextControllers[sessionId];
      set({
        streamControllers: nextControllers,
        // N8-3：状态栏文案同步（避免与 Banner"已暂停"并存矛盾；恢复后由流式链路重置）
        streamingStatus: "后端连接已断开，回复已暂停",
        pausedStreams: {
          ...get().pausedStreams,
          [sessionId]: { since: Date.now(), phase: "waiting", controller },
        },
      });
    },

    resumeStream: (sessionId: string) => {
      const paused = get().pausedStreams[sessionId];
      if (!paused) return; // 未挂起/已恢复，幂等
      const resolved = resolveResumeWaiter(sessionId);
      logger.info("resumeStream: 恢复挂起流", { sessionId, resolved });
      // N8-2：恢复后把 controller 归还 streamControllers（流继续，全局 isStreaming 恢复）
      const restored = paused.controller
        ? { ...get().streamControllers, [sessionId]: paused.controller }
        : get().streamControllers;
      set({
        streamControllers: restored,
        pausedStreams: omitPausedKey(get().pausedStreams, sessionId),
      });
    },

    abortPausedStream: (sessionId: string) => {
      const paused = get().pausedStreams[sessionId];
      if (!paused) return; // 未挂起，幂等
      // 先中止控制器（同步置 aborted），再以 resolve 解除挂起等待——
      // 生成器恢复后立即命中已中止的 signal 抛 AbortError 干净退出（正常结束路径，
      // 不抛错），避免"放弃"被当作真实异常记录错误跟踪器、不触发检查点恢复逻辑。
      paused.controller?.abort();
      const resolved = resolveResumeWaiter(sessionId);
      logger.warn("abortPausedStream: 放弃挂起流", { sessionId, resolved });
      set({
        pausedStreams: omitPausedKey(get().pausedStreams, sessionId),
      });
    },
  };
};
