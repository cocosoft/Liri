/**
 * Chat Message Slice — sendMessage 实现
 *
 * 从 chat-message.slice.ts 拆出（R04-001 文件行数限制治理）。
 * sendMessage：非流式发送路径（写前持久化 + outbox 补发 + 自动重命名）。
 */
import type { Message } from "@/types";
import {
  chatService,
  enqueueOutbox,
  clearOutboxForSession,
} from "@/services/chatService";
import { useFeatureFlagStore } from "@/stores/featureFlags";
import { ChronologicalBlockBuilder } from "./chat-toolcall.slice";
import { staleSessionCache } from "./chat-history.slice";
import { handleClientError } from "@/utils/handleError";
import { createLogger } from "@/utils/logger";
import type { MessageSet, MessageGet } from "./chat-message.types";

const logger = createLogger("stores:chat:message");

/**
 * sendMessage：非流式发送（同步等待响应，多用于离线/测试路径）
 * 写前持久化：发送前先落盘用户消息，失败进 outbox，网络恢复后自动补发。
 */
export async function sendMessageImpl(
  set: MessageSet,
  get: MessageGet,
  content: string,
  sessionId?: string,
  images?: import("@/types").AttachedImage[],
): Promise<void> {
  // P2-6: 检查是否有可恢复的中止检查点
  const state = get();
  const currentSid = sessionId ?? state.messages[0]?.session_id ?? "";
  if (currentSid) {
    const hasRecovery = await get().checkAbortRecovery(currentSid);
    if (hasRecovery) {
      return; // 等待用户确认恢复或拒绝
    }
  }

  // 阶段2：该会话存在挂起流 —— 拦截发送（需先"立即恢复"或"放弃本次回复"）
  if (currentSid && get().pausedStreams[currentSid]) {
    logger.warn("sendMessage: 会话存在挂起流，拦截发送", {
      sessionId: currentSid,
    });
    return;
  }

  // 消息排队模式：流式输出中不阻塞，加入队列
  const messageQueueEnabled =
    useFeatureFlagStore.getState().flags.message_queue;
  if (messageQueueEnabled && get().isStreaming) {
    get().enqueueMessage(content, sessionId);
    return;
  }

  // 标记当前 session 缓存为 stale（发送新消息后缓存将过期）
  if (currentSid) staleSessionCache(currentSid);

  set({
    isSending: true,
    isInputBlocked: !messageQueueEnabled,
    error: null,
    errorCode: null,
  });

  const pendingReplyId = get().pendingReplyToId;
  const userMessage: Message = {
    id: crypto.randomUUID(),
    role: "user",
    content,
    timestamp: Date.now(),
    session_id: sessionId || "default",
    replyToId: pendingReplyId || undefined,
  };
  // 使用后清除
  if (pendingReplyId) {
    set({ pendingReplyToId: null });
  }

  set({ messages: [...get().messages, userMessage] });

  // 根因 B：写前持久化 — 发送前先落盘用户消息（防断网丢失）
  // 成功 → 后端按 messageId 幂等去重；失败 → 进 outbox，网络恢复后自动补发
  let writeAheadOk = false;
  let outboxed = false;
  try {
    await chatService.addMessage(userMessage.session_id, userMessage);
    writeAheadOk = true;
  } catch {
    // 落盘失败（断网/后端不可达）→ 暂存 outbox，不阻塞发送流程
    outboxed = true;
    enqueueOutbox(userMessage, userMessage.session_id);
  }

  try {
    const response = await chatService.sendMessage(content, sessionId, images, {
      messageId: writeAheadOk ? userMessage.id : undefined,
    });
    // 发送成功 → 后端已持久化该轮用户消息，清除该会话待补发消息（避免重复补发）
    if (outboxed) clearOutboxForSession(userMessage.session_id);

    // 检测非流式路径的待处理交互
    if (
      (response as Message & { pendingInteraction?: unknown })
        .pendingInteraction
    ) {
      const pi = (
        response as Message & {
          pendingInteraction: import("../../services/chatService").QuestionData;
        }
      ).pendingInteraction;
      const builder = new ChronologicalBlockBuilder();
      builder.addQuestion(pi);
      const blocks = builder.getBlocks();
      const questionMessage: Message = {
        id: response.id,
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        session_id: sessionId || "default",
        blocks,
      };
      set({
        messages: [...get().messages, questionMessage],
        isSending: false,
        isInputBlocked: false,
      });
      return;
    }

    const newMessages = [...get().messages, response];

    // 先重置 isSending/isInputBlocked，UI 立刻响应
    set({ messages: newMessages, isSending: false, isInputBlocked: false });

    // 非流式路径也持久化 blocks，避免下次全量加载时重建丢失结构
    const assistantMsg = response as Message;
    // P7: 非流式路径 blocks 重建 — 若后端返回 content 但无 blocks，构建 fallback text block
    if (
      assistantMsg.role === "assistant" &&
      !assistantMsg.blocks?.length &&
      assistantMsg.content
    ) {
      assistantMsg.blocks = [
        {
          id: `fallback-${assistantMsg.id}`,
          type: "text" as const,
          content: assistantMsg.content,
        },
      ];
    }
    if (assistantMsg.role === "assistant" && assistantMsg.blocks?.length) {
      chatService
        .updateMessageBlocks(
          sessionId || "default",
          assistantMsg.id,
          assistantMsg.blocks as unknown as Array<Record<string, unknown>>,
        )
        .catch((err) =>
          handleClientError(
            err,
            {
              module: "stores:chat:message",
              action: "sendMessage:saveBlocks",
            },
            "warn",
          ),
        );
    }

    // 自动重命名由后端 autoGenerateTitle 唯一负责（P1-4 消除双责任方竞态），
    // 前端仅响应 session:renamed SSE 刷新标题（P2-4）。
  } catch (error) {
    handleClientError(
      error,
      { module: "stores:chat:message", action: "sendMessage" },
      "warn",
    );
    set({
      error: String(error),
      errorCode:
        error instanceof Error &&
        (error.message.includes("fetch") || error.message.includes("connect"))
          ? "BACKEND_UNREACHABLE"
          : "UNKNOWN",
      isSending: false,
      isInputBlocked: false,
    });
  }
}
