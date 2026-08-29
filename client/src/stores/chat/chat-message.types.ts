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
  /** KB-LONG-SESSION（2026-08-29）：长会话分页——是否还有更早历史消息（首次载入超阈值时） */
  hasOlder: boolean;
  /** 加载更早历史消息进行中（防重） */
  loadingOlder: boolean;
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
  /**
   * 阶段2 断连挂起：sid → 暂停信息。流式重试耗尽后不结束流，
   * 挂起等待后端恢复（自动/手动）续传；phase 标记等待中/恢复倒计时中。
   * N8-2：挂起时 controller 从 streamControllers 移入此处——
   * 挂起流从全局 isStreaming 推导中排除，避免阻塞其他会话的输入/队列。
   */
  pausedStreams: Record<
    string,
    {
      since: number;
      phase: "waiting" | "recovering";
      controller?: AbortController;
    }
  >;

  addMessage: (message: Message) => void;
  sendMessage: (
    content: string,
    sessionId?: string,
    images?: import("@/types").AttachedImage[],
  ) => Promise<void>;
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
  /** #2 修复：重新生成指定 AI 消息（传入点击的 assistant 消息 id），
   *  原实现忽略点击哪条、永远重发最后一条且误删其后对话 */
  regenerateMessage: (
    assistantMsgId: string,
    sessionId?: string,
  ) => Promise<void>;
  /** 在出错后重试（传入出错的 assistant 消息 ID，内部找到前置用户消息重新发送） */
  retryFromError: (assistantMsgId: string, sessionId?: string) => Promise<void>;
  /**
   * B-C1: 真「继续生成」— 以指定 AI 消息为回复引用，自动发送"请继续"指令触发新一轮生成。
   * prompt 可选（UI 传本地化文案）；不传则用默认"请继续"。
   */
  continueGeneration: (
    assistantMsgId: string,
    sessionId?: string,
    prompt?: string,
  ) => Promise<void>;
  clearMessages: () => void;
  /**
   * R-A 修复：清空**当前会话**（前端 + 后端同步）。
   * /clear 命令与 Ctrl+L 原只清前端、后端消息保留，切回会话"消息复活"。
   * 通过 truncateMessages(首条消息 id) 删除后端全部消息后清空本地。
   */
  clearSessionMessages: () => Promise<void>;
  setMessages: (messages: Message[]) => void;
  /** KB-LONG-SESSION（2026-08-29）：设置"是否还有更早历史"标记（会话载入分页后） */
  setHasOlder: (hasOlder: boolean) => void;
  /** KB-LONG-SESSION（2026-08-29）：加载更早历史消息（before=最早消息 lastEventSeq），拼接到头部 */
  loadOlderMessages: () => Promise<void>;
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
  /** 阶段2: 标记会话流已挂起（消费者收到 paused chunk 时调用） */
  pauseStream: (sessionId: string) => void;
  /** 阶段2: 恢复挂起流（自动/手动），使其从检查点续传 */
  resumeStream: (sessionId: string) => void;
  /** 阶段2: 放弃挂起流（中止控制器 + 解除挂起等待 + 清理暂停状态） */
  abortPausedStream: (sessionId: string) => void;
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
