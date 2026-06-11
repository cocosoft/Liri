import type { TodoBlockData } from '@modules/runtime/api/todo-types';

/**
 * 消息类型枚举
 *
 * @deprecated 使用 {@link DataMessageType} — 从 `@modules/core/data-models` 导入
 */
export enum MessageType {
  USER = 'user',
  ASSISTANT = 'assistant',
  SYSTEM = 'system',
  TOOL_USE = 'tool_use',
  TOOL_RESULT = 'tool_result',
  PROGRESS = 'progress',
  EMBEDDING = 'embedding',
  ERROR = 'error',
}

/**
 * 消息角色枚举
 *
 * @deprecated 使用 {@link DataMessageRole} — 从 `@modules/core/data-models` 导入
 */
export enum MessageRole {
  USER = 'user',
  ASSISTANT = 'assistant',
  SYSTEM = 'system',
  TOOL = 'tool',
}

/**
 * 内容块类型
 *
 * @deprecated 使用 {@link DataContentBlock} — 从 `@modules/core/data-models` 导入
 */
export enum ContentBlockType {
  TEXT = 'text',
  IMAGE = 'image',
  TOOL_USE = 'tool_use',
  TOOL_RESULT = 'tool_result',
}

/**
 * 文本内容块
 */
export interface TextContentBlock {
  type: ContentBlockType.TEXT;
  text: string;
}

/**
 * 图片内容块
 */
export interface ImageContentBlock {
  type: ContentBlockType.IMAGE;
  source: {
    type: 'base64' | 'url';
    media_type: string;
    data?: string;
    url?: string;
  };
}

/**
 * 工具使用内容块
 */
export interface ToolUseContentBlock {
  type: ContentBlockType.TOOL_USE;
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * 工具结果内容块
 */
export interface ToolResultContentBlock {
  type: ContentBlockType.TOOL_RESULT;
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

/**
 * 内容块联合类型
 */
export type ContentBlock =
  | TextContentBlock
  | ImageContentBlock
  | ToolUseContentBlock
  | ToolResultContentBlock;

/**
 * 消息元数据
 */
export interface MessageMetadata {
  toolCallId?: string;
  toolName?: string;
  parentMessageId?: string;
  tokenCount?: number;
  model?: string;
  completionTokens?: number;
  promptTokens?: number;
  finishReason?: string;
  tool_calls?: Array<Record<string, unknown>>;
}

/**
 * 前端消息块类型
 */
export interface FrontendMessageBlock {
  id: string;
  type: 'text' | 'thinking' | 'tool_call' | 'status' | 'todo';
  content: string;
  toolCall?: {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
    result?: unknown;
    status?: 'running' | 'completed' | 'failed';
  };
  status?: string;
  isStreaming?: boolean;
  /** 仅在 type='todo' 时存在 */
  todoData?: TodoBlockData;
}

/**
 * 统一消息接口
 *
 * @deprecated 使用 {@link DataMessage} — 从 `@modules/core/data-models` 导入
 */
export interface UnifiedMessage {
  id: string;
  sessionId: string;
  type: MessageType;
  role: MessageRole;
  content: string | ContentBlock[];
  parentUuid?: string;
  timestamp: number;
  metadata?: MessageMetadata;
  blocks?: FrontendMessageBlock[];
}

/**
 * 用户消息
 */
export interface UserMessage extends UnifiedMessage {
  type: MessageType.USER;
  role: MessageRole.USER;
}

/**
 * 助手消息
 */
export interface AssistantMessage extends UnifiedMessage {
  type: MessageType.ASSISTANT;
  role: MessageRole.ASSISTANT;
}

/**
 * 工具使用消息
 */
export interface ToolUseMessage extends UnifiedMessage {
  type: MessageType.TOOL_USE;
  role: MessageRole.TOOL;
  metadata: MessageMetadata & {
    toolCallId: string;
    toolName: string;
  };
}

/**
 * 工具结果消息
 */
export interface ToolResultMessage extends UnifiedMessage {
  type: MessageType.TOOL_RESULT;
  role: MessageRole.TOOL;
  metadata: MessageMetadata & {
    toolCallId: string;
    is_error?: boolean;
  };
}

/**
 * 进度消息
 */
export interface ProgressMessage extends UnifiedMessage {
  type: MessageType.PROGRESS;
  role: MessageRole.ASSISTANT;
  metadata: MessageMetadata & {
    progress: number;
    total?: number;
    unit?: string;
  };
}

/**
 * 消息查询选项
 */
export interface MessageQueryOptions {
  limit?: number;
  offset?: number;
  startDate?: number;
  endDate?: number;
  types?: MessageType[];
  roles?: MessageRole[];
  parentUuid?: string;
}

/**
 * 消息创建参数
 */
export interface CreateMessageParams {
  sessionId: string;
  type: MessageType;
  role: MessageRole;
  content: string | ContentBlock[];
  parentUuid?: string;
  metadata?: MessageMetadata;
}

/**
 * SDK消息类型（用于远程通信）
 */
export interface SDKMessage {
  type: string;
  sessionId?: string;
  message?: UnifiedMessage;
  data?: unknown;
  timestamp?: number;
}

/**
 * 控制消息类型
 */
export type ControlMessage =
  | SDKControlRequest
  | SDKControlResponse
  | SDKControlCancelRequest;

/**
 * SDK控制请求
 */
export interface SDKControlRequest {
  type: 'control_request';
  requestId: string;
  action: string;
  params?: Record<string, unknown>;
}

/**
 * SDK控制响应
 */
export interface SDKControlResponse {
  type: 'control_response';
  requestId: string;
  success: boolean;
  result?: unknown;
  error?: string;
}

/**
 * SDK控制取消请求
 */
export interface SDKControlCancelRequest {
  type: 'control_cancel';
  requestId: string;
  reason?: string;
}

/**
 * 权限请求
 */
export interface PermissionRequest {
  requestId: string;
  toolName: string;
  params: Record<string, unknown>;
  timestamp: number;
}

/**
 * 权限响应
 */
export interface PermissionResponse {
  requestId: string;
  approved: boolean;
  reason?: string;
}
