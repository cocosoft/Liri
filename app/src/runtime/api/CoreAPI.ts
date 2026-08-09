// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * CoreAPI 核心接口
 * 统一的应用门面，为所有外部入口（CLI、Bridge、通道插件）提供一致的功能入口
 liriliri*/

import type {
  ConversionResult,
  FileInfo,
} from '@modules/tools/converter/engine/types';
import type { TodoBlockData } from './todo-types';

/** 进度事件，用于通知调用方当前 AI 处理阶段 */
export interface ProgressEvent {
  /** 处理阶段 */
  stage: 'analyzing' | 'tool_executing' | 'generating' | 'completed';
  /** 人类可读的描述 */
  message: string;
  /** 工具名称（仅在 tool_executing 阶段存在） */
  toolName?: string;
  /** 上下文水位状态（当 stage='generating' 且水位非 normal 时存在） */
  watermarkState?: {
    currentTokens: number;
    contextLimit: number;
    ratio: number;
    severity: 'normal' | 'warn' | 'compact';
  };
}

/** 聊天请求 */
export interface ChatRequest {
  content: string;
  sessionId?: string;
  stream?: boolean;
  metadata?: Record<string, unknown>;
  /** 用户消息附带的图片信息 */
  images?: Array<{ path: string; url: string; filename: string; size: number }>;
  /** 进度回调，用于在非流式路径中获取 AI 处理阶段信息 */
  onProgress?: (event: ProgressEvent) => void;
  /** 前端指定的模型名（用户在状态栏/侧边栏选择的模型）。
   *  设置后优先于 SmartRouter/ModelRouter 的自动决策。 */
  model?: string;
  /** LLM 温度参数 (0-2)，控制输出随机性 */
  temperature?: number;
  /** LLM top_p 参数 (0-1)，核采样阈值 */
  top_p?: number;
  /** 最大输出 token 数 */
  max_tokens?: number;
  /** 自定义系统提示词（覆盖默认） */
  systemPrompt?: string;
}

/** 聊天响应 */
export interface ChatResponse {
  content: string;
  sessionId: string;
  messageId?: string;
  toolCalls?: ToolCallSpec[];
  finishReason?: string;
  /** 非流式路径中，当工具需要用户交互时，返回待处理的提问数据 */
  pendingInteraction?: QuestionData;
}

/** 流式聊天数据块 */
/** Token 用量信息 */
export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

/** 工具需要用户交互时的选项数据 */
export interface QuestionOption {
  label: string;
  description: string;
}

/** 工具需要用户交互时的提问数据 */
export interface QuestionData {
  questionId: string;
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect?: boolean;
}

export interface ChatStreamChunk {
  type:
    | 'text'
    | 'thinking'
    | 'tool_call'
    | 'status'
    | 'done'
    | 'error'
    | 'question'
    | 'todo'
    | 'execution_phase'
    | 'context_state';
  content: string;
  sessionId: string;
  toolCall?: ToolCallSpec;
  status?: string;
  usage?: UsageInfo;
  /** 仅在 type='question' 时存在 */
  questionData?: QuestionData;
  /** 仅在 type='todo' 时存在 */
  todoData?: TodoBlockData;
  /** 仅在 type='execution_phase' 时存在：执行阶段数据 */
  executionPhase?: ExecutionPhaseData;
  /** 进度数据（ProgressData 格式） */
  progressData?: ProgressBlockData;
  /** 交付物数据（DeliverableData 格式） */
  deliverableData?: DeliverableBlockData;
  /** diff 数据 */
  diffData?: DiffBlockData;
  /** 工作模式（Plan/Do） */
  mode?: 'plan' | 'do';
  /** 仅当 type='done' 时存在：模型的终止原因 */
  finishReason?: string;
  /** 仅当 type='context_state' 时存在：上下文水位 */
  watermarkState?: {
    currentTokens: number;
    contextLimit: number;
    ratio: number;
    severity: 'normal' | 'warn' | 'compact';
  };
  /** 状态子类型 — 替代前端对 content 的字符串匹配 (CS02) */
  statusType?:
    | 'ai_thinking'
    | 'retry'
    | 'task_all_done'
    | 'resume'
    | 'tool_retry';
  /** 结构化错误码 — 替代前端对 error message 的字符串匹配 (CS02) */
  errorCode?:
    | 'UNKNOWN'
    | 'RATE_LIMITED'
    | 'AUTH_ERROR'
    | 'QUOTA_EXCEEDED'
    | 'CONNECTION_RESET'
    | 'BACKEND_UNREACHABLE';
  /** 前端导航/提示元数据（如 create_project 完成后建议跳转到项目页） */
  _meta?: Record<string, unknown>;
}

/** 执行阶段数据 */
export interface ExecutionPhaseData {
  phase:
    | 'analyzing'
    | 'designing'
    | 'implementing'
    | 'verifying'
    | 'presenting';
  progress: number;
  description: string;
  steps?: {
    name: string;
    status: 'pending' | 'in_progress' | 'done' | 'failed';
  }[];
  currentStep?: string;
}

/** 进度块数据 */
export interface ProgressBlockData {
  steps: {
    name: string;
    status: 'pending' | 'in_progress' | 'done' | 'failed';
  }[];
  currentStep: string;
}

/** 交付物块数据 */
export interface DeliverableBlockData {
  files: {
    path: string;
    change: 'added' | 'modified' | 'deleted';
    status: 'pending' | 'verified' | 'failed';
  }[];
  summary: string;
}

/** diff 块数据 */
export interface DiffBlockData {
  file: string;
  diff: string;
  language?: string;
}

/** 工具调用描述 */
export interface ToolCallSpec {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  status?: 'running' | 'completed' | 'failed';
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
  roundCount: number;
  /** 渠道来源标识，如 'web'、'qq'、'discord' 等 */
  source?: string;
  metadata?: Record<string, unknown>;
}

/** 会话创建参数 */
export interface SessionCreateParams {
  title?: string;
  tags?: string[];
  mode?: string;
  /** 会话元数据（如 workspaceId、workMode 等） */
  metadata?: Record<string, unknown>;
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

  /** 解析待处理的用户交互（question 回答），sessionId 可选（多会话精确定位） */
  resolveInteraction(
    questionId: string,
    answers: string[],
    sessionId?: string
  ): boolean;

  /** 获取非流式路径中的待处理交互数据 */
  getPendingInteraction(sessionId: string): QuestionData | null;

  /** 继续非流式路径中的交互（用户回答后恢复工具执行） */
  continueInteraction(
    sessionId: string,
    questionId: string,
    answers: string[]
  ): Promise<ChatResponse>;

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

  /** 获取会话消息列表 */
  getSessionMessages(sessionId: string): Promise<
    Array<{
      id: string;
      role: string;
      content: string;
      timestamp: number;
      tool_calls?: Array<Record<string, unknown>>;
      blocks?: Array<Record<string, unknown>>;
    }>
  >;

  /** 更新消息的 blocks 结构 */
  updateMessageBlocks(
    sessionId: string,
    messageId: string,
    blocks: Array<Record<string, unknown>>
  ): Promise<void>;

  /** 删除单条消息（软删除） */
  deleteMessage(
    sessionId: string,
    messageId: string
  ): Promise<{
    success: boolean;
    messages: Array<Record<string, unknown>>;
  }>;

  /** 截断消息（回退到指定消息之前） */
  truncateMessages(
    sessionId: string,
    beforeMessageId: string
  ): Promise<{
    success: boolean;
    messages: Array<Record<string, unknown>>;
    remainingRollbacks: number;
    deletedMessageIds: string[];
    undoResults: Array<{ roundId: number; success: boolean; error?: string }>;
  }>;

  /** 列出所有会话 */
  listSessions(): Promise<SessionInfo[]>;

  /** 删除会话 */
  deleteSession(sessionId: string): Promise<void>;

  /** 清除所有会话 */
  clearAllSessions(): Promise<void>;

  /** 切换当前会话 */
  switchSession(sessionId: string): Promise<void>;

  /** 重命名会话 */
  renameSession(sessionId: string, title: string): Promise<void>;

  /** 更新会话元数据（模型绑定、工作空间、任务分工等） */
  updateSessionMeta(
    sessionId: string,
    meta: {
      model?: string;
      workspaceId?: string;
      providerId?: string;
      tasksOverride?: Record<string, string>;
    }
  ): Promise<void>;

  /** 生成会话标题 */
  generateSessionTitle(
    sessionId: string,
    userMessage: string,
    assistantResponse: string
  ): Promise<string | null>;

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
