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
// C1（2026-09-30 D-102，`tasks` 域 P3）：改经服务层端口
import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';

// ========== PlanFlow Handlers ==========

/**
 * 列出所有计划
 * 支持 ?workspaceId= 查询参数：按项目过滤；不传则返回全部
 */
export async function handleListPlans(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const taskOps = await getCoreAPI().getTaskOpsPort();
    await taskOps.initTaskOrchestrator();
    const url = new URL(req.url ?? '', 'http://localhost');
    const workspaceId = url.searchParams.get('workspaceId');
    const plans = workspaceId
      ? await taskOps.getPlansByWorkspace(workspaceId)
      : await taskOps.getAllPlans();
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
    const taskOps = await getCoreAPI().getTaskOpsPort();
    const body = await readRequestBody(req);
    const { description, steps, sessionId, workspaceId } = JSON.parse(body);
    const plan = await taskOps.createPlan({
      description: description || '',
      stepDescriptions: steps || [],
      sessionId: sessionId || '',
      workspaceId,
    });
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
    const taskOps = await getCoreAPI().getTaskOpsPort();
    const plan = await taskOps.getPlan(planId);
    if (!plan) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Plan not found' }));
      return;
    }
    const progress = await taskOps.getPlanProgress(planId);
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
    const taskOps = await getCoreAPI().getTaskOpsPort();
    const plan = await taskOps.getPlan(planId);
    if (!plan) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Plan not found' }));
      return;
    }
    // 标记所有 pending 步骤为 running
    for (const step of plan.steps) {
      if (step.status === 'pending') {
        await taskOps.markStepRunning(step.id);
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
    const taskOps = await getCoreAPI().getTaskOpsPort();
    const plan = await taskOps.getPlan(planId);
    if (!plan) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Plan not found' }));
      return;
    }
    // 标记所有 running/pending 步骤为 cancelled
    for (const step of plan.steps) {
      if (step.status === 'running' || step.status === 'pending') {
        await taskOps.markStepFailed(step.id, '已终止');
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
    const taskOps = await getCoreAPI().getTaskOpsPort();
    const flows = await taskOps.listTaskFlows();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(flows));
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 获取计划 DAG（步骤依赖拓扑）
 * GET /v1/plans/:id/dag
 * 从 PlanStep.dependsOn 构建 nodes + edges，供前端 DAG 可视化
 */
export async function handleGetPlanDAG(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  planId: string
): Promise<void> {
  try {
    const taskOps = await getCoreAPI().getTaskOpsPort();
    const plan = await taskOps.getPlan(planId);
    if (!plan) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Plan not found' }));
      return;
    }

    const nodes = plan.steps.map((s) => ({
      id: s.id,
      label: s.description,
      status: s.status,
      taskId: s.taskId,
    }));

    const edges: Array<{ from: string; to: string }> = [];
    for (const s of plan.steps) {
      for (const depId of s.dependsOn || []) {
        edges.push({ from: depId, to: s.id });
      }
    }

    const progress = await taskOps.getPlanProgress(planId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ planId, nodes, edges, progress }));
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
    const taskOps = await getCoreAPI().getTaskOpsPort();
    const flow = await taskOps.getTaskFlow(flowId);
    if (!flow) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Flow not found' }));
      return;
    }
    const stats = await taskOps.getTaskFlowStats();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ flow, stats }));
  } catch (err) {
    sendError(res, err);
  }
}
