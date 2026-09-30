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
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'fs';
import { resolveDataSubDir, resolvePyappHome } from '@modules/core';
import { sendError, readRequestBody, broadcastEvent } from './handler-utils';

import { handleError } from '@modules/error';
import { getLogger } from '@modules/monitoring';
// C1（2026-09-30 D-103，`tasks` 域 P3-b）：改经服务层端口
import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';
// ⚠️ **类型位** app 类型（原文由 tasks 域提供）已替换为服务层端口类型。
// 此处**故意不写完整导入路径** —— 门禁不剥离注释，写了会让「对」复活（见台账 D-77）
import type {
  PdcaMetricsDto,
  PdcaOrchestratorPort,
} from '@modules/runtime/api/taskOpsPorts';

const logger = getLogger('pdca:handlers');

/**
 * OBS（M3b-DB）：GET /v1/pdca/decisions?limit=N
 * 查询 task_audit_log 中 event_type='pdca_decision' 的决策轨迹（分流归因）。
 */
export async function handlePdcaDecisionLog(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const parsed = new URL(req.url ?? '', 'http://localhost');
    const rawLimit = Number(parsed.searchParams.get('limit') ?? 100);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(Math.floor(rawLimit), 1), 500)
      : 100;
    const rows = await (
      await getCoreAPI().getTaskOpsPort()
    ).listPdcaDecisionRows(limit);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        decisions: rows.map((r) => {
          let parsedDetail: unknown = null;
          try {
            parsedDetail = r.detail ? JSON.parse(r.detail) : null;
          } catch {
            parsedDetail = r.detail;
          }
          return {
            taskId: r.taskId,
            choice: r.newStatus,
            detail: parsedDetail,
            timestamp: r.timestamp,
          };
        }),
      })
    );
  } catch (e) {
    await handleError(e, {
      module: 'pdca:handlers',
      action: 'decisionLog',
    });
    sendError(res, new Error('查询决策轨迹失败'), 500);
  }
}

/**
 * WorkItem 持久化目录（**惰性解析**，2026-09-29 台账「另案 ⑤」）。
 *
 * ⚠️ 原实现是**模块顶层常量** ⇒ 路径在模块**求值**时被冻结。`bun test` 的 preload 链
 * （`tests/setupIsolateAgentStore.ts`）会**先于**测试文件加载本模块，测试再设
 * `LIRI_HOME` / `LIRI_DATA_DIR` 已不生效 ⇒ 单测实际读写**真实**数据目录。改为**调用时解析**，
 * 与 [`CheckpointLogConfig`](../config/settings/CheckpointLogConfig.ts) 的"不在模块顶层解析路径"
 * 既有约定一致。
 *
 * 注：**检查点目录**已不在本文件解析 —— 台账「另案 ⑥」后统一走
 * [`getPdcaCheckpointIndex()`](../tasks/PdcaWorkItemBridge.ts)（同一惰性口径在其内部实现），
 * 故本文件只保留 WorkItem 目录。
 */
function workitemDir(): string {
  return resolveDataSubDir('workitems');
}

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
  if (!existsSync(workitemDir())) {
    mkdirSync(workitemDir(), { recursive: true });
  }
}

function writeWorkItem(item: WorkItemRecord): void {
  ensureWorkItemDir();
  writeFileSync(
    join(workitemDir(), `${item.id}.json`),
    JSON.stringify(item, null, 2),
    'utf-8'
  );
}

/** 幂等键检查：相同 sessionId 的进行中 PDCA 任务 */
async function findExistingTask(sessionId: string): Promise<string | null> {
  // 2026-09-29（台账「另案 ⑥」）：改用桥接层**带记忆的索引**（原实现每请求全量 read+parse）；
  // "非活跃"判据收敛到**终态集**（与留存清理同源，GR02 实现唯一性）
  const taskOps = await getCoreAPI().getTaskOpsPort();
  const [checkpoints, statusSets] = await Promise.all([
    taskOps.getPdcaCheckpointIndex(),
    taskOps.getPdcaStatusSets(),
  ]);
  for (const ck of checkpoints.values()) {
    if (
      ck.sessionId === sessionId &&
      !statusSets.terminal.has(ck.status as string)
    ) {
      return ck.taskId as string;
    }
  }
  return null;
}

/**
 * 启动扫描：检查所有检查点，标记无活跃 orchestrator 的 running 任务为 abort
 *
 * ⚠️ C1（D-103）：原为**同步**函数，因端口 API 异步化 ⇒ 改为 `async`；
 * 唯一调用方 `main.ts` 已同步改为 `await`（**保持**"扫描先于留存清理"的既有次序约束）。
 */
export async function scanAndAbortStalePdcaTasks(): Promise<void> {
  // 2026-09-29（台账「另案 ⑥」）：同批改用带记忆索引 —— 本函数虽只在启动时跑一次，
  // 但目录达 3394 文件时原实现同样要 ≈1s 全量 read+parse。
  let aborted = 0;
  const taskOps = await getCoreAPI().getTaskOpsPort();
  const [checkpoints, statusSets] = await Promise.all([
    taskOps.getPdcaCheckpointIndex(),
    taskOps.getPdcaStatusSets(),
  ]);

  for (const ck of checkpoints.values()) {
    // 命中判据与豁免判据**与留存清理同源**（GR02）：活跃集 / 待审批阶段集
    const status = ck.status as string | undefined;
    if (status === undefined || !statusSets.active.has(status)) continue;
    // Gap D（1-0c，2026-09-03）：等待审批的任务（plan_pending/stage_awaiting_approval）
    // 不是崩溃遗留——重启后应保留供 /goal 审批/恢复，不得被启动扫描误 abort。
    // （1-0b 后 plan_pending 的 status 演进为 'started'，故此处需按 phase 二次排除。）
    const phase = ck.phase as string | undefined;
    if (phase !== undefined && statusSets.awaitingApprovalPhases.has(phase)) {
      continue;
    }

    const taskId = ck.taskId as string;
    await taskOps.writePdcaCheckpoint(taskId, {
      ...ck,
      status: 'abort',
      abortedAt: new Date().toISOString(),
    });

    if (ck.workItemId) {
      await taskOps.syncPdcaWorkItemStatus(taskId, 'abort');
    }
    aborted++;
    logger.info('PDCA 旧任务已标记 abort', { taskId });
  }

  if (aborted > 0) {
    logger.info(`启动扫描完成：已标记 ${aborted} 个旧 PDCA 任务为 abort`);
  }
}

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
      const existing = await findExistingTask(sessionId);
      if (existing) {
        const ck = await (
          await getCoreAPI().getTaskOpsPort()
        ).readPdcaCheckpoint(existing);
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

    const orchestrator = await (
      await getCoreAPI().getTaskOpsPort()
    ).getOrCreatePdcaOrchestrator(taskId);

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
    await (
      await getCoreAPI().getTaskOpsPort()
    ).writePdcaCheckpoint(taskId, {
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
    // 1-5 P1（2026-09-03）：响应含 phase 契约（初始 'plan'；真实 phase 以轮询 status 为准）
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        taskId,
        status: 'started',
        workItemId,
        phase: 'plan',
      })
    );
    broadcastEvent('pdca:started', { taskId, workItemId });
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 1-5 P2（2026-09-04）：由 checkpoint steps 快照推导 progress 读模型。
 * 仅统计已知状态（completed/running/failed/cancelled），其余归入 pending；
 * 非数组/空数组返回 undefined（调用方据此省略 progress，不编造进度）。
 */
function deriveCheckpointProgress(steps: Array<Record<string, unknown>>):
  | {
      total: number;
      pending: number;
      running: number;
      completed: number;
      failed: number;
      cancelled: number;
      percent: number;
    }
  | undefined {
  const total = steps.length;
  if (total === 0) return undefined;
  let completed = 0;
  let running = 0;
  let failed = 0;
  let cancelled = 0;
  for (const s of steps) {
    const st = s.status;
    if (st === 'completed') completed++;
    else if (st === 'running') running++;
    else if (st === 'failed') failed++;
    else if (st === 'cancelled') cancelled++;
  }
  return {
    total,
    pending: total - completed - running - failed - cancelled,
    running,
    completed,
    failed,
    cancelled,
    percent: Math.round((completed / total) * 100),
  };
}

export async function handlePdcaStatus(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  taskId: string
): Promise<void> {
  try {
    let orchestrator: PdcaOrchestratorPort | null = null;
    try {
      orchestrator = await (
        await getCoreAPI().getTaskOpsPort()
      ).getPdcaOrchestrator(taskId);
    } catch (err) {
      // 模块加载失败或无 orchestrator

      handleError(err, {
        module: 'infrastructure:http:handlers:pdca-handlers',
        action: 'orchestratorModuleFailed',
      });
    }
    if (!orchestrator) {
      // 回退到检查点文件（1-5 P2，2026-09-04）：不再原样返回扁平 checkpoint，
      // 构造与 getStatus() 对齐的读模型——plan/progress 由快照 steps 推导（原样透传），
      // 无 steps 时省略 plan/progress（不编造），checkpoint 不存在时保持原空态。
      const ck = await (
        await getCoreAPI().getTaskOpsPort()
      ).readPdcaCheckpoint(taskId);
      if (!ck) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ taskId, phase: 'none', planId: '', lifecycle: [] })
        );
        return;
      }
      const rec = ck as Record<string, unknown>;
      const rawSteps = rec.steps;
      const steps =
        Array.isArray(rawSteps) && rawSteps.length > 0
          ? (rawSteps as Array<Record<string, unknown>>)
          : undefined;
      const plan = steps
        ? {
            id: (rec.planId as string) || taskId,
            description: (rec.description as string) ?? '',
            steps,
          }
        : undefined;
      const progress = steps ? deriveCheckpointProgress(steps) : undefined;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          taskId,
          planId: (rec.planId as string) ?? '',
          phase: (rec.phase as string) ?? 'none',
          status: (rec.status as string) ?? 'unknown',
          description: (rec.description as string) ?? '',
          plan,
          progress,
          workItemId: rec.workItemId,
          workspaceId: rec.workspaceId,
          projectId: rec.projectId,
          sessionId: rec.sessionId,
          totalTokens: rec.totalTokens,
          source: 'checkpoint',
        })
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
    let orchestrator: PdcaOrchestratorPort | null = null;
    try {
      orchestrator = await (
        await getCoreAPI().getTaskOpsPort()
      ).getPdcaOrchestrator(taskId);
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
    let orchestrator: PdcaOrchestratorPort | null = null;
    try {
      orchestrator = await (
        await getCoreAPI().getTaskOpsPort()
      ).getPdcaOrchestrator(taskId);
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
    let orchestrator: PdcaOrchestratorPort | null = null;
    try {
      orchestrator = await (
        await getCoreAPI().getTaskOpsPort()
      ).getPdcaOrchestrator(taskId);
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
 * 请求体（可选）: { workspaceId?: string; projectId?: string; sessionId?: string }
 * 数据源 = 内存 orchestrator（活跃）+ checkpoint 回退（跨重启遗留，1-5 P1 前置 2026-09-03）：
 * checkpoint 含 Gap D 修复保留的归属字段（workItemId/workspaceId/projectId/status/phase），
 * 重启后 list 不再为空。过滤字段取自各条目的归属（checkpoint 优先）。
 */
export async function handlePdcaList(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    let filter: {
      workspaceId?: string;
      projectId?: string;
      sessionId?: string;
    };
    try {
      const body = await readRequestBody(req);
      const parsed = JSON.parse(body || '{}') as typeof filter;
      filter = parsed;
    } catch {
      filter = {};
    }

    // checkpoint 目录索引（taskId → checkpoint，归属/状态权威）
    // 2026-09-29（台账「另案 ⑥」）：改用桥接层的**带记忆索引** —— 原实现对整个目录逐文件
    // `readFileSync`+`JSON.parse`（真实目录 3394 个 json ⇒ ≈**1.0s/请求**），
    // 且与 `listPdcaCheckpoints()` 重复实现（GR02 实现唯一性）。
    const ckByTask = await (
      await getCoreAPI().getTaskOpsPort()
    ).getPdcaCheckpointIndex();

    // 内存 orchestrator 条目（活跃任务）——checkpoint 归属字段回填（checkpoint 优先）
    let memoryItems: Record<string, unknown>[] = [];
    try {
      const orchestrators = await (
        await getCoreAPI().getTaskOpsPort()
      ).listPdcaOrchestrators();
      memoryItems = orchestrators.map((o) => {
        const st = o.getStatus();
        return (st ?? {}) as Record<string, unknown>;
      });
    } catch (err) {
      handleError(err, {
        module: 'infrastructure:http:handlers:pdca-handlers',
        action: 'orchestratorImportFailed',
      });
    } /* 可选模块, 加载失败时降级 */

    const inMemoryIds = new Set(
      memoryItems.map((it) => it.taskId as string).filter(Boolean)
    );
    const items: Record<string, unknown>[] = memoryItems.map((st) => {
      const ck = ckByTask.get(st.taskId as string);
      if (!ck) return st;
      // 内存态优先（phase/status/lifecycle 实时），归属字段 checkpoint 兜底
      return {
        ...st,
        workItemId: ck.workItemId ?? st.workItemId,
        projectId: ck.projectId ?? st.projectId,
        workspaceId: ck.workspaceId ?? st.workspaceId,
        sessionId: ck.sessionId ?? st.sessionId,
        status: st.status ?? ck.status,
        phase: st.phase ?? ck.phase,
      };
    });

    // checkpoint-only 任务（跨重启遗留/未加载到内存）——补全统一字段
    for (const [taskId, ck] of ckByTask) {
      if (inMemoryIds.has(taskId)) continue;
      items.push({
        taskId,
        phase: ck.phase ?? 'none',
        status: ck.status ?? 'unknown',
        description: ck.description ?? undefined,
        workItemId: ck.workItemId ?? undefined,
        projectId: ck.projectId ?? undefined,
        workspaceId: ck.workspaceId ?? undefined,
        sessionId: ck.sessionId ?? undefined,
        source: 'checkpoint',
      });
    }

    // 过滤（归属字段精确匹配，缺省字段不过滤）
    const filtered = items.filter((item) => {
      if (filter.workspaceId && item.workspaceId !== filter.workspaceId) {
        return false;
      }
      if (filter.projectId && item.projectId !== filter.projectId) {
        return false;
      }
      if (filter.sessionId && item.sessionId !== filter.sessionId) {
        return false;
      }
      return true;
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(filtered));
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
    let tasks: Array<{ taskId: string; metrics: PdcaMetricsDto }> = [];
    try {
      const orchestrators = await (
        await getCoreAPI().getTaskOpsPort()
      ).listPdcaOrchestrators();
      tasks = orchestrators.map((o) => {
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
    const total: PdcaMetricsDto = {
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
    let orchestrator: PdcaOrchestratorPort | null = null;
    try {
      orchestrator = await (
        await getCoreAPI().getTaskOpsPort()
      ).getPdcaOrchestrator(taskId);
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
