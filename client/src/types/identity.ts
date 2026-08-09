/**
 * 身份/用户/智能体领域类型
 *
 * 由 user.ts + agent.ts 归并（GR15-002）。
 */

import type { ScheduleConfig, ExecutionRecord } from "./project";

// ─── 用户与权限 ───

export interface User {
  id: string;
  username: string;
  email?: string;
  role: "admin" | "user" | "guest";
  trustLevel: 1 | 2 | 3 | 4 | 5;
  created_at: number;
  last_login_at?: number;
}

export interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  created_at: number;
  last_used_at?: number;
  expires_at?: number;
  permissions: string[];
}

export interface Permission {
  scope: string;
  description: string;
  level: "none" | "read" | "write" | "admin";
}

// ─── 智能体 ───

export interface AgentTask {
  id: string;
  name: string;
  status: "pending" | "running" | "completed" | "failed" | "lost";
  priority?: "high" | "medium" | "low";
  progress?: number;
  result?: string;
  error?: string;
  created_at: number;
  type?: string;
  subTasks?: AgentTask[];
  logs?: string[];
  tokenUsed?: number;
  description?: string;
  metadata?: Record<string, unknown>;
  templateId?: string;
  scheduleConfig?: ScheduleConfig;
  executionHistory?: ExecutionRecord[];
}

export interface AgentTaskTemplate {
  id: string;
  name: string;
  description?: string;
  prompt: string;
  priority?: "high" | "medium" | "low";
  tags?: string[];
  createdAt: number;
}

export interface AgentProgress {
  agentId: string;
  state: string;
  progress: number;
  message?: string;
}
