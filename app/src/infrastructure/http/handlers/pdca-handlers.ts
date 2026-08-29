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
import { join } from 'path';
import {
  mkdirSync,
  existsSync,
  writeFileSync,
  readFileSync,
  readdirSync,
} from 'fs';
import { resolveDataSubDir, resolvePyappHome } from '@modules/core';
import { sendError, readRequestBody, broadcastEvent } from './handler-utils';

import { handleError } from '@modules/error';
import { getLogger } from '@modules/monitoring';
import {
  readPdcaCheckpoint,
  writePdcaCheckpoint,
  syncPdcaWorkItemStatus,
} from '@modules/tasks/PdcaWorkItemBridge';
import type { PdcaMetrics } from '@modules/tasks/LongRunningTaskOrchestrator';

const logger = getLogger('pdca:handlers');

/** PDCA 检查点目录 */
const PDCA_CHECKPOINT_DIR = join(resolveDataSubDir('pdca'));

/** WorkItem 持久化目录 */
const WORKITEM_DIR = join(resolveDataSubDir('workitems'));

interface WorkItemRecord {
  id: string;
  workspaceId: string;
  projectId?: string;
  title: string;
  description: string;
  type: string;
  status: string;
  sessionId?: string;
  taskId: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

function ensureWorkItemDir(): void {
  if (!existsSync(WORKITEM_DIR)) {
    mkdirSync(WORKITEM_DIR, { recursive: true });
  }
}

function writeWorkItem(item: WorkItemRecord): void {
  ensureWorkItemDir();
  writeFileSync(
    join(WORKITEM_DIR, `${item.id}.json`),
    JSON.stringify(item, null, 2),
    'utf-8'
  );
}

/** 幂等键检查：相同 sessionId 的进行中 PDCA 任务 */
function findExistingTask(sessionId: string): string | null {
  const dir = PDCA_CHECKPOINT_DIR;
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    const ck = readPdcaCheckpoint(file.replace('.json', ''));
    if (!ck) continue;
    if (
      ck.sessionId === sessionId &&
      ck.status !== 'abort' &&
      ck.status !== 'failed' &&
      ck.status !== 'completed'
    ) {
      return ck.taskId as string;
    }
  }
  return null;
}

/**
 * 启动扫描：检查所有检查点，标记无活跃 orchestrator 的 running 任务为 abort
 */
export function scanAndAbortStalePdcaTasks(): void {
  const dir = PDCA_CHECKPOINT_DIR;
  if (!existsSync(dir)) return;
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  let aborted = 0;

  for (const file of files) {
    const ck = readPdcaCheckpoint(file.replace('.json', ''));
    if (!ck) continue;
    const status = ck.status as string | undefined;
    if (status !== 'started' && status !== 'running') continue;

    const taskId = ck.taskId as string;
    writePdcaCheckpoint(taskId, {
      ...ck,
      status: 'abort',
      abortedAt: new Date().toISOString(),
    });

    if (ck.workItemId) {
      syncPdcaWorkItemStatus(taskId, 'abort');
    }
    aborted++;
    logger.info('PDCA 旧任务已标记 abort', { taskId });
  }

  if (aborted > 0) {
    logger.info(`启动扫描完成：已标记 ${aborted} 个旧 PDCA 任务为 abort`);
  }
}

type OrchestratorLike = {
  getStatus(): unknown;
  generateReport(): unknown;
  reviewStep(stepId: string): Promise<unknown>;
  decideStep(stepId: string, decision: string): Promise<void>;
  confirm?(decision: unknown): Promise<void>;
};

// ========== PDCA Handlers ==========

/**
 * 启动 PDCA 循环
 *
 * 请求体: { description, sessionId, workspaceId?, projectId? }
 * 幂等键: sessionId（同一会话只能有一个进行中的 PDCA）
 * 返回: 202 { taskId, status, workItemId }
 */
export async function handlePdcaStart(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const { description, sessionId, workspaceId, projectId } = JSON.parse(
      body
    ) as {
      description?: string;
      sessionId?: string;
      workspaceId?: string;
      projectId?: string;
    };

    if (!description || !sessionId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '缺少 description 或 sessionId' }));
      return;
    }

    // 幂等键检查：同一 sessionId 已有进行中任务 → 直接返回现有 taskId
    if (sessionId) {
      const existing = findExistingTask(sessionId);
      if (existing) {
        const ck = readPdcaCheckpoint(existing);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            taskId: existing,
            status: ck?.status || 'started',
            workItemId: ck?.workItemId,
            existing: true,
          })
        );
        return;
      }
    }

    const taskId = `pdca_${Date.now().toString(36)}`;
    const now = new Date().toISOString();
    const workItemId = `wi_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // 创建关联 WorkItem
    const workItem: WorkItemRecord = {
      id: workItemId,
      workspaceId: workspaceId || 'default',
      projectId: projectId,
      title: description.slice(0, 100),
      description: description,
      type: 'pdca',
      status: 'pending',
      sessionId,
      taskId,
      createdAt: now,
      updatedAt: now,
    };
    writeWorkItem(workItem);

    const { getOrCreateOrchestrator } = await import('@modules/tasks');
    const orchestrator = getOrCreateOrchestrator(taskId);

    // 异步执行 PDCA，不阻塞 HTTP 响应
    void orchestrator.runFullPdca(description, sessionId).catch(async (e) => {
      const { handleError } = await import('@modules/error');
      handleError(e, {
        module: 'infrastructure:http:handlers:pdca-handlers',
        action: 'runFullPdca',
        context: { taskId, workItemId },
      });
    });

    // 持久化检查点（含归属信息）
    writePdcaCheckpoint(taskId, {
      taskId,
      workItemId,
      status: 'started',
      description,
      sessionId,
      workspaceId: workspaceId || 'default',
      projectId,
    });

    // 关联到项目（归属打通）
    if (projectId) {
      try {
        const projPath = join(
          resolvePyappHome(),
          'projects',
          projectId,
          'project.json'
        );
        if (existsSync(projPath)) {
          const proj = JSON.parse(readFileSync(projPath, 'utf-8'));
          if (!proj.pdcaIds) proj.pdcaIds = [];
          if (!proj.pdcaIds.includes(taskId)) {
            proj.pdcaIds.push(taskId);
            proj.updatedAt = new Date().toISOString();
            writeFileSync(projPath, JSON.stringify(proj, null, 2), 'utf-8');
          }
        }
      } catch {
        /* 项目关联失败不影响 PDCA 启动 */
      }
    }

    // 立即返回 taskId，前端可轮询 GET /v1/pdca/:taskId 获取进度
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ taskId, status: 'started', workItemId }));
    broadcastEvent('pdca:started', { taskId, workItemId });
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
    let orchestrator: OrchestratorLike | null = null;
    try {
      const mod = await import('@modules/tasks');
      orchestrator = (mod.getOrchestrator(taskId) ??
        null) as OrchestratorLike | null;
    } catch (err) {
      // 模块加载失败或无 orchestrator

      handleError(err, {
        module: 'infrastructure:http:handlers:pdca-handlers',
        action: 'orchestratorModuleFailed',
      });
    }
    if (!orchestrator) {
      // 回退到检查点文件
      const checkpoint = readPdcaCheckpoint(taskId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify(
          checkpoint || { taskId, phase: 'none', planId: '', lifecycle: [] }
        )
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
    let orchestrator: OrchestratorLike | null = null;
    try {
      const m = await import('@modules/tasks');
      orchestrator = (m.getOrchestrator(taskId) ??
        null) as OrchestratorLike | null;
    } catch (err) {
      handleError(err, {
        module: 'infrastructure:http:handlers:pdca-handlers',
        action: 'orchestratorImportFailed',
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
    let orchestrator: OrchestratorLike | null = null;
    try {
      const m = await import('@modules/tasks');
      orchestrator = (m.getOrchestrator(taskId) ??
        null) as OrchestratorLike | null;
    } catch (err) {
      handleError(err, {
        module: 'infrastructure:http:handlers:pdca-handlers',
        action: 'orchestratorImportFailed',
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
    let orchestrator: OrchestratorLike | null = null;
    try {
      const m = await import('@modules/tasks');
      orchestrator = (m.getOrchestrator(taskId) ??
        null) as OrchestratorLike | null;
    } catch (err) {
      handleError(err, {
        module: 'infrastructure:http:handlers:pdca-handlers',
        action: 'orchestratorImportFailed',
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
 *
 * POST /v1/pdca/list
 * 请求体（可选）: { workspaceId?: string }
 * 传入 workspaceId 时按项目过滤（通过关联 Plan 的 workspaceId 字段）
 */
export async function handlePdcaList(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    let workspaceId: string | undefined;
    try {
      const body = await readRequestBody(req);
      const parsed = JSON.parse(body || '{}') as { workspaceId?: string };
      workspaceId = parsed.workspaceId;
    } catch {
      /* 无请求体时不过滤 */
    }

    let list: unknown[] = [];
    try {
      const m = await import('@modules/tasks');
      list = m
        .getAllOrchestrators()
        .map((o: unknown) => (o as OrchestratorLike).getStatus());
    } catch (err) {
      handleError(err, {
        module: 'infrastructure:http:handlers:pdca-handlers',
        action: 'orchestratorImportFailed',
      });
    } /* 可选模块, 加载失败时降级 */

    // 按 workspaceId 过滤（通过关联 Plan 的 workspaceId 字段）
    if (workspaceId) {
      list = list.filter((item) => {
        const status = item as { plan?: { workspaceId?: string } };
        return status?.plan?.workspaceId === workspaceId;
      });
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(list));
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 获取 PDCA 监控指标（S1 灰度观测，P1-5 §5 S1）
 *
 * GET /v1/tasks/pdca/metrics
 * 数据来源：LongRunningTaskOrchestrator.getAllOrchestrators() → getMetrics()。
 * 步骤级统计经 TaskOrchestrator 单例（taskOrchestrator），经典路径（LongRunningTaskOrchestrator）
 * 与快速路径（PlanDrivenLoop 的 markStepRunning/Completed/Failed）记账同源（S1 验证结论）；
 * totalCycles 仅统计经典路径生命周期事件，快速路径按 decomposed=true 的 run 计数由 S2 落库补齐。
 * 返回：{ tasks: [{ taskId, metrics }], total: 聚合指标 }
 */
export async function handlePdcaMetrics(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    let tasks: Array<{ taskId: string; metrics: PdcaMetrics }> = [];
    try {
      const m = await import('@modules/tasks');
      tasks = m.getAllOrchestrators().map((o) => {
        const status = o.getStatus() as { taskId?: string };
        return {
          taskId: status?.taskId ?? 'unknown',
          metrics: o.getMetrics(),
        };
      });
    } catch (err) {
      handleError(err, {
        module: 'infrastructure:http:handlers:pdca-handlers',
        action: 'orchestratorImportFailed',
      });
    } /* 可选模块, 加载失败时降级 */

    const count = tasks.length;
    const total: PdcaMetrics = {
      totalCycles: tasks.reduce((s, t) => s + t.metrics.totalCycles, 0),
      totalSteps: tasks.reduce((s, t) => s + t.metrics.totalSteps, 0),
      completedSteps: tasks.reduce((s, t) => s + t.metrics.completedSteps, 0),
      failedSteps: tasks.reduce((s, t) => s + t.metrics.failedSteps, 0),
      avgStepDurationMs:
        count > 0
          ? Math.round(
              tasks.reduce((s, t) => s + t.metrics.avgStepDurationMs, 0) / count
            )
          : 0,
      avgReviewScore:
        count > 0
          ? Math.round(
              tasks.reduce((s, t) => s + t.metrics.avgReviewScore, 0) / count
            )
          : 0,
      reviewPassRate:
        count > 0
          ? Math.round(
              tasks.reduce((s, t) => s + t.metrics.reviewPassRate, 0) / count
            )
          : 100,
      toolFailureSteps: tasks.reduce(
        (s, t) => s + t.metrics.toolFailureSteps,
        0
      ),
      abortRate:
        count > 0
          ? Math.round(
              tasks.reduce((s, t) => s + t.metrics.abortRate, 0) / count
            )
          : 0,
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ tasks, total }));
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
    let orchestrator: OrchestratorLike | null = null;
    try {
      const m = await import('@modules/tasks');
      orchestrator = (m.getOrchestrator(taskId) ??
        null) as OrchestratorLike | null;
    } catch (err) {
      handleError(err, {
        module: 'infrastructure:http:handlers:pdca-handlers',
        action: 'orchestratorImportFailed',
      });
    } /* 可选模块, 加载失败时降级 */
    if (!orchestrator) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not available' }));
      return;
    }
    await orchestrator.confirm?.(undefined);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  } catch (err) {
    sendError(res, err);
  }
}
