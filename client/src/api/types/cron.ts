/**
 * API 请求/响应类型 —— cron 模块
 */

export type ScheduleMode = "cron" | "every" | "at";

export interface CronTask {
  id: string;
  name: string;
  expression: string;
  description?: string;
  enabled: boolean;
  status: "running" | "idle" | "error";
  lastRun?: string;
  nextRun?: string;
  scheduleMode: ScheduleMode;
  silent: boolean;
  everyValue?: number;
  everyUnit?: "minutes" | "hours" | "days";
  atHour?: string;
  atMinute?: string;
}

export interface CronCreateParams {
  name: string;
  expression: string;
  description?: string;
  enabled?: boolean;
  scheduleMode?: ScheduleMode;
  silent?: boolean;
}

export interface CronUpdateParams {
  name?: string;
  expression?: string;
  description?: string;
  enabled?: boolean;
  silent?: boolean;
}

export interface CronExecutionRecord {
  id: string;
  jobId: string;
  startTime: number;
  endTime?: number;
  status: "completed" | "failed" | "running";
  outputPreview?: string;
  error?: string;
}

export interface CronRetryConfig {
  maxRetries: number;
  backoffMs: number;
  jitter: boolean;
}
