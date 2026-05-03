/**
 * 消息角色
 */
export enum MessageRole {
  /**
   * 用户
   */
  USER = 'user',

  /**
   * 助手
   */
  ASSISTANT = 'assistant',

  /**
   * 工具
   */
  TOOL = 'tool',

  /**
   * 系统
   */
  SYSTEM = 'system',
}

/**
 * 消息类型枚举
 */
export enum MessageType {
  /**
   * 普通消息
   */
  NORMAL = 'normal',

  /**
   * 压缩边界消息
   */
  COMPACT_BOUNDARY = 'compact_boundary',

  /**
   * 工具调用摘要消息
   */
  TOOL_USE_SUMMARY = 'tool_use_summary',

  /**
   * 附件消息
   */
  ATTACHMENT = 'attachment',

  /**
   * 系统消息
   */
  SYSTEM = 'system',
}

/**
 * 消息状态枚举
 */
export enum MessageStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELED = 'canceled',
}

/**
 * 消息优先级枚举
 */
export enum MessagePriority {
  LOW = 'low',
  NORMAL = 'normal',
  HIGH = 'high',
  CRITICAL = 'critical',
}

/**
 * 消息附件类型
 */
export type AttachmentType =
  | 'image'
  | 'file'
  | 'audio'
  | 'video'
  | 'document'
  | 'link'
  | 'code'
  | 'table'
  | 'chart';

/**
 * 消息附件
 */
export interface MessageAttachment {
  id: string;
  type: AttachmentType;
  name: string;
  url?: string;
  data?: string;
  size?: number;
  contentType?: string;
  metadata?: Record<string, unknown>;
}

/**
 * 消息分类
 */
export type MessageCategory =
  | 'conversation'
  | 'system'
  | 'tool'
  | 'notification'
  | 'error'
  | 'debug'
  | 'analytics';

export type UserMessage = Message;
export type AssistantMessage = Message;
export type SystemMessage = Message;

/**
 * 内容块类型
 */
export enum ContentBlockType {
  /**
   * 文本
   */
  TEXT = 'text',

  /**
   * 代码
   */
  CODE = 'code',

  /**
   * 工具调用
   */
  TOOL_CALL = 'tool_call',

  /**
   * 工具结果
   */
  TOOL_RESULT = 'tool_result',
}

/**
 * 内容块
 */
export interface ContentBlock {
  /**
   * 内容类型
   */
  type: ContentBlockType;

  /**
   * 内容值
   */
  value: string;

  /**
   * 语言（仅适用于代码类型）
   */
  language?: string;

  /**
   * 工具调用ID（仅适用于工具调用类型）
   */
  toolCallId?: string;

  /**
   * 工具名称（仅适用于工具调用类型）
   */
  toolName?: string;

  /**
   * 工具参数（仅适用于工具调用类型）
   */
  toolArgs?: Record<string, any>;
}

/**
 * 压缩边界类型枚举
 */
export enum CompactBoundaryType {
  /**
   * 上下文压缩开始
   */
  CONTEXT_START = 'context_start',

  /**
   * 上下文压缩结束
   */
  CONTEXT_END = 'context_end',

  /**
   * 摘要插入点
   */
  SUMMARY_INSERT = 'summary_insert',

  /**
   * 历史截断点
   */
  HISTORY_TRUNCATED = 'history_truncated',
}

/**
 * 压缩边界消息接口
 */
export interface CompactBoundaryMessage {
  /**
   * 消息ID
   */
  id: string;

  /**
   * 消息类型
   */
  type: MessageType.COMPACT_BOUNDARY;

  /**
   * 边界类型
   */
  boundaryType: CompactBoundaryType;

  /**
   * 被压缩的消息数量
   */
  compressedMessageCount?: number;

  /**
   * 被压缩的token数量
   */
  compressedTokenCount?: number;

  /**
   * 压缩原因
   */
  compressionReason?: string;

  /**
   * 原始上下文摘要
   */
  contextSummary?: string;

  /**
   * 创建时间
   */
  createdAt: Date;

  /**
   * 会话ID
   */
  sessionId?: string;

  /**
   * 元数据
   */
  metadata?: Record<string, any>;
}

/**
 * 工具调用摘要接口
 */
export interface ToolUseSummary {
  /**
   * 工具调用ID
   */
  toolCallId: string;

  /**
   * 工具名称
   */
  toolName: string;

  /**
   * 工具调用参数
   */
  toolArguments: Record<string, any>;

  /**
   * 工具执行结果摘要
   */
  resultSummary: string;

  /**
   * 工具执行状态
   */
  status: 'success' | 'failed' | 'pending';

  /**
   * 执行时间（毫秒）
   */
  executionTime?: number;

  /**
   * 是否对当前任务有帮助
   */
  helpful?: boolean;
}

/**
 * 工具调用摘要消息接口
 */
export interface ToolUseSummaryMessage {
  /**
   * 消息ID
   */
  id: string;

  /**
   * 消息类型
   */
  type: MessageType.TOOL_USE_SUMMARY;

  /**
   * 工具调用摘要列表
   */
  summaries: ToolUseSummary[];

  /**
   * 创建时间
   */
  createdAt: Date;

  /**
   * 会话ID
   */
  sessionId?: string;

  /**
   * 元数据
   */
  metadata?: Record<string, any>;
}

/**
 * 附件消息接口
 */
export interface AttachmentMessage {
  /**
   * 消息ID
   */
  id: string;

  /**
   * 消息类型
   */
  type: MessageType.ATTACHMENT;

  /**
   * 消息角色
   */
  role: MessageRole;

  /**
   * 附件列表
   */
  attachments: MessageAttachment[];

  /**
   * 附件描述文本
   */
  description?: string;

  /**
   * 创建时间
   */
  createdAt: Date;

  /**
   * 更新时间
   */
  updatedAt: Date;

  /**
   * 会话ID
   */
  sessionId?: string;

  /**
   * 元数据
   */
  metadata?: Record<string, any>;
}

/**
 * 消息接口
 */
export interface Message {
  /**
   * 消息ID
   */
  id: string;

  /**
   * 消息角色
   */
  role: MessageRole;

  /**
   * 消息类型
   */
  type?: MessageType;

  /**
   * 消息内容
   */
  content: string | ContentBlock[];

  /**
   * 创建时间
   */
  createdAt: Date;

  /**
   * 更新时间
   */
  updatedAt: Date;

  /**
   * 工具调用ID（仅适用于工具结果消息）
   */
  toolCallId?: string;

  /**
   * 会话ID
   */
  sessionId?: string;

  /**
   * 元数据
   */
  metadata?: Record<string, any>;

  /**
   * 消息状态
   */
  status?: MessageStatus;

  /**
   * 消息优先级
   */
  priority?: MessagePriority;

  /**
   * 消息分类
   */
  category?: MessageCategory;

  /**
   * 消息附件
   */
  attachments?: MessageAttachment[];

  /**
   * 父消息ID
   */
  parentId?: string;

  /**
   * 线程ID
   */
  threadId?: string;

  /**
   * 处理时间
   */
  processingTime?: number;

  /**
   * 错误详情
   */
  errorDetails?: Record<string, unknown>;

  /**
   * 相关消息ID
   */
  relatedMessageId?: string;

  /**
   * 压缩边界消息（当类型为COMPACT_BOUNDARY时使用）
   */
  boundaryType?: CompactBoundaryType;

  /**
   * 被压缩的消息数量
   */
  compressedMessageCount?: number;

  /**
   * 被压缩的token数量
   */
  compressedTokenCount?: number;

  /**
   * 压缩原因
   */
  compressionReason?: string;

  /**
   * 上下文摘要
   */
  contextSummary?: string;

  /**
   * 工具调用摘要列表
   */
  toolUseSummaries?: ToolUseSummary[];
}

/**
 * 规范化消息接口
 */
export interface NormalizedMessage extends Message {
  /**
   * 规范化的内容
   */
  normalizedContent: string;

  /**
   * 消息长度
   */
  length: number;

  /**
   * 是否包含工具调用
   */
  hasToolCalls: boolean;

  /**
   * 是否包含工具结果
   */
  hasToolResults: boolean;
}

/**
 * 发送消息选项
 */
export interface SendMessageOptions {
  /**
   * 会话ID
   */
  sessionId?: string;

  /**
   * 元数据
   */
  metadata?: Record<string, any>;

  /**
   * 是否流式输出
   */
  stream?: boolean;

  /**
   * 模型名称
   */
  model?: string;

  /**
   * 温度
   */
  temperature?: number;

  /**
   * 最大token数
   */
  maxTokens?: number;
}

/**
 * 流式消息选项
 */
export interface StreamMessageOptions extends SendMessageOptions {
  /**
   * 流回调
   */
  onStream?: (chunk: string) => void;

  /**
   * 完成回调
   */
  onComplete?: (message: Message) => void;

  /**
   * 错误回调
   */
  onError?: (error: Error) => void;
}

/**
 * 创建消息的参数
 */
export interface CreateMessageParams {
  /**
   * 消息角色
   */
  role: MessageRole;

  /**
   * 消息内容
   */
  content: string | ContentBlock[];

  /**
   * 会话ID
   */
  sessionId?: string;

  /**
   * 工具调用ID（仅适用于工具结果消息）
   */
  toolCallId?: string;

  /**
   * 元数据
   */
  metadata?: Record<string, any>;

  /**
   * 消息状态
   */
  status?: MessageStatus;

  /**
   * 消息优先级
   */
  priority?: MessagePriority;

  /**
   * 消息分类
   */
  category?: MessageCategory;

  /**
   * 消息附件
   */
  attachments?: MessageAttachment[];

  /**
   * 父消息ID
   */
  parentId?: string;

  /**
   * 线程ID
   */
  threadId?: string;

  /**
   * 处理时间
   */
  processingTime?: number;

  /**
   * 错误详情
   */
  errorDetails?: Record<string, unknown>;

  /**
   * 相关消息ID
   */
  relatedMessageId?: string;
}

/**
 * 聊天响应
 */
export interface ChatResponse {
  /**
   * 消息
   */
  message: Message;

  /**
   * 工具调用列表
   */
  tool_calls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, any>;
  }>;

  /**
   * token使用情况
   */
  usage?: {
    /**
     * 输入token数
     */
    inputTokens: number;

    /**
     * 输出token数
     */
    outputTokens: number;

    /**
     * 总token数
     */
    totalTokens: number;
  };

  /**
   * 模型名称
   */
  model?: string;

  /**
   * 完成原因
   */
  finishReason?: string;
}

/**
 * 流数据块
 */
export interface StreamChunk {
  /**
   * 内容
   */
  content: string;

  /**
   * 完成标志
   */
  isComplete: boolean;

  /**
   * token使用情况
   */
  usage?: {
    /**
     * 输入token数
     */
    inputTokens: number;

    /**
     * 输出token数
     */
    outputTokens: number;

    /**
     * 总token数
     */
    totalTokens: number;
  };

  /**
   * 模型名称
   */
  model?: string;

  /**
   * 完成原因
   */
  finishReason?: string;
}

/**
 * 生成唯一ID
 * @returns 唯一ID
 */
export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

/**
 * 生成消息ID
 * @returns 消息ID
 */
export function generateMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * 生成附件ID
 * @returns 附件ID
 */
export function generateAttachmentId(): string {
  return `att-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * 创建消息
 * @param params 创建消息的参数
 * @returns 消息对象
 */
export function createMessage(params: CreateMessageParams): Message {
  const now = new Date();

  return {
    id: generateMessageId(),
    role: params.role,
    content: params.content,
    createdAt: now,
    updatedAt: now,
    sessionId: params.sessionId,
    toolCallId: params.toolCallId,
    metadata: params.metadata,
    status: params.status || MessageStatus.COMPLETED,
    priority: params.priority || MessagePriority.NORMAL,
    category: params.category,
    attachments: params.attachments,
    parentId: params.parentId,
    threadId: params.threadId,
    processingTime: params.processingTime,
    errorDetails: params.errorDetails,
    relatedMessageId: params.relatedMessageId,
  };
}

/**
 * 创建用户消息
 * @param content 消息内容
 * @param options 选项
 * @returns 消息对象
 */
export function createUserMessage(
  content: string,
  options?: {
    sessionId?: string;
    metadata?: Record<string, any>;
  }
): Message {
  return createMessage({
    role: MessageRole.USER,
    content,
    sessionId: options?.sessionId,
    metadata: options?.metadata,
  });
}

/**
 * 创建助手消息
 * @param content 消息内容
 * @param options 选项
 * @returns 消息对象
 */
export function createAssistantMessage(
  content: string | ContentBlock[],
  options?: {
    sessionId?: string;
    metadata?: Record<string, any>;
  }
): Message {
  return createMessage({
    role: MessageRole.ASSISTANT,
    content,
    sessionId: options?.sessionId,
    metadata: options?.metadata,
  });
}

/**
 * 创建工具消息
 * @param content 消息内容
 * @param toolCallId 工具调用ID
 * @param options 选项
 * @returns 消息对象
 */
export function createToolMessage(
  content: string,
  toolCallId: string,
  options?: {
    sessionId?: string;
    metadata?: Record<string, any>;
  }
): Message {
  return createMessage({
    role: MessageRole.TOOL,
    content,
    toolCallId,
    sessionId: options?.sessionId,
    metadata: options?.metadata,
  });
}

/**
 * 创建系统消息
 * @param content 消息内容
 * @param options 选项
 * @returns 消息对象
 */
export function createSystemMessage(
  content: string,
  options?: {
    sessionId?: string;
    metadata?: Record<string, any>;
  }
): Message {
  return createMessage({
    role: MessageRole.SYSTEM,
    content,
    sessionId: options?.sessionId,
    metadata: options?.metadata,
  });
}

/**
 * 规范化消息
 * @param message 消息对象
 * @returns 规范化的消息对象
 */
export function normalizeMessage(message: Message): NormalizedMessage {
  let normalizedContent = '';
  let hasToolCalls = false;
  let hasToolResults = false;

  if (Array.isArray(message.content)) {
    for (const block of message.content) {
      if (block.type === ContentBlockType.TEXT) {
        normalizedContent += block.value;
      } else if (block.type === ContentBlockType.CODE) {
        normalizedContent += `\n\`\`\`${block.language || ''}\n${block.value}\n\`\`\``;
      } else if (block.type === ContentBlockType.TOOL_CALL) {
        normalizedContent += `[Tool Call: ${block.toolName}]`;
        hasToolCalls = true;
      } else if (block.type === ContentBlockType.TOOL_RESULT) {
        normalizedContent += `[Tool Result: ${block.toolCallId}]`;
        hasToolResults = true;
      }
    }
  } else {
    normalizedContent = message.content;
  }

  return {
    ...message,
    normalizedContent,
    length: normalizedContent.length,
    hasToolCalls,
    hasToolResults,
  };
}

/**
 * 规范化消息列表
 * @param messages 消息列表
 * @returns 规范化的消息列表
 */
export function normalizeMessages(messages: Message[]): NormalizedMessage[] {
  return messages.map(normalizeMessage);
}

/**
 * 重新排序消息
 * @param messages 消息列表
 * @returns 排序后的消息列表
 */
export function reorderMessages(messages: Message[]): Message[] {
  return [...messages].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
  );
}

/**
 * 创建压缩边界消息
 * @param boundaryType 边界类型
 * @param options 选项
 * @returns 压缩边界消息对象
 */
export function createCompactBoundaryMessage(
  boundaryType: CompactBoundaryType,
  options?: {
    sessionId?: string;
    compressedMessageCount?: number;
    compressedTokenCount?: number;
    compressionReason?: string;
    contextSummary?: string;
    metadata?: Record<string, any>;
  }
): CompactBoundaryMessage {
  return {
    id: generateMessageId(),
    type: MessageType.COMPACT_BOUNDARY,
    boundaryType,
    compressedMessageCount: options?.compressedMessageCount,
    compressedTokenCount: options?.compressedTokenCount,
    compressionReason: options?.compressionReason,
    contextSummary: options?.contextSummary,
    createdAt: new Date(),
    sessionId: options?.sessionId,
    metadata: options?.metadata,
  };
}

/**
 * 创建工具调用摘要消息
 * @param summaries 工具调用摘要列表
 * @param options 选项
 * @returns 工具调用摘要消息对象
 */
export function createToolUseSummaryMessage(
  summaries: ToolUseSummary[],
  options?: {
    sessionId?: string;
    metadata?: Record<string, any>;
  }
): ToolUseSummaryMessage {
  return {
    id: generateMessageId(),
    type: MessageType.TOOL_USE_SUMMARY,
    summaries,
    createdAt: new Date(),
    sessionId: options?.sessionId,
    metadata: options?.metadata,
  };
}

/**
 * 创建附件消息
 * @param role 消息角色
 * @param attachments 附件列表
 * @param options 选项
 * @returns 附件消息对象
 */
export function createAttachmentMessage(
  role: MessageRole,
  attachments: MessageAttachment[],
  options?: {
    description?: string;
    sessionId?: string;
    metadata?: Record<string, any>;
  }
): AttachmentMessage {
  const now = new Date();
  return {
    id: generateMessageId(),
    type: MessageType.ATTACHMENT,
    role,
    attachments,
    description: options?.description,
    createdAt: now,
    updatedAt: now,
    sessionId: options?.sessionId,
    metadata: options?.metadata,
  };
}

/**
 * 创建工具调用摘要对象
 * @param toolCallId 工具调用ID
 * @param toolName 工具名称
 * @param toolArguments 工具参数
 * @param resultSummary 结果摘要
 * @param status 状态
 * @param options 选项
 * @returns 工具调用摘要对象
 */
export function createToolUseSummary(
  toolCallId: string,
  toolName: string,
  toolArguments: Record<string, any>,
  resultSummary: string,
  status: 'success' | 'failed' | 'pending',
  options?: {
    executionTime?: number;
    helpful?: boolean;
  }
): ToolUseSummary {
  return {
    toolCallId,
    toolName,
    toolArguments,
    resultSummary,
    status,
    executionTime: options?.executionTime,
    helpful: options?.helpful,
  };
}
