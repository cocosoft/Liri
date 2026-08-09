/**
 * 项目/调度领域类型
 *
 * 由 graph.ts + schedule.ts 归并（GR15-002）。
 */

// ─── 知识图谱 ───

/** 边 */
export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  type: string;
  direction: "directed" | "symmetric";
  domain?: string;
  attributes: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

/** 图统计 */
export interface GraphStats {
  totalEdges: number;
  byType: Record<string, number>;
  totalEntities: number;
}

/** 图数据 API 响应 */
export interface GraphEdgesResponse {
  edges: GraphEdge[];
  stats: GraphStats;
}

// ─── 调度 ───

export interface ScheduleConfig {
  type: "cron" | "interval" | "once";
  cronExpression?: string;
  intervalMinutes?: number;
  scheduledTime?: number;
  enabled: boolean;
}

export interface ExecutionRecord {
  id: string;
  taskId: string;
  startTime: number;
  endTime?: number;
  status: "completed" | "failed";
  result?: string;
  error?: string;
  tokenUsed?: number;
}

export type ScheduleMode = "cron" | "every" | "at";

export interface CronTask {
  id: string;
  name: string;
  expression: string;
  description: string;
  prompt?: string;
  enabled: boolean;
  scheduleMode?: ScheduleMode;
  scheduleDisplay?: string;
  silent?: boolean;
  lastRun?: number;
  nextRun?: number;
  lastDurationMs?: number;
  lastStatus?: "ok" | "error" | "skipped";
  lastError?: string;
  consecutiveErrors?: number;
  status: "idle" | "running" | "error";
}
