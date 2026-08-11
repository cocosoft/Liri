/**
 * Chat Message Slice 类型定义
 *
 * 从 chat-message.slice.ts 拆出（R04-001 文件行数限制治理）。
 * 仅含 MessageSlice 接口，实现见 chat-message.slice.ts。
 */
import type { Message, AttachedImage } from "@/types";
import type { FileSlice } from "./chat-file.slice";
export interface MessageSlice {
  messages: Message[];
  isSending: boolean;
  isInputBlocked: boolean;
  isStreaming: boolean;
  /** 流式响应实时状态文本，用于 ChatInput 状态栏显示 */
  streamingStatus: string;
  /** 按会话记录是否有待回答的 question 块（P2-3：多会话并行互不串扰） */
  hasPendingQuestion: Record<string, boolean>;
  /** 执行阶段追踪数据，由后端 ExecutionPhaseTracker 通过流式事件推送 */
  executionPhase: {
    phase:
      | "analyzing"
      | "designing"
      | "implementing"
      | "verifying"
      | "presenting"
      | null;
    progress: number;
    description: string;
  } | null;
  error: string | null;
  /** 结构化错误码 — SSE 协议增强 (CS02)，替代 ChatArea 字符串匹配 */
  errorCode: string | null;
  replyMessage: Message | null;
  /** 待设置的回复引用 ID（streamMessage 中创建用户消息时读取） */
  pendingReplyToId: string | null;
  /** 正在编辑的消息（用户消息） */
  editTarget: Message | null;
  /**
   * 流控制器索引（P2-2 多会话并行）：sessionId → AbortController。
   * 取代原单一 abortController —— 不同会话的流互不中止，可并行流式。
   */
  streamControllers: Record<string, AbortController>;
  /** 消息队列：流式输出中用户发送的新消息（放开输入限制后使用） */
  messageQueue: Array<{ content: string; sessionId?: string }>;
  /** P2-6: 中止恢复提示 — 上次任务被中止，有可恢复的检查点 */
  recoverySessionId: string | null;

  addMessage: (message: Message) => void;
  sendMessage: (content: string, sessionId?: string) => Promise<void>;
  /** 将消息加入队列（流式输出中不阻塞输入） */
  enqueueMessage: (content: string, sessionId?: string) => void;
  /** 消费队列中的下一条消息 */
  dequeueAndSend: (sessionId?: string) => Promise<void>;
  streamMessage: (
    content: string,
    sessionId?: string,
    workMode?: "plan" | "do",
    attachedImages?: AttachedImage[],
    existingUserMessageId?: string,
  ) => Promise<void>;
  /** 重新生成上一条 AI 消息 */
  regenerateMessage: (sessionId?: string) => Promise<void>;
  /** 在出错后重试（传入出错的 assistant 消息 ID，内部找到前置用户消息重新发送） */
  retryFromError: (assistantMsgId: string, sessionId?: string) => Promise<void>;
  clearMessages: () => void;
  setMessages: (messages: Message[]) => void;
  setReplyMessage: (message: Message | null) => void;
  /** 设置待编辑消息 */
  setEditTarget: (message: Message | null) => void;
  /** 取消当前流式请求 */
  stopMessage: () => void;
  flushPendingSaves: () => Promise<void>;
  /** 删除单条消息（乐观更新） */
  deleteMessage: (messageId: string) => Promise<void>;
  /** 回退到指定消息之前 */
  rollbackToMessage: (messageId: string) => Promise<{
    messages: Array<Record<string, unknown>>;
    remainingRollbacks: number;
    undoResults?: Array<{ roundId: number; success: boolean; error?: string }>;
  }>;
  /** 回退前快照（用于撤销回退） */
  rollbackSnapshot: Message[] | null;
  /** 撤销最近一次回退（恢复快照中的消息） */
  restoreRollback: () => void;
  /** P2-6: 检查是否有可恢复的中止检查点 */
  checkAbortRecovery: (sessionId: string) => Promise<boolean>;
  /** P2-6: 关闭恢复提示并清理检查点 */
  dismissRecovery: () => void;
  /** P2-6: 用户确认恢复 — 关闭提示并继续之前被中止的会话 */
  resumeRecovery: (sessionId: string) => void;
}

/** 组合后的 Chat Store 状态（MessageSlice + FileSlice） */
export type ChatMessageState = MessageSlice & FileSlice;

/** Zustand set 简写类型（供拆分实现文件引用） */
export type MessageSet = (
  partial:
    | ChatMessageState
    | Partial<ChatMessageState>
    | ((
        state: ChatMessageState,
      ) => ChatMessageState | Partial<ChatMessageState>),
) => void;

/** Zustand get 简写类型（供拆分实现文件引用） */
export type MessageGet = () => ChatMessageState;
