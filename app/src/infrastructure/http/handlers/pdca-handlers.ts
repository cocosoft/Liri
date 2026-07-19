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
// IMPLIED, BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/* eslint-disable @typescript-eslint/no-explicit-any -- legacy code with dynamic types */

import type http from 'http';
import { sendError, readRequestBody, broadcastEvent } from './handler-utils';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'infrastructure:http:handlers:pdca-handlers',
  level: LogLevel.INFO,
});

// ========== PDCA Handlers ==========

/**
 * 启动 PDCA 循环
 */
export async function handlePdcaStart(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const { description, sessionId } = JSON.parse(body);
    const taskId = `pdca_${Date.now().toString(36)}`;

    const { getOrCreateOrchestrator } =
      await import('@modules/tasks/LongRunningTaskOrchestrator');
    const orchestrator = getOrCreateOrchestrator(taskId);
    const status = await orchestrator.runFullPdca(description, sessionId || '');

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status));
    broadcastEvent('pdca:started', { taskId, status });
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 获取 PDCA 状态
 */
export async function handlePdcaStatus(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  taskId: string
): Promise<void> {
  try {
    let orchestrator: any = null;
    try {
      const mod = await import('@modules/tasks/LongRunningTaskOrchestrator');
      orchestrator = mod.getOrchestrator(taskId);
    } catch (err) {
      // 模块加载失败或无 orchestrator

      logger.warn('Operation skipped', {
        context: '模块加载失败或无 orchestrator',
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if (!orchestrator) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ taskId, phase: 'none', planId: '', lifecycle: [] })
      );
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(orchestrator.getStatus()));
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 获取 PDCA 审计报告
 */
export async function handlePdcaAudit(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  taskId: string
): Promise<void> {
  try {
    let orchestrator: any = null;
    try {
      const m = await import('@modules/tasks/LongRunningTaskOrchestrator');
      orchestrator = m.getOrchestrator(taskId);
    } catch (err) {
      logger.debug('Operation skipped', {
        error: err instanceof Error ? err.message : String(err),
      });
    } /* 可选模块, 加载失败时降级 */
    if (!orchestrator) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ taskId, error: 'Not available' }));
      return;
    }
    const report = orchestrator.generateReport();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(report));
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 审阅 PDCA 步骤
 */
export async function handlePdcaReviewStep(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  taskId: string,
  stepId: string
): Promise<void> {
  try {
    let orchestrator: any = null;
    try {
      const m = await import('@modules/tasks/LongRunningTaskOrchestrator');
      orchestrator = m.getOrchestrator(taskId);
    } catch (err) {
      logger.debug('Operation skipped', {
        error: err instanceof Error ? err.message : String(err),
      });
    } /* 可选模块, 加载失败时降级 */
    if (!orchestrator) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not available' }));
      return;
    }
    const review = await orchestrator.reviewStep(stepId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(review));
    broadcastEvent('pdca:reviewed', { taskId, stepId, review });
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 决定 PDCA 步骤
 */
export async function handlePdcaDecideStep(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  taskId: string,
  stepId: string
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const { decision } = JSON.parse(body);
    let orchestrator: any = null;
    try {
      const m = await import('@modules/tasks/LongRunningTaskOrchestrator');
      orchestrator = m.getOrchestrator(taskId);
    } catch (err) {
      logger.debug('Operation skipped', {
        error: err instanceof Error ? err.message : String(err),
      });
    } /* 可选模块, 加载失败时降级 */
    if (!orchestrator) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not available' }));
      return;
    }
    await orchestrator.decideStep(stepId, decision);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    broadcastEvent('pdca:decided', { taskId, stepId, decision });
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 列出所有 PDCA 任务
 */
export async function handlePdcaList(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    let list: any[] = [];
    try {
      const m = await import('@modules/tasks/LongRunningTaskOrchestrator');
      list = m.getAllOrchestrators().map((o: any) => o.getStatus());
    } catch (err) {
      logger.debug('Operation skipped', {
        error: err instanceof Error ? err.message : String(err),
      });
    } /* 可选模块, 加载失败时降级 */
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(list));
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 确认 PDCA 任务
 */
export async function handlePdcaConfirm(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  taskId: string
): Promise<void> {
  try {
    let orchestrator: any = null;
    try {
      const m = await import('@modules/tasks/LongRunningTaskOrchestrator');
      orchestrator = m.getOrchestrator(taskId);
    } catch (err) {
      logger.debug('Operation skipped', {
        error: err instanceof Error ? err.message : String(err),
      });
    } /* 可选模块, 加载失败时降级 */
    if (!orchestrator) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not available' }));
      return;
    }
    await orchestrator.confirm(undefined);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  } catch (err) {
    sendError(res, err);
  }
}
