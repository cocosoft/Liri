/**
 * 统一数据模型
 *
 * ════════════════════════════════════════════════════
 * 项目标准数据契约（2026-06 架构治理统一）
 *
 * 统一 Message、Session、AuditEvent 三类核心数据模型，
 * 合并以下碎片化定义：
 *   - ai/models/types.ts → ChatMessage
 *   - session/types/Message.ts → UnifiedMessage
 *   - chat/types/message.ts → Message
 *   - chat/types/session.ts → ChatSession
 *   - session/types/Session.ts → UnifiedSession
 *   - security/audit/AuditTypes.ts → SecurityAuditReport
 *   - commands/framework/CommandAuditLogger.ts → AuditEntry
 *     (及其他 6 个审计相关类型)
 *
 * 新代码应从此文件导入类型，而非各处碎片定义。
 * ════════════════════════════════════════════════════
 */

// ─── Message 消息模型 ───────────────────────────────────────────────────────

/** 消息角色 */
export type DataMessageRole = 'system' | 'user' | 'assistant' | 'tool';

/** 消息类型枚举 */
export enum DataMessageType {
  TEXT = 'text',
  IMAGE = 'image',
  FILE = 'file',
  TOOL = 'tool',
  PROGRESS = 'progress',
  EMBEDDING = 'embedding',
  ERROR = 'error',
}

/** 文本内容块 */
export interface DataTextBlock {
  type: 'text';
  text: string;
}

/** 图片内容块 */
export interface DataImageBlock {
  type: 'image';
  source: {
    type: 'base64' | 'url';
    media_type: string;
    data?: string;
    url?: string;
  };
}

/** 工具调用内容块 */
export interface DataToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** 工具结果内容块 */
export interface DataToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

/** 内容块联合类型 */
export type DataContentBlock =
  | DataTextBlock
  | DataImageBlock
  | DataToolUseBlock
  | DataToolResultBlock;

/** 多模态内容片段 */
export interface DataContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
    detail?: 'auto' | 'low' | 'high';
  };
}

/** 工具调用（LLM 格式） */
export interface DataToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/** 已解析工具调用 */
export interface DataParsedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** 消息元数据 */
export interface DataMessageMetadata {
  toolCallId?: string;
  toolName?: string;
  parentMessageId?: string;
  tokenCount?: number;
  model?: string;
  completionTokens?: number;
  promptTokens?: number;
  finishReason?: string;
  tool_calls?: DataToolCall[];
}

/** 统一消息接口 */
export interface DataMessage {
  /** 消息唯一标识 */
  id: string;
  /** 所属会话 ID */
  sessionId: string;
  /** 消息角色 */
  role: DataMessageRole;
  /** 消息类型 */
  type: DataMessageType;
  /** 文本内容（向后兼容） */
  content: string | DataContentBlock[];
  /** 多模态内容（可选，存在时优先于 content） */
  multimodal?: DataContentPart[];
  /** 工具调用 */
  tool_calls?: DataToolCall[];
  /** 工具调用 ID */
  tool_call_id?: string;
  /** 父消息 ID（用于线程/回复） */
  parentUuid?: string;
  /** 时间戳 */
  timestamp: number;
  /** 元数据 */
  metadata?: DataMessageMetadata;
  /** 附件 */
  attachments?: DataAttachment[];
}

/** 消息附件 */
export interface DataAttachment {
  type: string;
  url: string;
  name: string;
  size?: number;
  contentType?: string;
}

/** 消息用法统计 */
export interface DataMessageUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

// ─── Session 会话模型 ───────────────────────────────────────────────────────

/** 会话类型 */
export enum DataSessionType {
  LOCAL = 'local',
  REMOTE = 'remote',
  BRIDGE = 'bridge',
  CHAT = 'chat',
}

/** 会话状态 */
export enum DataSessionStatus {
  ACTIVE = 'active',
  PAUSED = 'paused',
  ENDED = 'ended',
  ARCHIVED = 'archived',
  IDLE = 'idle',
  RUNNING = 'running',
  REQUIRES_ACTION = 'requires_action',
  COMPLETED = 'completed',
  ERROR = 'error',
  ABORTED = 'aborted',
}

/** 会话元数据 */
export interface DataSessionMetadata {
  /** 会话标题 */
  title?: string;
  /** 会话描述 */
  description?: string;
  /** 会话标签 */
  tags?: string[];
  /** 会话模式 */
  mode?: string;
  /** 模型名称 */
  model?: string;
  /** 创建者 */
  creator?: string;
  /** 创建者 ID */
  userId?: string;
  /** 工作树状态 */
  worktreeState?: string;
  /** PR 链接 */
  prLink?: string;
  /** 项目路径 */
  projectPath?: string;
  /** 父会话 ID */
  parentSessionId?: string;
  /** 崩溃恢复 */
  crashRecovery?: string;
  /** 消息总数 */
  totalMessages?: number;
  /** 总 Token 数 */
  totalTokens?: number;
  /** 总成本 */
  totalCost?: number;
  /** 自定义扩展字段 */
  [key: string]: unknown;
}

/** 统一会话接口 */
export interface DataSession {
  /** 会话 ID */
  id: string;
  /** 会话类型 */
  type: DataSessionType;
  /** 会话标题 */
  title?: string;
  /** 会话状态 */
  status: DataSessionStatus;
  /** 会话元数据 */
  metadata: DataSessionMetadata;
  /** 消息列表 */
  messages: DataMessage[];
  /** 创建时间 */
  createdAt: number | Date;
  /** 更新时间 */
  updatedAt: number | Date;
  /** 最后活动时间 */
  lastActivityAt?: number | Date;
  /** 结束时间 */
  endedAt?: number | Date;
  /** Agent ID */
  agentId?: string;
}

/** 创建会话参数 */
export interface DataCreateSessionParams {
  id?: string;
  type?: DataSessionType;
  title?: string;
  description?: string;
  tags?: string[];
  mode?: string;
  model?: string;
  creator?: string;
  metadata?: Record<string, unknown>;
  initialMessages?: DataMessage[];
}

/** 会话过滤条件 */
export interface DataSessionFilter {
  type?: DataSessionType;
  status?: DataSessionStatus;
  tags?: string[];
  mode?: string;
  startDate?: number;
  endDate?: number;
  userId?: string;
  agentId?: string;
  searchQuery?: string;
}

/** 会话统计信息 */
export interface DataSessionStats {
  totalSessions: number;
  activeSessions: number;
  archivedSessions: number;
  averageSessionDuration: number;
  totalMessages: number;
  lastActivityAt?: number;
}

/** 会话摘要信息（列表展示用） */
export interface DataSessionInfo {
  id: string;
  title?: string;
  type: DataSessionType;
  status: DataSessionStatus;
  createdAt: number;
  updatedAt: number;
  lastActivityAt: number;
  messageCount: number;
  metadata: DataSessionMetadata;
}

// ─── Audit 审计模型 ─────────────────────────────────────────────────────────

/** 审计事件类型 */
export enum DataAuditEventType {
  COMMAND_EXECUTED = 'command.executed',
  COMMAND_COMPLETED = 'command.completed',
  COMMAND_FAILED = 'command.failed',
  PERMISSION_CHECK = 'permission.check',
  PERMISSION_GRANTED = 'permission.granted',
  PERMISSION_DENIED = 'permission.denied',
  TOOL_EXECUTION = 'tool.execution',
  TOOL_DENIED = 'tool.denied',
  CONFIG_CHANGE = 'config.change',
  AUTHENTICATION = 'auth',
  AUTHORIZATION = 'authorization',
  DATA_ACCESS = 'data.access',
  SYSTEM_CHANGE = 'system.change',
  APPROVAL_ACTION = 'approval.action',
  SANDBOX_VIOLATION = 'sandbox.violation',
  USER_MANAGEMENT = 'user.management',
  SECURITY = 'security',
}

/** 审计严重级别 */
export type DataAuditSeverity = 'info' | 'warning' | 'error' | 'critical';

/** 统一审计事件 */
export interface DataAuditEvent {
  /** 事件唯一 ID */
  id: string;
  /** 事件类型 */
  type: DataAuditEventType | string;
  /** 严重级别 */
  severity: DataAuditSeverity;
  /** 发生时间（毫秒时间戳） */
  timestamp: number;
  /** 操作用户 */
  actor?: string;
  /** 用户角色 */
  actorRole?: string;
  /** 会话 ID */
  sessionId?: string;
  /** 操作资源 */
  resource?: string;
  /** 操作描述 */
  action: string;
  /** 事件详情 */
  details: Record<string, unknown>;
  /** 是否成功 */
  success: boolean;
  /** 失败原因 */
  failureReason?: string;
  /** 源 IP */
  sourceIp?: string;
  /** 关联的执行 ID */
  executionId?: string;
}

/** 审计查询过滤器 */
export interface DataAuditQuery {
  startTime?: number;
  endTime?: number;
  types?: string[];
  severities?: DataAuditSeverity[];
  actor?: string;
  resource?: string;
  success?: boolean;
  limit?: number;
  offset?: number;
}

/** 审计查询结果 */
export interface DataAuditQueryResult {
  events: DataAuditEvent[];
  total: number;
  offset: number;
  limit: number;
}
