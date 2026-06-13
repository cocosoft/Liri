/**
 * API 请求/响应类型 —— session 模块
 *
 * Session 类型统一引用自 `@/types`（唯一事实来源）
 */

import type { MessageBlock, ToolCall } from "./chat";
import type { Session } from "../../types";

export type { Session } from "../../types";

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
