// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import type http from 'http';
import { sendError, readRequestBody } from './handler-utils';

import { handleError } from '@modules/error';
// C1（2026-09-30 D-101，`tasks` 域 P2）：改经服务层端口
import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';
import type { CronJobRecord } from '@modules/runtime/api/taskOpsPorts';

/** 前端 CronTask 响应格式（`jobToCronTask` 的产物） */
interface CronTaskResponse {
  id: string | undefined;
  name: string | undefined;
  expression: string;
  description: string | undefined;
  prompt: string;
  enabled: boolean;
  scheduleMode: string;
  scheduleDisplay: unknown;
  silent: boolean;
  lastRun: number | undefined;
  nextRun: number | undefined;
  lastDurationMs: undefined;
  lastStatus: unknown;
  lastError: unknown;
  consecutiveErrors: number;
  model: unknown;
  provider: unknown;
  status: 'running' | 'error' | 'idle';
}

/**
 * 调度输入 —— `parseSchedule()` 的三种形态，叠加本处理器按 `scheduleMode`
 * 覆盖后的字段（`interval` / `minutes`）。
 */
type CronScheduleInput = {
  kind: string;
  expr?: string | undefined;
  display?: string | undefined;
  minutes?: number | undefined;
};

/** 将 CronJob 转为前端 CronTask 响应格式 */
function jobToCronTask(job: CronJobRecord): CronTaskResponse {
  const ms = (iso: string | undefined) =>
    iso ? new Date(iso).getTime() : undefined;
  const schedule = job.schedule ?? {};
  return {
    id: job.id,
    name: job.name,
    expression: (schedule.expr as string | undefined) ?? '',
    description: job.prompt ?? job.name,
    prompt: job.prompt || '',
    enabled: job.enabled ?? true,
    scheduleMode: (schedule.kind as string | undefined) ?? 'cron',
    scheduleDisplay: schedule.display ?? job.scheduleDisplay,
    silent: job.silent ?? false,
    lastRun: ms(job.lastRunAt),
    nextRun: ms(job.nextRunAt),
    lastDurationMs: undefined,
    lastStatus: job.lastStatus,
    lastError: job.lastError,
    consecutiveErrors: (job.consecutiveErrors as number | undefined) ?? 0,
    model: job.model,
    provider: job.provider,
    status:
      job.state === 'running'
        ? ('running' as const)
        : job.state === 'failed'
          ? ('error' as const)
          : job.enabled !== false
            ? ('idle' as const)
            : ('idle' as const),
  };
}

// ========== Cron Handlers ==========

/**
 * 列出所有定时任务
 */
export async function handleListCron(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const taskOps = await getCoreAPI().getTaskOpsPort();
    const store = await taskOps.createCronJobStore();
    await store.init();
    const jobs = await store.loadJobs();
    const result = jobs.map((j) => jobToCronTask(j));
    await store.close();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 创建定时任务 POST /v1/cron
 */
export async function handleCreateCron(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  broadcastEvent?: (event: string, data: Record<string, unknown>) => void
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const rawBody = JSON.parse(body) as Record<string, unknown>;
    /** 请求体中取字符串（非字符串一律视为空 ⇒ 边界归一化） */
    const str = (v: unknown): string => (typeof v === 'string' ? v : '');
    const name = str(rawBody.name);
    const expression = str(rawBody.expression);
    const description = str(rawBody.description);
    const bodyPrompt = str(rawBody.prompt);
    const { enabled, scheduleMode, silent, deliver, model, provider } = rawBody;
    const cronExpr = (expression || str(rawBody.cron)).trim();
    const jobName = (name || bodyPrompt || cronExpr || 'Untitled').trim();
    const jobPrompt = (bodyPrompt || description || jobName).trim();

    if (!cronExpr && !jobName) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: 'name or expression is required' } })
      );
      return;
    }

    const { parseSchedule } = await import('@modules/chronos');
    const taskOps = await getCoreAPI().getTaskOpsPort();

    const parsed: CronScheduleInput = parseSchedule(cronExpr) ?? {
      kind: 'cron',
      expr: cronExpr,
      display: cronExpr,
    };

    // 根据 scheduleMode 覆盖调度解析
    if (scheduleMode === 'every') {
      parsed.kind = 'interval';
      parsed.minutes = parseInt(String(rawBody.everyValue), 10) || 30;
      parsed.expr = undefined;
    } else if (scheduleMode === 'at') {
      parsed.kind = 'cron';
      parsed.expr = `${String(rawBody.atMinute || '00')} ${String(
        rawBody.atHour || '14'
      )} * * *`;
    }

    const job: CronJobRecord = {
      id: `cron-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: jobName,
      prompt: jobPrompt,
      schedule: parsed,
      repeat: { times: null, completed: 0 },
      enabled: enabled !== false,
      state: 'scheduled',
      createdAt: new Date().toISOString(),
      silent: typeof silent === 'boolean' ? silent : false,
      deliver: deliver ?? 'local',
      model: model ?? undefined,
      provider: provider ?? undefined,
      scheduleDisplay: parsed.display || cronExpr,
    };

    // 计算首次运行时间
    const nowMs = Date.now();
    if (parsed.kind === 'interval') {
      const mins = parsed.minutes || 30;
      job.nextRunAt = new Date(nowMs + mins * 60 * 1000).toISOString();
    } else if (parsed.kind === 'cron' && parsed.expr) {
      const next = await taskOps.computeNextCronRun(parsed.expr, nowMs);
      if (next) job.nextRunAt = next;
    }

    const store = await taskOps.createCronJobStore();
    await store.init();
    await store.upsertJob(job);
    await store.close();

    // 唤醒全局调度器
    try {
      await taskOps.wakeCronScheduler();
    } catch (err) {
      // 调度器未启动，忽略

      handleError(err, {
        module: 'infrastructure:http:handlers:cron-handlers',
        action: 'schedulerNotStarted',
      });
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(jobToCronTask(job)));

    broadcastEvent?.('cron:created', { id: job.id });
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 获取定时任务详情 GET /v1/cron/:cronId
 */
export async function handleGetCron(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  cronId: string
): Promise<void> {
  try {
    const taskOps = await getCoreAPI().getTaskOpsPort();
    const store = await taskOps.createCronJobStore();
    await store.init();
    const job = await store.getJob(cronId);
    await store.close();
    if (!job) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Cron task not found' } }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(jobToCronTask(job)));
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 更新定时任务 PUT /v1/cron/:cronId
 */
export async function handleUpdateCron(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  cronId: string,
  broadcastEvent?: (event: string, data: Record<string, unknown>) => void
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const updates = JSON.parse(body);
    const taskOps = await getCoreAPI().getTaskOpsPort();
    const store = await taskOps.createCronJobStore();
    await store.init();

    const existing = await store.getJob(cronId);
    if (!existing) {
      await store.close();
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Cron task not found' } }));
      return;
    }

    // Apply allowed updates
    if (updates.name !== undefined) existing.name = updates.name;
    if (updates.description !== undefined)
      existing.prompt = updates.description;
    if (updates.enabled !== undefined) existing.enabled = updates.enabled;
    if (updates.silent !== undefined) existing.silent = updates.silent;
    if (updates.expression !== undefined && existing.schedule) {
      existing.schedule.expr = updates.expression;
    }
    if (updates.lastFiredAt !== undefined) {
      existing.lastRunAt = new Date(updates.lastFiredAt).toISOString();
    }

    await store.upsertJob(existing);
    await store.close();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(jobToCronTask(existing)));

    broadcastEvent?.('cron:updated', { id: cronId });
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 删除定时任务 DELETE /v1/cron/:cronId
 */
export async function handleDeleteCron(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  cronId: string,
  broadcastEvent?: (event: string, data: Record<string, unknown>) => void
): Promise<void> {
  try {
    const taskOps = await getCoreAPI().getTaskOpsPort();
    const store = await taskOps.createCronJobStore();
    await store.init();
    await store.deleteJob(cronId);
    await store.close();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));

    broadcastEvent?.('cron:deleted', { id: cronId });
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 立即执行定时任务 POST /v1/cron/:cronId/run
 */
export async function handleRunCron(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  cronId: string,
  broadcastEvent?: (event: string, data: Record<string, unknown>) => void
): Promise<void> {
  try {
    const taskOps = await getCoreAPI().getTaskOpsPort();
    const store = await taskOps.createCronJobStore();
    await store.init();

    const job = await store.getJob(cronId);
    if (!job) {
      await store.close();
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Cron task not found' } }));
      return;
    }

    job.nextRunAt = new Date().toISOString();
    job.state = 'scheduled';
    await store.upsertJob(job);
    await store.close();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({ success: true, message: `Task ${cronId} triggered` })
    );

    broadcastEvent?.('cron:run', { id: cronId });
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * Cron 调度器状态查询 GET /v1/cron/status
 */
export async function handleCronStatus(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const taskOps = await getCoreAPI().getTaskOpsPort();
    const status = await taskOps.getCronSchedulerStatus();

    if (status) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status));
    } else {
      // 调度器未启动，回退到静态查询
      const store = await taskOps.createCronJobStore();
      await store.init();
      const stats = await store.getStats();
      const enabledJobs = await store.listEnabledJobs();
      let activeJobs = 0;
      for (const job of enabledJobs) {
        if (job.state === 'running') activeJobs++;
      }
      await store.close();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          running: false,
          lastTickAt: undefined,
          activeJobs,
          totalJobs: stats.total,
          uptimeMs: process.uptime() * 1000,
        })
      );
    }
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * Cron 运行日志查询 GET /v1/cron/runs?jobId=&limit=&offset=&status=
 */
export async function handleCronRuns(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string
): Promise<void> {
  try {
    const urlObj = new URL(url, `http://${req.headers.host || 'localhost'}`);
    const jobId = urlObj.searchParams.get('jobId') || undefined;
    const limit = parseInt(urlObj.searchParams.get('limit') || '50', 10);
    const offset = parseInt(urlObj.searchParams.get('offset') || '0', 10);
    const status = (urlObj.searchParams.get('status') || undefined) as
      | 'ok'
      | 'failed'
      | undefined;

    const taskOps = await getCoreAPI().getTaskOpsPort();
    const runLog = await taskOps.createCronRunLog();
    await runLog.init();

    const page = await runLog.queryPage({ jobId, limit, offset, status });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(page));

    await runLog.close();
  } catch (err) {
    sendError(res, err);
  }
}
