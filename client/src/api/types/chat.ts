/**
 * API 请求/响应类型 —— chat / message 模块
 */

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  status?: "running" | "completed" | "failed";
}

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface QuestionData {
  questionId: string;
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect?: boolean;
}

export interface MessageBlock {
  id: string;
  type: "text" | "thinking" | "tool_call" | "status" | "question";
  content: string;
  toolCall?: ToolCall;
  status?: string;
  isStreaming?: boolean;
  toolCallId?: string;
  groupId?: string;
  questionData?: QuestionData;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: number;
  sessionId: string;
  toolCalls?: ToolCall[];
  blocks?: MessageBlock[];
  usage?: TokenUsage;
}

export interface ChatSendParams {
  sessionId: string;
  message: string;
  attachments?: string[];
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}
