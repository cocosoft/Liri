/**
 * ChatCoordinator — 会话生命周期协调器
 *
 * 在 sessionSlice 和 chat store 之间建立单向依赖，消除 10+ 处
 * `await import("@/stores/chat")` 分散引用。
 *
 * 通过懒加载 getChatStore() 避免模块级循环依赖（chat → chatCoordinator → chat）。
 * 首次调用时一次性解析，后续调用复用缓存的 getter。
 */
import type { Message } from "@/types";
import type { ChatState } from "./index";

// ─── 懒加载 chat store ─────────────────────────────────
// 不能直接从 ./index 静态 import useChatStore，因为会导致模块循环：
//   sessionSlice → chatCoordinator → chat/index → chat-message → chatCoordinator

let _chatStoreGetter: (() => ChatState) | null = null;

async function _ensureChatStore(): Promise<() => ChatState> {
  if (!_chatStoreGetter) {
    const mod = await import("./index");
    _chatStoreGetter = () => mod.useChatStore.getState();
  }
  return _chatStoreGetter;
}

// ─── 公开 API ──────────────────────────────────────────

export const chatCoordinator = {
  /** 停止当前流式响应 */
  async stopMessage(): Promise<void> {
    const getChat = await _ensureChatStore();
    getChat().stopMessage();
  },

  /** 安全停止流 + 落盘待保存 blocks，返回当前消息快照 */
  async stopAndFlush(): Promise<Message[]> {
    const getChat = await _ensureChatStore();
    const chat = getChat();
    const sid = chat.messages[0]?.session_id ?? "";
    // 阶段2：挂起中的流不中止（切会话不杀 paused —— 等后端恢复自动续传，
    // 避免切走再切回进度丢失）；但仍需 flush 待保存 blocks（写前持久化）。
    // 挂起流只能由用户点"停止/放弃"（stopMessageImpl 的 paused 分支）显式放弃。
    if (!(sid && chat.pausedStreams[sid])) {
      chat.stopMessage();
    }
    await chat.flushPendingSaves();
    return chat.messages;
  },

  /** 阶段2: 放弃指定会话的挂起流（删除会话前调用，防止挂起等待者/控制器/ghostCheck 定时器泄漏） */
  async abortPausedStream(sessionId: string): Promise<void> {
    const getChat = await _ensureChatStore();
    getChat().abortPausedStream(sessionId);
  },

  /** 加载新会话消息到 chat store */
  async loadMessages(messages: Message[]): Promise<void> {
    const getChat = await _ensureChatStore();
    getChat().setMessages(messages);
  },

  /** 清空当前消息 */
  async clearMessages(): Promise<void> {
    const getChat = await _ensureChatStore();
    getChat().clearMessages();
  },
};
