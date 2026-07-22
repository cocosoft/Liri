/**
 * API 请求/响应类型 —— task 模块
 */

import type { AgentProgress } from "../../types";

export type { AgentProgress };

export type TaskRuntime = "cli" | "cron" | "subagent" | "acp" | "daemon";

export type TaskStatus =
  "pending" | "running" | "completed" | "failed" | "killed" | "lost";

export type TaskDeliveryStatus =
  "pending" | "delivered" | "failed" | "not_applicable";

export type TaskNotifyPolicy = "done_only" | "state_changes" | "silent";

export interface TaskRecord {
  taskId: string;
  runtime: TaskRuntime;
  ownerKey: string;
  label?: string;
  task: string;
  status: TaskStatus;
  deliveryStatus: TaskDeliveryStatus;
  notifyPolicy: TaskNotifyPolicy;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  error?: string;
  progressSummary?: string;
}

export interface TaskRegistrySummary {
  total: number;
  active: number;
  terminal: number;
  failures: number;
  byStatus: Record<string, number>;
}

export interface TaskFlowRecord {
  flowId: string;
  ownerKey: string;
  status: string;
  goal: string;
  currentStep?: string;
}

export interface TaskDependency {
  taskId: string;
  blocks?: string[];
  blockedBy?: string[];
}

export interface AuditEntry {
  taskId: string;
  eventType: string;
  oldStatus: string | null;
  newStatus: string;
  timestamp: number;
}
