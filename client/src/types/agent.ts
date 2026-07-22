import type { ScheduleConfig, ExecutionRecord } from "./schedule";

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
