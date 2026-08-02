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

import type http from 'http';
import { sendError, readRequestBody, broadcastEvent } from './handler-utils';

// ========== PlanFlow Handlers ==========

/**
 * 列出所有计划
 */
export async function handleListPlans(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { taskOrchestrator } =
      await import('@modules/tasks/TaskOrchestrator');
    await taskOrchestrator['initialize']();
    const plans = taskOrchestrator.getAllPlans();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(plans));
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 创建计划
 */
export async function handleCreatePlan(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { taskOrchestrator } =
      await import('@modules/tasks/TaskOrchestrator');
    const body = await readRequestBody(req);
    const { description, steps, sessionId } = JSON.parse(body);
    const plan = taskOrchestrator.createPlan(
      description || '',
      steps || [],
      sessionId || ''
    );
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(plan));
    broadcastEvent('plan:created', { planId: plan.id });
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 获取指定计划
 */
export async function handleGetPlan(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  planId: string
): Promise<void> {
  try {
    const { taskOrchestrator } =
      await import('@modules/tasks/TaskOrchestrator');
    const plan = taskOrchestrator.getPlan(planId);
    if (!plan) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Plan not found' }));
      return;
    }
    const progress = taskOrchestrator.getPlanProgress(planId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ plan, progress }));
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 执行计划
 */
export async function handleExecutePlan(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  planId: string
): Promise<void> {
  try {
    const { taskOrchestrator } =
      await import('@modules/tasks/TaskOrchestrator');
    const plan = taskOrchestrator.getPlan(planId);
    if (!plan) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Plan not found' }));
      return;
    }
    // 标记所有 pending 步骤为 running
    for (const step of plan.steps) {
      if (step.status === 'pending') {
        taskOrchestrator.markStepRunning(step.id);
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, planId }));
    broadcastEvent('plan:executed', { planId });
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 中止计划
 */
export async function handleAbortPlan(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  planId: string
): Promise<void> {
  try {
    const { taskOrchestrator } =
      await import('@modules/tasks/TaskOrchestrator');
    const plan = taskOrchestrator.getPlan(planId);
    if (!plan) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Plan not found' }));
      return;
    }
    // 标记所有 running/pending 步骤为 cancelled
    for (const step of plan.steps) {
      if (step.status === 'running' || step.status === 'pending') {
        taskOrchestrator.markStepFailed(step.id, '已终止');
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, planId }));
    broadcastEvent('plan:aborted', { planId });
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 列出所有流程
 */
export async function handleListFlows(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { taskFlowRegistry } =
      await import('@modules/tasks/TaskFlowRegistry');
    const flows = taskFlowRegistry.getAllFlows();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(flows));
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 获取指定流程
 */
export async function handleGetFlow(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  flowId: string
): Promise<void> {
  try {
    const { taskFlowRegistry } =
      await import('@modules/tasks/TaskFlowRegistry');
    const flow = taskFlowRegistry.getFlow(flowId);
    if (!flow) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Flow not found' }));
      return;
    }
    const stats = taskFlowRegistry.getStats();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ flow, stats }));
  } catch (err) {
    sendError(res, err);
  }
}
