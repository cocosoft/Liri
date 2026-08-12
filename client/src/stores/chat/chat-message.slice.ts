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
} from "./chat-message-actions";

const logger = createLogger("stores:chat:message");

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

    regenerateMessage: async (sessionId?: string) => {
      await regenerateMessageImpl(messageSet, messageGet, sessionId);
    },

    retryFromError: async (assistantMsgId: string, sessionId?: string) => {
      await retryFromErrorImpl(
        messageSet,
        messageGet,
        assistantMsgId,
        sessionId,
      );
    },

    clearMessages: () => {
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
  };
};
