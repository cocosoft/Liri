/**
 * API 请求/响应类型 —— chat / message 模块
 */

import type { ToolCall, MessageBlock, QuestionOption, QuestionData } from "../../types";

export type { ToolCall, MessageBlock, QuestionOption, QuestionData };

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
