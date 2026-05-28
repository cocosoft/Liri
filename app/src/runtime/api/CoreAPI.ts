/**
 * CoreAPI 核心接口
 * 统一的应用门面，为所有外部入口（CLI、Bridge、通道插件）提供一致的功能入口
 */

import type {
  ConversionResult,
  FileInfo,
} from '../../tools/converter/engine/types';

/** 聊天请求 */
export interface ChatRequest {
  content: string;
  sessionId?: string;
  stream?: boolean;
  metadata?: Record<string, unknown>;
}

/** 聊天响应 */
export interface ChatResponse {
  content: string;
  sessionId: string;
  messageId?: string;
  toolCalls?: ToolCallSpec[];
  finishReason?: string;
}

/** 流式聊天数据块 */
export interface ChatStreamChunk {
  type: 'text' | 'tool_call' | 'done' | 'error';
  content: string;
  sessionId: string;
  toolCall?: ToolCallSpec;
}

/** 工具调用描述 */
export interface ToolCallSpec {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** 工具执行结果 */
export interface ToolResult {
  toolCallId: string;
  toolName: string;
  result: unknown;
  error: string | null;
  executionTime: number;
}

/** 工具元信息 */
export interface ToolInfo {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  enabled: boolean;
}

/** 会话信息 */
export interface SessionInfo {
  id: string;
  title?: string;
  createdAt: Date;
  updatedAt: Date;
  messageCount: number;
  metadata?: Record<string, unknown>;
}

/** 会话创建参数 */
export interface SessionCreateParams {
  title?: string;
  tags?: string[];
  mode?: string;
}

/** Agent 任务参数 */
export interface AgentTaskParams {
  description: string;
  prompt: string;
  subagentType?: string;
  model?: string;
  runInBackground?: boolean;
}

/** Agent 执行进度 */
export interface AgentProgress {
  agentId: string;
  state: string;
  progress: number;
  message: string;
}

/** Agent 执行结果 */
export interface AgentResult {
  agentId: string;
  content: string;
  state: string;
  summary: {
    durationMs: number;
    tokensUsed: number;
  };
}

/** 文件转换参数 */
export interface ConvertFileParams {
  filePath: string;
  outputFormat?: string;
  options?: Record<string, unknown>;
}

/**
 * CoreAPI 核心接口
 * 应用唯一对外门面，所有模块之间也通过此接口交互
 */
export interface CoreAPI {
  // ========== 聊天 ==========

  /** 发送消息（同步模式） */
  chat(request: ChatRequest): Promise<ChatResponse>;

  /** 发送消息（流式模式） */
  chatStream(
    request: ChatRequest
  ): AsyncGenerator<ChatStreamChunk, ChatResponse, unknown>;

  // ========== 工具 ==========

  /** 执行工具 */
  executeTool(sessionId: string, toolCall: ToolCallSpec): Promise<ToolResult>;

  /** 获取所有已注册工具 */
  listTools(): Promise<ToolInfo[]>;

  /** 获取指定工具详情 */
  getTool(name: string): Promise<ToolInfo | undefined>;

  // ========== 会话 ==========

  /** 创建新会话 */
  createSession(params?: SessionCreateParams): Promise<SessionInfo>;

  /** 获取会话信息 */
  getSession(sessionId: string): Promise<SessionInfo | undefined>;

  /** 列出所有会话 */
  listSessions(): Promise<SessionInfo[]>;

  /** 删除会话 */
  deleteSession(sessionId: string): Promise<void>;

  /** 切换当前会话 */
  switchSession(sessionId: string): Promise<void>;

  /** 重命名会话 */
  renameSession(sessionId: string, title: string): Promise<void>;

  /** 获取当前会话 */
  getCurrentSession(): Promise<SessionInfo | undefined>;

  // ========== Agent ==========

  /** 执行 Agent 任务 */
  executeAgentTask(params: AgentTaskParams): Promise<AgentResult>;

  /** 获取 Agent 进度 */
  getAgentProgress(agentId: string): Promise<AgentProgress | undefined>;

  // ========== 文件转换 ==========

  /** 转换文件为 Markdown */
  convertFile(params: ConvertFileParams): Promise<ConversionResult>;

  /** 检测文件类型 */
  detectFileType(filePath: string): Promise<FileInfo>;
}
