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

import type http from 'node:http';
import type { HandlerCtx } from './handler-utils';
import { handleError } from '@modules/error/handleError';

/**
 * 将 CronJob 转换为 CronTask 响应格式
 */
function jobToCronTask(job: Record<string, any>): Record<string, any> {
  return {
    id: job.id,
    name: job.name,
    prompt: job.prompt || '',
    description: job.prompt || '',
    expression: job.schedule?.expr || '',
    schedule: job.schedule,
    enabled: job.enabled !== false,
    state: job.state || 'scheduled',
    silent: job.silent ?? false,
    deliver: job.deliver || 'local',
    model: job.model,
    provider: job.provider,
    agentId: job.agentId,
    lastRunAt: job.lastRunAt,
    nextRunAt: job.nextRunAt,
    createdAt: job.createdAt,
  };
}

// ========== Cron Handlers ==========

export async function handleListCron(
  ctx: HandlerCtx,
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { CronJobStore } = await import('@modules/tasks/cron/CronJobStore');
      const { resolveDbPath } = await import('@modules/core/paths');
      const store = new CronJobStore(resolveDbPath());
      await store.init();
      const jobs = await store.loadJobs();
      const result = jobs.map((j) => jobToCronTask(j));
      await store.close();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      await handleError(err, { module: 'infra:http', action: 'handler_error' });
      if (!res.headersSent) {
        try {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Internal server error' } }));
        } catch {} /* res可能已结束, 忽略 */
      }
    }
  }

  /**
   * 处理创建定时任务请求
   */
export async function handleCreateCron(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
    const body = await ctx.readRequestBody(req);
      const rawBody: Record<string, any> = JSON.parse(body);
      const { name, expression, description, prompt: bodyPrompt, enabled, scheduleMode, silent,
              deliver, deliverTo, model, provider, agentId } = rawBody;
      const cronExpr = (expression || rawBody.cron || '').trim();
      const jobName = (name || rawBody.prompt || cronExpr || 'Untitled').trim();
      const jobPrompt = (bodyPrompt || description || jobName).trim();

      if (!cronExpr && !jobName) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'name or expression is required' } }));
        return;
      }

      const { parseSchedule } = await import('@modules/chronos/cron');
      const { computeNextCronRun } = await import('@modules/tasks/cron/CronParser');
      const { CronJobStore } = await import('@modules/tasks/cron/CronJobStore');
      const { resolveDbPath } = await import('@modules/core/paths');

      const parsed: any = parseSchedule(cronExpr) || { kind: 'cron', expr: cronExpr, display: cronExpr };

      // 根据 scheduleMode 覆盖调度解析
      if (scheduleMode === 'every') {
        parsed.kind = 'interval';
        parsed.minutes = parseInt(rawBody.everyValue, 10) || 30;
        parsed.expr = undefined;
      } else if (scheduleMode === 'at') {
        parsed.kind = 'cron';
        parsed.expr = `${rawBody.atMinute || '00'} ${rawBody.atHour || '14'} * * *`;
      }

      const job: any = {
        id: `cron-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: jobName,
        prompt: jobPrompt,
        schedule: parsed,
        repeat: { times: null, completed: 0 },
        enabled: enabled !== false,
        state: 'scheduled',
        createdAt: new Date().toISOString(),
        silent: silent ?? false,
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
        const next = computeNextCronRun(parsed.expr, nowMs);
        if (next) job.nextRunAt = next;
      }

      const store = new CronJobStore(resolveDbPath());
      await store.init();
      await store.upsertJob(job);
      await store.close();

      // 唤醒全局调度器，使新作业立即被检查
      try {
        const { wakeGlobalCronScheduler } =
          await import('@modules/tasks/cron/GlobalCronScheduler');
        wakeGlobalCronScheduler();
      } catch {
        // 调度器未启动，忽略
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(jobToCronTask(job)));
    } catch (err) {
      await handleError(err, { module: 'infra:http', action: 'handler_error' });
      if (!res.headersSent) {
        try {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Internal server error' } }));
        } catch {} /* res可能已结束, 忽略 */
      }
    }
  }

  /**
   * 处理获取定时任务详情请求
   */
export async function handleGetCron(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    cronId: string
  ): Promise<void> {
    try {
      const { CronJobStore } = await import('@modules/tasks/cron/CronJobStore');
      const { resolveDbPath } = await import('@modules/core/paths');
      const store = new CronJobStore(resolveDbPath());
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
      await handleError(err, { module: 'infra:http', action: 'handler_error' });
      if (!res.headersSent) {
        try {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Internal server error' } }));
        } catch {} /* res可能已结束, 忽略 */
      }
    }
  }

  /**
   * 处理更新定时任务请求
   */
export async function handleUpdateCron(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    cronId: string
  ): Promise<void> {
    try {
    const body = await ctx.readRequestBody(req);
      const updates = JSON.parse(body);
      const { CronJobStore } = await import('@modules/tasks/cron/CronJobStore');
      const { resolveDbPath } = await import('@modules/core/paths');
      const store = new CronJobStore(resolveDbPath());
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
      if (updates.description !== undefined) existing.prompt = updates.description;
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
    } catch (err) {
      await handleError(err, { module: 'infra:http', action: 'handler_error' });
      if (!res.headersSent) {
        try {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Internal server error' } }));
        } catch {} /* res可能已结束, 忽略 */
      }
    }
  }

  /**
   * 处理删除定时任务请求
   */
export async function handleDeleteCron(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    cronId: string
  ): Promise<void> {
    try {
      const { CronJobStore } = await import('@modules/tasks/cron/CronJobStore');
      const { resolveDbPath } = await import('@modules/core/paths');
      const store = new CronJobStore(resolveDbPath());
      await store.init();
      await store.deleteJob(cronId);
      await store.close();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      await handleError(err, { module: 'infra:http', action: 'handler_error' });
      if (!res.headersSent) {
        try {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Internal server error' } }));
        } catch {} /* res可能已结束, 忽略 */
      }
    }
  }

  /**
   * 处理立即执行定时任务请求
   */
export async function handleRunCron(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    cronId: string
  ): Promise<void> {
    try {
      const { CronJobStore } = await import('@modules/tasks/cron/CronJobStore');
      const { resolveDbPath } = await import('@modules/core/paths');
      const store = new CronJobStore(resolveDbPath());
      await store.init();

      const job = await store.getJob(cronId);
      if (!job) {
        await store.close();
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Cron task not found' } }));
        return;
      }

      // 将 nextRunAt 设为 now 并保存，下次 tick 会执行
      job.nextRunAt = new Date().toISOString();
      job.state = 'scheduled';
      await store.upsertJob(job);
      await store.close();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: `Task ${cronId} triggered` }));
    } catch (err) {
      await handleError(err, { module: 'infra:http', action: 'handler_error' });
      if (!res.headersSent) {
        try {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Internal server error' } }));
        } catch {} /* res可能已结束, 忽略 */
      }
    }
  }

  /**
   * 处理 cron 调度器状态查询
   * GET /v1/cron/status
   */
export async function handleCronStatus(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { isGlobalCronSchedulerStarted, getGlobalCronScheduler } =
        await import('@modules/tasks/cron/GlobalCronScheduler');
      const started = isGlobalCronSchedulerStarted();
      const scheduler = getGlobalCronScheduler();

      if (started && scheduler) {
        const status = scheduler.getStatus();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(status));
      } else {
        // 调度器未启动，回退到静态查询
        const { CronJobStore } = await import('@modules/tasks/cron/CronJobStore');
        const { resolveDbPath } = await import('@modules/core/paths');
        const store = new CronJobStore(resolveDbPath());
        await store.init();
        const stats = await store.getStats();
        const enabledJobs = await store.listEnabledJobs();
        let activeJobs = 0;
        for (const job of enabledJobs) {
          if (job.state === 'running') activeJobs++;
        }
        await store.close();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          running: false,
          lastTickAt: undefined,
          activeJobs,
          totalJobs: stats.total,
          uptimeMs: process.uptime() * 1000,
        }));
      }
    } catch (err) {
      await handleError(err, { module: 'infra:http', action: 'handler_error' });
      if (!res.headersSent) {
        try {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Internal server error' } }));
        } catch {} /* res可能已结束, 忽略 */
      }
    }
  }

  /**
   * 处理 cron 运行日志查询
   * GET /v1/cron/runs?jobId=&limit=&offset=&status=
   */
export async function handleCronRuns(
  ctx: HandlerCtx,
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

      const { CronRunLog } = await import('@modules/tasks/cron/CronRunLog');
      const { resolveDbPath } = await import('@modules/core/paths');
      const runLog = new CronRunLog(resolveDbPath());
      await runLog.init();

      const page = await runLog.queryPage({ jobId, limit, offset, status });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(page));

      await runLog.close();
    } catch (err) {
      await handleError(err, { module: 'infra:http', action: 'handler_error' });
      if (!res.headersSent) {
        try {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Internal server error' } }));
        } catch {} /* res可能已结束, 忽略 */
      }
    }
  }
