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

// ========== PDCA Handlers ==========

export async function handlePdcaStart(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
    const body = await ctx.readRequestBody(req);
      const { description, sessionId } = JSON.parse(body);
      const taskId = `pdca_${Date.now().toString(36)}`;

      const { getOrCreateOrchestrator } = await import('@modules/tasks/LongRunningTaskOrchestrator');
      const orchestrator = getOrCreateOrchestrator(taskId);
      const status = await orchestrator.runFullPdca(description, sessionId || '');

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status));
    } catch (err) {
    }
  }

export async function handlePdcaStatus(
  ctx: HandlerCtx,
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    taskId: string
  ): Promise<void> {
    try {
      let orchestrator: any = null;
      try {
        const mod = await import('@modules/tasks/LongRunningTaskOrchestrator');
        orchestrator = mod.getOrchestrator(taskId);
      } catch {
        // 模块加载失败或无 orchestrator
      }
      if (!orchestrator) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ taskId, phase: 'none', planId: '', lifecycle: [] }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(orchestrator.getStatus()));
    } catch (err) {
    }
  }

export async function handlePdcaAudit(
  ctx: HandlerCtx,
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    taskId: string
  ): Promise<void> {
    try {
      let orchestrator: any = null;
      try { const m = await import('@modules/tasks/LongRunningTaskOrchestrator'); orchestrator = m.getOrchestrator(taskId); } catch {}
      if (!orchestrator) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ taskId, error: 'Not available' }));
        return;
      }
      const report = orchestrator.generateReport();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(report));
    } catch (err) {
    }
  }

export async function handlePdcaReviewStep(
  ctx: HandlerCtx,
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    taskId: string,
    stepId: string
  ): Promise<void> {
    try {
      let orchestrator: any = null;
      try { const m = await import('@modules/tasks/LongRunningTaskOrchestrator'); orchestrator = m.getOrchestrator(taskId); } catch {}
      if (!orchestrator) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not available' }));
        return;
      }
      const review = await orchestrator.reviewStep(stepId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(review));
    } catch (err) {
    }
  }

export async function handlePdcaDecideStep(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    taskId: string,
    stepId: string
  ): Promise<void> {
    try {
    const body = await ctx.readRequestBody(req);
      const { decision } = JSON.parse(body);
      let orchestrator: any = null;
      try { const m = await import('@modules/tasks/LongRunningTaskOrchestrator'); orchestrator = m.getOrchestrator(taskId); } catch {}
      if (!orchestrator) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not available' }));
        return;
      }
      await orchestrator.decideStep(stepId, decision);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
    }
  }

export async function handlePdcaList(
  ctx: HandlerCtx,
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      let list: any[] = [];
      try { const m = await import('@modules/tasks/LongRunningTaskOrchestrator'); list = m.getAllOrchestrators().map((o: any) => o.getStatus()); } catch {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(list));
    } catch (err) {
    }
  }

export async function handlePdcaConfirm(
  ctx: HandlerCtx,
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    taskId: string
  ): Promise<void> {
    try {
      let orchestrator: any = null;
      try { const m = await import('@modules/tasks/LongRunningTaskOrchestrator'); orchestrator = m.getOrchestrator(taskId); } catch {}
      if (!orchestrator) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(orchestrator.getStatus()));
    } catch (err) {
    }
  }
