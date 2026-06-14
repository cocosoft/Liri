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