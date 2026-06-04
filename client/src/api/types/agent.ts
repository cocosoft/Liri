/**
 * API 请求/响应类型 —— agent 模块
 */

import type { AgentProgress } from "./task";

export interface AgentTaskCreateParams {
  name: string;
  description?: string;
  prompt?: string;
  priority?: "high" | "medium" | "low";
  subagentType?: string;
  runInBackground?: boolean;
  metadata?: Record<string, unknown>;
}

export interface AgentTaskUpdateParams {
  name?: string;
  description?: string;
  priority?: "high" | "medium" | "low";
}

export interface AgentExecuteParams {
  name: string;
  params?: Record<string, unknown>;
}

export interface AgentListResponse {
  tasks: Array<{
    id: string;
    name: string;
    status: string;
    priority?: string;
    created_at: number;
  }>;
}

export interface AgentDetailResponse {
  id: string;
  name: string;
  status: string;
  progress?: number;
  result?: string;
  error?: string;
  created_at: number;
  logs?: string[];
  tokenUsed?: number;
}

export type AgentTaskStatus = "pending" | "running" | "completed" | "failed";

export type { AgentProgress };
