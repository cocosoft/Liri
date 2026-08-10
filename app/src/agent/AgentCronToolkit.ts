/**
 * AgentCronToolkit — Agent 自调度 Cron 工具
 *
 * P1-8: 对标 cc_code CronCreateTool/CronListTool/CronDeleteTool + hermes-agent cronjob_tools。
 * 提供 4 个 Agent 可调用的定时任务管理工具。
 *
 * 工具：
 *   - cron_create: 创建定时任务
 *   - cron_list:   列出所有任务
 *   - cron_delete: 删除任务
 *   - cron_stop:   暂停/恢复任务
 */

import { getLogger } from '@modules/monitoring';
const logger = getLogger('agent:cronToolkit');

// ==========================================
// Types
// ==========================================

export type CronScheduleKind = 'once' | 'interval' | 'cron';

export interface AgentCronJob {
  id: string;
  name: string;
  schedule: {
    kind: CronScheduleKind;
    expression: string; // cron expr or "30m"/"2h" for interval
  };
  prompt: string;
  enabled: boolean;
  recurring: boolean;
  durable: boolean; // persist to disk
  createdAt: number;
  lastRunAt?: number;
  nextRunAt?: number;
  runCount: number;
  sessionId: string;
}

export interface CronToolResult {
  success: boolean;
  message: string;
  data?: unknown;
}

// ==========================================
// Toolkit
// ==========================================

export class AgentCronToolkit {
  private jobs = new Map<string, AgentCronJob>();
  private maxJobs: number;

  constructor(maxJobs = 50) {
    this.maxJobs = maxJobs;
  }

  // ---- cron_create ----
  create(
    name: string,
    kind: CronScheduleKind,
    expression: string,
    prompt: string,
    sessionId: string,
    recurring = true,
    durable = false
  ): CronToolResult {
    if (this.jobs.size >= this.maxJobs) {
      return {
        success: false,
        message: `Max jobs (${this.maxJobs}) reached. Delete unused jobs first.`,
      };
    }

    const id = `cron_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const job: AgentCronJob = {
      id,
      name,
      schedule: { kind, expression },
      prompt: prompt.trim(),
      enabled: true,
      recurring,
      durable,
      createdAt: Date.now(),
      runCount: 0,
      sessionId,
    };
    this.jobs.set(id, job);

    logger.info('cronToolkit:created', { id, name, kind, expression });
    return {
      success: true,
      message: `Created cron job '${name}' (${id})`,
      data: job,
    };
  }

  // ---- cron_list ----
  list(): CronToolResult {
    const all = [...this.jobs.values()].map((j) => ({
      id: j.id,
      name: j.name,
      schedule: j.schedule,
      enabled: j.enabled,
      recurring: j.recurring,
      runCount: j.runCount,
      nextRunAt: j.nextRunAt,
    }));
    return { success: true, message: `${all.length} cron job(s)`, data: all };
  }

  // ---- cron_delete ----
  delete(id: string): CronToolResult {
    const job = this.jobs.get(id);
    if (!job) return { success: false, message: `Job '${id}' not found` };
    this.jobs.delete(id);
    logger.info('cronToolkit:deleted', { id, name: job.name });
    return { success: true, message: `Deleted cron job '${job.name}'` };
  }

  // ---- cron_stop (toggle enabled) ----
  toggle(id: string): CronToolResult {
    const job = this.jobs.get(id);
    if (!job) return { success: false, message: `Job '${id}' not found` };
    job.enabled = !job.enabled;
    const status = job.enabled ? 'resumed' : 'paused';
    logger.info('cronToolkit:toggled', {
      id,
      name: job.name,
      enabled: job.enabled,
    });
    return { success: true, message: `Cron job '${job.name}' ${status}` };
  }

  /** 获取到期任务并推进 nextRunAt */
  getDueJobs(): AgentCronJob[] {
    const now = Date.now();
    return [...this.jobs.values()].filter(
      (j) => j.enabled && j.nextRunAt && j.nextRunAt <= now
    );
  }

  /** 标记运行 */
  markRun(id: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    job.lastRunAt = Date.now();
    job.runCount++;
    if (job.recurring && job.schedule.expression) {
      // simple next-run calculation (for real use, delegate to CronParser)
      job.nextRunAt = Date.now() + parseIntervalMs(job.schedule.expression);
    }
  }

  getJob(id: string): AgentCronJob | undefined {
    return this.jobs.get(id);
  }
  get count(): number {
    return this.jobs.size;
  }
}

/** 简单 interval 解析（"30m"/"2h"格式） */
function parseIntervalMs(expr: string): number {
  const match = /^(\d+)\s*(s|m|h|d)$/i.exec(expr);
  if (!match) return 3_600_000; // default 1h
  const num = parseInt(match[1], 10);
  switch (match[2].toLowerCase()) {
    case 's':
      return num * 1000;
    case 'm':
      return num * 60_000;
    case 'h':
      return num * 3_600_000;
    case 'd':
      return num * 86_400_000;
    default:
      return 3_600_000;
  }
}
