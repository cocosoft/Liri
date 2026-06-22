/**
 * 会话-聊天协调器
 *
 * 负责 sessionStore 和 chatStore 之间的跨 store 协调，
 * 避免两者直接互相引用导致的循环依赖（chatStore ⇄ sessionStore）。
 *
 * 使用方式：两个 store 分别注册自己的访问接口，通过本模块交换数据。
 * 注册必须在 store 创建时完成，以确保协调器可用。
 */
import type { Session, Message } from "../types";

// ============================================================
// Chat 端操作（由 chatStore 注册，供 sessionStore 调用）
// ============================================================

interface ChatOperations {
  clearMessages: () => void;
  stopMessage: () => void;
  flushPendingSaves: () => Promise<void>;
  setMessages: (messages: Message[]) => void;
}

let _chatOps: ChatOperations | null = null;

/** 注册 chat 端操作（由 chatStore 在创建时调用） */
export function registerChatOperations(ops: ChatOperations): void {
  _chatOps = ops;
}

export function chatCoordinator(): ChatOperations {
  if (!_chatOps) {
    throw new Error(
      "sessionChatCoordinator: chat operations not registered. " +
        "Ensure chatStore is initialized before sessionStore.",
    );
  }
  return _chatOps;
}

// ============================================================
// Session 端操作（由 sessionStore 注册，供 chatStore 调用）
// ============================================================

interface SessionState {
  currentSession: Session | null;
  sessions: Session[];
}

interface SessionOperations {
  getState: () => SessionState;
  renameSession: (id: string, title: string) => void;
}

let _sessionOps: SessionOperations | null = null;

/** 注册 session 端操作（由 sessionStore 在创建时调用） */
export function registerSessionOperations(ops: SessionOperations): void {
  _sessionOps = ops;
}

export function sessionCoordinator(): SessionOperations {
  if (!_sessionOps) {
    throw new Error(
      "sessionChatCoordinator: session operations not registered. " +
        "Ensure sessionStore is initialized before chatStore.",
    );
  }
  return _sessionOps;
}
