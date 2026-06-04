/**
 * API 请求/响应类型 —— session 模块
 */

import type { MessageBlock, ToolCall } from "./chat";

export interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  agentId?: string;
  source?: string;
  tokenUsage?: {
    totalInput: number;
    totalOutput: number;
  };
}

export interface SessionCreateParams {
  title: string;
  agentId?: string;
}

export interface SessionUpdateParams {
  title?: string;
}

export interface SessionListResponse {
  sessions: Session[];
}

export interface SessionSearchParams {
  q?: string;
  from?: string;
  to?: string;
  status?: string;
  limit?: number;
}

export interface SessionSearchResult {
  id: string;
  title: string;
  snippet: string;
  updatedAt: string;
  score: number;
}

export type { MessageBlock, ToolCall };
