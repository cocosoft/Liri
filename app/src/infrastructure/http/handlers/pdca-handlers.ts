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
// C1（2026-10-09）：工作项 id 熵源改用 crypto
import { randomIdSuffix } from '@openliri/infra/utils/common';
import { join } from 'path';
import { existsSync, writeFileSync, readFileSync } from 'fs';
import { resolvePyappHome } from '@openliri/infra/environment';
import { LOCAL_REQUEST_BASE_URL } from '@openliri/kernel';
// R03-002：常量必须走模块出口（B 类运行参数统一由 infra constants 供值）
import {
  PDCA_LIST_DEFAULT_LIMIT,
  PDCA_LIST_MAX_LIMIT,
} from '@openliri/infra/constants';
import { sendError, readRequestBody, broadcastEvent } from './handler-utils';

import { handleError } from '@openliri/infra/error';
import { getLogger } from '@openliri/infra/monitoring';
// C1（2026-09-30 D-103，`tasks` 域 P3-b）：改经服务层端口
import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';
// 2026-11-08（存量收口）：判断"待审批任务是否还有人能点"须读收件箱 pending 卡
import { inboxManager } from '@openliri/service/runtime/InboxManager';
// ⚠️ **类型位** app 类型（原文由 tasks 域提供）已替换为服务层端口类型。
// 此处**故意不写完整导入路径** —— 门禁不剥离注释，写了会让「对」复活（见台账 D-77）
import type {
  PdcaMetricsDto,
  PdcaOrchestratorPort,
} from '@openliri/service/runtime/api/taskOpsPorts';

const logger = getLogger('pdca:handlers');

/**
 * 步骤决策的合法取值（与 `tasks/PlanReview` 的 `ReviewDecision` 同源）。
 *
 * 2026-11-07（真机 `pdca_mw6f842k`）：`POST /v1/pdca/:id/step/:stepId/decide` 原先直接
 * 把请求体透传给编排器 —— 非法值（实测 `bogus`）被写进 `plan.steps[].decision` 且回
 * `200 {ok:true}`。HTTP 是**未受信边界**，这里必须显式校验。
 */
const PDCA_STEP_DECISIONS = [
  'approved',
  'retry',
  'skip',
  'escalate',
  'suspend',
] as const;

/** 决策取值校验（HTTP 未受信边界的唯一判据） */
function isPdcaStepDecision(
  value: string
): value is (typeof PDCA_STEP_DECISIONS)[number] {
  return (PDCA_STEP_DECISIONS as readonly string[]).includes(value);
}

/**
 * OBS（M3b-DB）：GET /v1/pdca/decisions?limit=N
 * 查询 task_audit_log 中 event_type='pdca_decision' 的决策轨迹（分流归因）。
 */
export async function handlePdcaDecisionLog(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const parsed = new URL(req.url ?? '', LOCAL_REQUEST_BASE_URL);
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

/**
 * 检查点是否**仍在生命周期内**（非终态）—— 幂等键与启动扫描的**唯一判据**。
 *
 * 2026-11-08（僵尸任务取证，真机 95 条 / 63 个会话）：
 * 此前两个入口对**同一批行**的解读相反 ——
 * - `findExistingTask`：`status ∉ 终态` ⇒ 视为进行中 ⇒ `status IS NULL` 的老行**永久锁会话**；
 * - `scanAndAbortStalePdcaTasks`：`status` 必须 ∈ 活跃集 ⇒ `status IS NULL` 直接 `continue`
 *   ⇒ 同一批行**永不清理**。
 *
 * 现统一口径（与留存清理同源，GR02）：检查点**两个字段并用**，
 * `phase` 或 `status` **任一**为终态即算终态；两者都缺省则按非终态处理
 * （宁可多留一轮，也不把可能在跑的任务判死）。
 */
function isCheckpointLive(
  ck: Record<string, unknown>,
  sets: { terminal: ReadonlySet<string>; terminalPhases: ReadonlySet<string> }
): boolean {
  const status = ck.status as string | undefined;
  const phase = ck.phase as string | undefined;
  if (status !== undefined && sets.terminal.has(status)) return false;
  if (phase !== undefined && sets.terminalPhases.has(phase)) return false;
  return true;
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
    if (ck.sessionId === sessionId && isCheckpointLive(ck, statusSets)) {
      return ck.taskId as string;
    }
  }
  return null;
}

/**
 * 构造「已终止」检查点补丁（启动扫描 / 孤儿收口共用）。
 *
 * - **phase 也要落 abort**（2026-11-08 真机 `pdca_mw6x79jd`）：只写 status 时读模型
 *   仍是 `phase=execute`，而 `/goal list` 等入口按 phase 过滤终态 ⇒ 被回收的任务仍显示"执行中"；
 * - `abortedBy` 显式标来源（2026-11-08 真机 `pdca_mw7d3dq3`）：phase 落 abort 后
 *   `/resume` 的终态判据会一律拒绝，`PDCA_AUTO_RESUME` 也失效 —— 标来源供续跑入口区分
 *   「用户中止」/「进程重启中断」/「孤儿收口」。
 */
function buildAbortedCheckpoint(
  ck: Record<string, unknown>,
  abortedBy: 'startup_scan' | 'orphan_scan' | 'user_abort'
): Record<string, unknown> {
  return {
    ...ck,
    phase: 'abort',
    status: 'abort',
    abortedBy,
    abortedAt: new Date().toISOString(),
  };
}

/**
 * 收件箱里**仍可审批**的 PDCA taskId 集合。
 *
 * 2026-11-08（存量收口）：`stage_awaiting_approval` 的含义是"等人点卡"，
 * 因此真正的判据是**收件箱里确有 pending 卡**。卡过期/被驳回后任务就再无入口
 * （`/resume` 对 awaiting 一律 409，审批只能走卡片或 `/goal`）⇒ 无 pending 卡即孤儿。
 *
 * id 解析与 `abortPdcaAfterExpiry` 同源：`source==='pdca'` 取 `metadata.taskId`，
 * 其余取 `metadata.pdcaTaskId`。
 */
async function collectPendingPdcaTaskIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  const pageSize = 200;
  for (let offset = 0; ; offset += pageSize) {
    const { items, total } = await inboxManager.list({
      status: 'pending',
      limit: pageSize,
      offset,
    });
    for (const item of items) {
      const meta = (item.metadata ?? {}) as Record<string, unknown>;
      const taskId =
        item.source === 'pdca'
          ? (meta['taskId'] as string | undefined)
          : (meta['pdcaTaskId'] as string | undefined);
      if (typeof taskId === 'string' && taskId.length > 0) ids.add(taskId);
    }
    if (offset + pageSize >= total) break;
  }
  return ids;
}

/**
 * 启动扫描：检查所有检查点，标记无活跃 orchestrator 的 running 任务为 abort
 *
 * ⚠️ C1（D-103）：原为**同步**函数，因端口 API 异步化 ⇒ 改为 `async`；
 * 唯一调用方 `main.ts` 已同步改为 `await`（**保持**"扫描先于留存清理"的既有次序约束）。
 *
 * U-02（2026-10-19）：返回**被 abort 的检查点快照**与**可续跑清单**，供入口层
 * （`PDCA_AUTO_RESUME`，默认关）自动恢复。本层（infrastructure）**不**直接触发续跑
 * ——跨层调用交由 entry（`main.ts`）完成（R00-001）。
 */
export async function scanAndAbortStalePdcaTasks(): Promise<{
  aborted: number;
  /** 被标记 abort 的检查点快照（含非终态 phase，可用于 resume） */
  abortedCheckpoints: Array<Record<string, unknown>>;
  /** 等待审批阶段的任务（未被 abort，供入口提示/恢复） */
  resumable: Array<{ taskId: string; phase?: string }>;
}> {
  // 2026-09-29（台账「另案 ⑥」）：同批改用带记忆索引 —— 本函数虽只在启动时跑一次，
  // 但目录达 3394 文件时原实现同样要 ≈1s 全量 read+parse。
  let aborted = 0;
  const abortedCheckpoints: Array<Record<string, unknown>> = [];
  // M2（2026-10-09）：**可续跑**（等待审批阶段）任务清单 —— 启动扫描**不** abort 它们，
  // 但此前**静默跳过**（仅 continue）⇒ 用户不知道"重启后有任务可恢复"。本清单使其**可发现**
  // （恢复入口：`/goal` 审批 或 `POST /v1/pdca/:taskId/resume`）。
  // 2026-11-08（存量收口）：**可续跑 = 收件箱仍有 pending 卡**；无卡的不再计入，
  // 而是按孤儿收口（`abortedBy='orphan_scan'`）—— 详见循环内注释。
  const resumable: Array<{ taskId: string; phase?: string }> = [];
  /** 收件箱 pending 卡对应的 taskId（惰性求值：只有出现待审批检查点时才查收件箱） */
  let pendingTaskIds: Set<string> | null = null;
  const taskOps = await getCoreAPI().getTaskOpsPort();
  const [checkpoints, statusSets] = await Promise.all([
    taskOps.getPdcaCheckpointIndex(),
    taskOps.getPdcaStatusSets(),
  ]);

  for (const ck of checkpoints.values()) {
    // 判据与 `findExistingTask` **同一函数**（2026-11-08 根因修复）：此前本处要求
    // `status ∈ 活跃集`，`status IS NULL` 的老检查点直接 `continue` ⇒ 既不清也不 abort，
    // 而幂等键那边却把它们当"进行中"锁死会话。现在两边都走 `isCheckpointLive`。
    if (!isCheckpointLive(ck, statusSets)) continue;
    const taskId = ck.taskId as string;
    // Gap D（1-0c，2026-09-03）：等待审批的任务（plan_pending/stage_awaiting_approval）
    // 不是崩溃遗留——重启后应保留供 /goal 审批/恢复，不得被启动扫描误 abort。
    // （1-0b 后 plan_pending 的 status 演进为 'started'，故此处需按 phase 二次排除。）
    //
    // 2026-11-08（存量收口）：**保留的前提是"还有人能点"** —— 收件箱里必须有指向该任务
    // 的 pending 卡。卡过期/被驳回后任务再无入口（`/resume` 对 awaiting 一律 409，
    // 审批只能走卡片或 `/goal`）⇒ 无 pending 卡即孤儿，直接收口，否则会永久占住会话
    // 幂等键（真机：95 条 `started` + 151 条 NULL 共锁 46 个会话，每次启动重扫一遍）。
    const phase = ck.phase as string | undefined;
    if (phase !== undefined && statusSets.awaitingApprovalPhases.has(phase)) {
      pendingTaskIds ??= await collectPendingPdcaTaskIds();
      if (pendingTaskIds.has(taskId)) {
        resumable.push({ taskId, phase });
        continue;
      }
      const orphanCk = buildAbortedCheckpoint(ck, 'orphan_scan');
      await taskOps.writePdcaCheckpoint(taskId, orphanCk);
      abortedCheckpoints.push(orphanCk);
      if (ck.workItemId) {
        await taskOps.syncPdcaWorkItemStatus(taskId, 'abort');
      }
      aborted++;
      logger.info('PDCA 孤儿任务已收口（待审批阶段但收件箱无 pending 卡）', {
        taskId,
        phase,
        status: ck.status,
      });
      continue;
    }

    // 2026-11-08（真机 `pdca_mw6umn2e`）：本函数文档写的是"标记**无活跃 orchestrator** 的
    // running 任务为 abort"，但实现一直没查这一条 —— 真机撞到竞态：daemon 启动的同时
    // （HTTP 已可接受请求）用户就发起了任务，`runFullPdca` 正在内存里跑，紧随其后的启动扫描
    // 却把它的检查点改成 abort ⇒ 任务卡死在 `plan` 阶段（日志：应用启动 20:21:30.571Z，
    // 2.2 秒后同一 taskId 被"旧任务"标记 abort）。
    // 内存里有活跃编排器 ⇒ 它显然不是崩溃遗留，必须跳过。
    const live = await taskOps.getPdcaOrchestrator(taskId);
    if (live) continue;

    const abortedCk = buildAbortedCheckpoint(ck, 'startup_scan');
    await taskOps.writePdcaCheckpoint(taskId, abortedCk);
    // U-02：保留快照供入口层按需自动恢复（`PDCA_AUTO_RESUME`，默认关）
    abortedCheckpoints.push(abortedCk);

    if (ck.workItemId) {
      await taskOps.syncPdcaWorkItemStatus(taskId, 'abort');
    }
    aborted++;
    logger.info('PDCA 旧任务已标记 abort', { taskId });
  }

  if (aborted > 0) {
    logger.info(`启动扫描完成：已标记 ${aborted} 个旧 PDCA 任务为 abort`);
  }
  if (resumable.length > 0) {
    // M2：显式暴露"可续跑"清单（此前静默跳过 ⇒ 不可发现）
    logger.info('启动扫描：发现可续跑任务（等待审批，未 abort）', {
      count: resumable.length,
      tasks: resumable.slice(0, 20),
      // 2026-11-08：原注释写的 `POST /v1/pdca/checkpoint/resume` 并不存在（`handlePdcaResumeCheckpoint`
      // 导出但无路由）。实际入口：CLI `/goal`；HTTP 走 `POST /v1/pdca/:taskId/resume`
      // （本轮新增）或收件箱审批卡（仅挂起步骤）。
      resumeEntry:
        '/goal（CLI）或 POST /v1/pdca/:taskId/resume；挂起步骤亦可经审批卡续跑',
    });
  }
  return { aborted, abortedCheckpoints, resumable };
}

// ========== PDCA Handlers ==========

/**
 * 启动路径（`runFullPdca` 异常）是否还要补发「异常终止」回执。
 *
 * 2026-11-08（真机 `pdca_mw7eb8lt`）：用户**拒绝审批**会让 `runFullPdca` 以中止异常退出，
 * 而编排层已发过 `⏹ 长程任务已中止`；此处再补一条「⚠️ 长程任务异常终止」会对同一任务给出
 * 两条互相矛盾的结论。按编排器**状态**（而非错误文案）判定：中止态 ⇒ 跳过。
 */
export function shouldEmitStartFailureReceipt(status: unknown): boolean {
  return (status as { phase?: string } | undefined)?.phase !== 'abort';
}

/**
 * 失败终态值（与 `tasks/phases.ts` 的 `PDCA_PHASE_FAILED` 同值）。
 *
 * infrastructure 属 service 层，**不得** import tasks（app 层）——终态**集合**改由端口
 * `getPdcaStatusSets()` 注入；单值没有端口导出，故在此显式声明同值常量并注明来源。
 */
const PDCA_PHASE_FAILED_VALUE = 'failed';

/**
 * 启动期失败收口（导出供单测注入端口）。
 *
 * 2026-11-08（真机 `pdca_mw7gf70g`）：规划阶段抛 `PLAN_PARSE_FAILED` 时 `runFullPdca`
 * 直接上抛，检查点停在 `status=started / phase=plan` ⇒ ① `findExistingTask` 只排除终态
 * ⇒ 该会话的幂等键**永久锁死**（同会话再 start 恒返回旧 taskId、`existing:true`，新描述
 * 被丢弃）；② `/resume` 因内存实例存活被判"正在运行"；③ `/list` 一直显示该任务在 plan。
 *
 * 现口径：已终态（含用户中止）⇒ 不覆盖（返回 false）；否则落 `failed` 并摘掉死实例。
 *
 * @returns 是否新落了 failed 终态
 */
export async function closeOutStartFailure(
  taskId: string,
  orchestrator: { getStatus(): unknown; dispose?: () => void },
  writeCheckpoint: (
    taskId: string,
    patch: Record<string, unknown>
  ) => Promise<void>,
  terminalPhases: ReadonlySet<string>
): Promise<boolean> {
  const phase = (orchestrator.getStatus() as { phase?: string } | undefined)
    ?.phase;
  if (phase !== undefined && terminalPhases.has(phase)) return false;
  await writeCheckpoint(taskId, {
    taskId,
    phase: PDCA_PHASE_FAILED_VALUE,
    status: 'failed',
    replanPending: false,
  });
  orchestrator.dispose?.();
  return true;
}

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
    const workItemId = `wi_${Date.now()}_${randomIdSuffix(6)}`;

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
    // 创建关联 WorkItem（GAI-3：WorkItem 迁入 app.db.workitems，经端口直通桥接层）
    await (
      await getCoreAPI().getTaskOpsPort()
    ).writePdcaWorkItem({ ...workItem });

    const orchestrator = await (
      await getCoreAPI().getTaskOpsPort()
    ).getOrCreatePdcaOrchestrator(taskId);

    // 异步执行 PDCA，不阻塞 HTTP 响应。
    // 2026-11-08：终态回执**不再**由本层写 —— 编排层在 completed / failed（含 escalate）/
    // 挂起三处统一发（`lro/terminalReceipt`），否则"审批后续跑"这条与 HTTP 启动无关的
    // 路径永远拿不到回执（真机 `pdca_mw6rx5kr`）。本层只处理执行异常。
    void orchestrator.runFullPdca(description, sessionId).catch(async (e) => {
      const { handleError } = await import('@openliri/infra/error');
      handleError(e, {
        module: 'infrastructure:http:handlers:pdca-handlers',
        action: 'runFullPdca',
        context: { taskId, workItemId },
      });
      const status = orchestrator.getStatus();
      // 2026-11-08（真机 `pdca_mw7gf70g`）：启动期失败必须落终态（详见 `closeOutStartFailure`）。
      try {
        const port = await getCoreAPI().getTaskOpsPort();
        const { terminal } = await port.getPdcaStatusSets();
        await closeOutStartFailure(
          taskId,
          orchestrator,
          (id, patch) => port.writePdcaCheckpoint(id, patch),
          terminal
        );
      } catch (patchErr) {
        // @ignore-catch — 收口失败不改变"异常终止"的事实，回执照发
        logger.warn('启动失败收口写检查点失败（不影响异常回执）', {
          taskId,
          error: String(patchErr),
        });
      }
      // 编排器在终态前崩溃 ⇒ 没有终态回执，这里补一条事实（不编造步数）。
      // 写会话消息走 CoreAPI（与旧实现同路径，避免 infrastructure 直接依赖 tasks 域）
      if (!shouldEmitStartFailureReceipt(status)) return;
      try {
        const core = getCoreAPI();
        const reason = (e instanceof Error ? e.message : String(e)).slice(
          0,
          200
        );
        core.chatManager.addMessage(
          sessionId,
          core.chatManager
            .getMessageService()
            .createAssistantMessage(
              `⚠️ 长程任务异常终止：${reason}（taskId ${taskId}）`,
              {
                sessionId,
                metadata: { taskId, pdcaReceipt: true },
              }
            )
        );
      } catch {
        // @ignore-catch — 回执属附加信息，写入失败不影响任务结果
      }
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

/** 在飞续跑（按 taskId）—— 防止连续 POST 让同一任务并行跑两个循环 */
const inFlightResumeTasks = new Set<string>();

/**
 * POST /v1/pdca/:taskId/resume —— **续跑入口**（escalate 的 replan / 崩溃遗留恢复）。
 *
 * 2026-11-08（真机 `pdca_mw771zbt`）：⚠️ 终态回执已写「可 replan 续跑」，但 HTTP 侧此前
 * 没有任何入口（`handlePdcaResumeCheckpoint` 从未注册路由）⇒ 用户照做只会 404。
 *
 * 口径：
 * - 无检查点 ⇒ 404；
 * - **等待人工决策**（`plan_pending` / `stage_awaiting_approval`）⇒ 409（审批走卡片/`/goal`）；
 * - 终态且不可 replan（`completed` / `abort` / `failed` 且 `replanPending=false`）⇒ 409；
 * - 同任务已有续跑在飞 ⇒ 202 `already_resuming`（不并行起第二轮）；
 * - 复用内存编排器，否则按 taskId 新建（`resumeFromCheckpoint` 自带跨重启重建 Plan）；
 * - **异步执行**（与 `/start` 一致）：立即 202，进度靠 `GET /v1/pdca/:taskId` 轮询。
 */
export async function handlePdcaResumeTask(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  taskId: string
): Promise<void> {
  try {
    const port = await getCoreAPI().getTaskOpsPort();
    const ck = await port.readPdcaCheckpoint(taskId);
    if (!ck) {
      sendError(res, new Error(`任务不存在：${taskId}`), 404);
      return;
    }
    const status = ck.status as string | undefined;
    const phase = ck.phase as string | undefined;
    const replanPending = Boolean(ck.replanPending);
    // 2026-11-08（真机 `pdca_mw78nolv`）：**待审批 ≠ 可续跑** —— 此时调续跑只会把步骤
    // 再跑一遍（命令仍被 ask 拦下、卡也不新增），白烧 token。审批走收件箱卡片 / `/goal`。
    if (phase === 'plan_pending' || phase === 'stage_awaiting_approval') {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: '任务正在等待人工决策，请先审批（收件箱卡片或 /goal）',
          taskId,
          status,
          phase,
        })
      );
      return;
    }
    // 重复调用幂等：同一任务已有续跑在飞 ⇒ 直接告知，不再并行起一轮
    if (inFlightResumeTasks.has(taskId)) {
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ taskId, status: 'already_resuming' }));
      return;
    }
    // 2026-11-08（真机 `pdca_mw7d3dq3`）：**崩溃遗留可续跑** —— 启动扫描为满足
    // `/goal list` 的 phase 过滤，把 `phase` 也落成 `abort`；若这里按终态拒绝，
    // 崩溃恢复入口（本端点 + `PDCA_AUTO_RESUME`）全部失效（真机 409）。
    // 仅放行扫描标记；用户主动中止（无标记）仍拒绝。
    const crashLeftover = ck.abortedBy === 'startup_scan';
    const notResumable =
      ((phase === 'completed' || phase === 'abort') && !crashLeftover) ||
      status === 'completed' ||
      (status === 'abort' && !crashLeftover) ||
      (status === 'failed' && !replanPending);
    if (notResumable) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: '任务已终止且不可 replan',
          taskId,
          status,
          phase,
          replanPending,
        })
      );
      return;
    }
    // 2026-11-08（真机 `pdca_mw79lfjh` 复盘中发现）：**运行中的任务不得再被续跑**。
    // 在飞幂等只覆盖"经本端点发起的续跑"，覆盖不到"首次运行 / 自动 replan / 审批续跑"
    // 这条链路 —— 此时调续跑会让同一任务并行跑两个循环（白烧 token、步骤互相覆盖）。
    // 判据：内存编排器存活 **且** 检查点状态仍属活跃集；escalate 待 replan 时
    // `status='failed'` 不属活跃集 ⇒ 仍可续跑。
    const liveOrchestrator = await port.getPdcaOrchestrator(taskId);
    if (liveOrchestrator) {
      const { active } = await port.getPdcaStatusSets();
      if (status !== undefined && active.has(status)) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: '任务正在运行，无需续跑',
            taskId,
            status,
            phase,
          })
        );
        return;
      }
    }
    const orchestrator =
      liveOrchestrator ?? (await port.getOrCreatePdcaOrchestrator(taskId));
    if (typeof orchestrator.resumeFromCheckpoint !== 'function') {
      sendError(res, new Error('编排器不支持续跑'), 501);
      return;
    }
    // 与 `/start` 同口径：异步执行，不阻塞 HTTP 响应（在飞期间重复调用走幂等分支）
    inFlightResumeTasks.add(taskId);
    void orchestrator
      .resumeFromCheckpoint(ck)
      .catch((e: unknown) => {
        void handleError(e, {
          module: 'pdca:handlers',
          action: 'resumeTask',
          context: { taskId },
        });
      })
      .finally(() => {
        inFlightResumeTasks.delete(taskId);
      });
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ taskId, status: 'resuming', replanPending }));
    broadcastEvent('pdca:resumed', { taskId });
  } catch (e) {
    sendError(res, e instanceof Error ? e : new Error(String(e)), 500);
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
      artifacts: number;
      artifactGated: boolean;
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
  // LRO-12（2026-10-26）：与 `TaskOrchestrator.getPlanProgress` **同一口径** ——
  // 进度只由产物存在性推进：已采集台账（数组）但为空的完成步不计数；
  // 未采集（undefined，旧存档/快速路径）沿旧口径。两份公式不一致会导致
  // "内存态 0% / checkpoint 态 100%"的诡异切换。
  const artifactPaths = new Set<string>();
  let artifactBackedCompleted = 0;
  for (const s of steps) {
    const arts = Array.isArray(s.artifacts)
      ? (s.artifacts as string[])
      : undefined;
    if (arts) for (const p of arts) artifactPaths.add(p);
    if (s.status !== 'completed') continue;
    // 2026-11-08：与 `TaskOrchestrator.getPlanProgress` 同口径 —— 空台账但有**成功工具
    // 证据**的完成步同样计数（只读/校验步天然无产物，不能被产物门永久压住）。
    const outcomes = s.toolOutcomes as { successCount?: number } | undefined;
    if (
      arts === undefined ||
      arts.length > 0 ||
      (outcomes?.successCount ?? 0) > 0
    ) {
      artifactBackedCompleted++;
    }
  }
  return {
    total,
    pending: total - completed - running - failed - cancelled,
    running,
    completed,
    failed,
    cancelled,
    percent: Math.round((artifactBackedCompleted / total) * 100),
    artifacts: artifactPaths.size,
    // 与 TaskOrchestrator 同口径：有完成步因零产物未计入 ⇒ 被门压住
    artifactGated: artifactBackedCompleted < completed,
  };
}

/**
 * 中止正在运行的长程任务（2026-11-08，真机 `pdca_mw7qg094`）。
 *
 * 此前**没有**任何 HTTP 入口能停掉在飞的 PDCA：`POST /v1/plans/:id/abort` 只作用于
 * `TaskOrchestrator` 的独立计划，动不了 LRO 编排器里的循环（真机：任务在
 * execute/review 之间反复 replan、进度从 2/2 掉回 0/2，只能等 maxIteration 自然耗尽）。
 *
 * 语义：
 * - 无检查点 ⇒ 404；
 * - 已终态 ⇒ 409 `already_terminal`（不重复中止）；
 * - 内存里没有在飞编排器（进程重启后）⇒ 409 `not_running`（此时任务已无循环可停）；
 * - 成功 ⇒ 调用 `orchestrator.abort()` 并落 `phase/status=abort, abortedBy=user_abort`。
 */
export async function handlePdcaAbortTask(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  taskId: string
): Promise<void> {
  try {
    const port = await getCoreAPI().getTaskOpsPort();
    const ck = await port.readPdcaCheckpoint(taskId);
    if (!ck) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '任务不存在', taskId }));
      return;
    }
    const statusSets = await port.getPdcaStatusSets();
    const status = ck.status as string | undefined;
    const phase = ck.phase as string | undefined;
    const terminal =
      (status !== undefined && statusSets.terminal.has(status)) ||
      (phase !== undefined && statusSets.terminalPhases.has(phase));
    if (terminal) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: 'already_terminal', taskId, status, phase })
      );
      return;
    }

    const orchestrator = await port.getPdcaOrchestrator(taskId);
    if (!orchestrator?.abort) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'not_running',
          taskId,
          hint: '当前进程没有该任务的在飞编排器（进程重启后已无循环可停）',
        })
      );
      return;
    }

    await orchestrator.abort();
    const abortedCk = buildAbortedCheckpoint(ck, 'user_abort');
    await port.writePdcaCheckpoint(taskId, abortedCk);
    if (ck.workItemId) {
      await port.syncPdcaWorkItemStatus(taskId, 'abort');
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, taskId, phase: 'abort' }));
    broadcastEvent('pdca:aborted', { taskId });
  } catch (err) {
    sendError(res, err);
  }
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
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify(
          buildCheckpointStatusView(taskId, ck as Record<string, unknown>)
        )
      );
      return;
    }
    const status = orchestrator.getStatus() as unknown as Record<
      string,
      unknown
    >;
    // 2026-11-07（真机）：跨重启后的审批路径会用 `getOrCreatePdcaOrchestrator` 建一个
    // **空实例**（无 plan / planId，phase 默认 'plan'）。一旦它存在，本接口就不再回退
    // 检查点 ⇒ UI 从「真实阶段 + 步骤清单」退化为「plan + 空」（真机 `pdca_mw6bpgs5`
    // 拒绝后实测）。内存实例没装载计划 ⇒ 不携带比检查点更多的信息，按检查点读模型返回。
    if (!status.plan) {
      const ck = await (
        await getCoreAPI().getTaskOpsPort()
      ).readPdcaCheckpoint(taskId);
      if (ck) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify(
            buildCheckpointStatusView(
              taskId,
              ck as Record<string, unknown>,
              typeof status.phase === 'string' ? status.phase : undefined
            )
          )
        );
        return;
      }
    }
    // 2026-11-08（真机 `pdca_mw6rx5kr`）：escalate 收尾只把 replan 事实写进检查点
    // （内存 phase 仍为 `execute`，属半自动 replan 的既有语义）⇒ 内存读模型这里补合并，
    // 否则"待重规划"的任务与"仍在执行"的任务在接口上完全同形。
    const ckForReplan = await (
      await getCoreAPI().getTaskOpsPort()
    ).readPdcaCheckpoint(taskId);
    if (ckForReplan) {
      if (typeof ckForReplan.replanPending === 'boolean') {
        status.replanPending = ckForReplan.replanPending;
      }
      if (typeof ckForReplan.replanFailCount === 'number') {
        status.replanFailCount = ckForReplan.replanFailCount;
      }
      // §60.4②（2026-11-10）：同一缺陷重复早停的事实（结论可查，不只靠会话回执）
      if (typeof ckForReplan.defectRepeatCount === 'number') {
        status.defectRepeatCount = ckForReplan.defectRepeatCount;
      }
      if (typeof ckForReplan.defectSummary === 'string') {
        status.defectSummary = ckForReplan.defectSummary;
      }
      if (typeof ckForReplan.stopReason === 'string') {
        status.stopReason = ckForReplan.stopReason;
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(withProgressIteration(status)));
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 给 `progress` 补上 `iteration`（2026-11-08，真机 `pdca_mw7qg094`）。
 *
 * 现象：任务在 `execute → review → execute` 之间反复迭代，**每次迭代都会重新规划**，
 * 步骤计数随之重置 ⇒ 接口上的 `completed/total` 从 `2/2` 掉回 `0/2`，看起来像"进度倒退"。
 * 接口本身没有撒谎（新计划确实 0/2），缺的是"这是第几轮"这一维度。
 *
 * 处置：把 `iteration`（以及已有 `replanPending`/`replanFailCount`）并入 `progress`，
 * 前端可显示「第 N 轮 · x/y」而不是让用户以为进度回退。**零语义变更**，纯附加字段。
 */
function withProgressIteration(
  status: Record<string, unknown>
): Record<string, unknown> {
  const progress = status.progress as Record<string, unknown> | undefined;
  if (!progress) return status;
  const iteration =
    typeof status.loopIteration === 'number' ? status.loopIteration : undefined;
  if (iteration === undefined) return status;
  return { ...status, progress: { ...progress, iteration } };
}

/**
 * 检查点 → 状态读模型（与 `getStatus()` 字段对齐；无步骤快照时省略 plan/progress）。
 *
 * 2026-11-07：`phase` 优先取检查点；检查点无该字段（刚启动、尚未进阶段）时用内存阶段兜底。
 */
function buildCheckpointStatusView(
  taskId: string,
  rec: Record<string, unknown>,
  fallbackPhase?: string
): Record<string, unknown> {
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
  const baseProgress = steps ? deriveCheckpointProgress(steps) : undefined;
  // 同上：迭代维度（新计划计数会重置，需标出"第几轮"）
  const progress =
    baseProgress && typeof rec.loopIteration === 'number'
      ? { ...baseProgress, iteration: rec.loopIteration }
      : baseProgress;
  return {
    taskId,
    planId: (rec.planId as string) ?? '',
    phase: (rec.phase as string) ?? fallbackPhase ?? 'none',
    status: (rec.status as string) ?? 'unknown',
    description: (rec.description as string) ?? '',
    plan,
    progress,
    workItemId: rec.workItemId,
    workspaceId: rec.workspaceId,
    projectId: rec.projectId,
    sessionId: rec.sessionId,
    totalTokens: rec.totalTokens,
    // 2026-11-08（真机 `pdca_mw6rx5kr`）：escalate 终态会把 phase 保持 `execute`（半自动
    // replan 语义）⇒ 只靠 phase/progress 看，任务与"仍在跑"无法区分。把 replan 事实透出，
    // 调用方才能显示"待重规划 / 已转人工"。
    replanPending: rec.replanPending,
    replanFailCount: rec.replanFailCount,
    // §60.4②（2026-11-10）：缺陷重复闸门的结论（跨重启后同样可见）
    defectRepeatCount: rec.defectRepeatCount,
    defectSummary: rec.defectSummary,
    stopReason: rec.stopReason,
    source: 'checkpoint',
  };
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
      // 2026-11-07（真机）：报告由 `persistAuditReportFile` 落盘
      // （`~/.pyapp/data/task-audits/{taskId}.json`，注释即写明「重启后可恢复」），
      // 但此前**无读取点** ⇒ 重启后只回 `{error:'Not available'}`（真实报告就在磁盘上）。
      // 现按落盘报告恢复；确实没有报告 ⇒ 404（不再假成功）。
      const port = await getCoreAPI().getTaskOpsPort();
      const persisted = await port.readTaskAuditReport?.(taskId);
      if (persisted) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(persisted));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: false,
          error: 'not_found',
          taskId,
          message: `PDCA 任务审计报告不存在：${taskId}`,
        })
      );
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
 * 步骤审查 / 决策的公共准入（HTTP 未受信边界）。
 *
 * 2026-11-08（真机 `pdca_mw7g2qiv`）：这两个端点此前**不看任务状态** —— 对已 completed 的
 * 任务仍会真的重跑一次 Reviewer（模型调用 + 覆盖历史审查分），`decide` 还能把已完成步骤
 * 改成 `pending`（实测 `phase=completed` / `plan.status=completed` / `step.status=pending`
 * 自相矛盾），`retry` 同时递增 `retryCount`。不存在的 stepId 则回 500（"Step not found"），
 * 与其它端点的 404 口径不一致。
 *
 * 2026-11-08（真机 `pdca_mw7m52sy`）：规划期（`phase=plan`、尚无 plan）调用这两个端点，
 * 原先直达编排器 ⇒ `reviewStep/decideStep` 抛 `No plan created` ⇒ **500**。计划未就绪是
 * 可预期的状态冲突，回 409 `plan_not_ready`（与"步骤不存在"的 404 区分）。
 *
 * 已响应 ⇒ 返回 true（调用方直接 return）。
 */
function rejectTerminalOrMissingStep(
  res: http.ServerResponse,
  orchestrator: PdcaOrchestratorPort,
  taskId: string,
  stepId: string,
  terminalPhases: ReadonlySet<string>
): boolean {
  const status = orchestrator.getStatus() as {
    phase?: string;
    plan?: { steps?: Array<{ id: string }> };
  };
  const phase = status.phase;
  if (phase !== undefined && terminalPhases.has(phase)) {
    res.writeHead(409, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: false,
        error: 'task_terminal',
        taskId,
        stepId,
        phase,
        message: `任务已终止（phase=${phase}），不可再审查/决策步骤`,
      })
    );
    return true;
  }
  const steps = status.plan?.steps;
  if (!steps || steps.length === 0) {
    res.writeHead(409, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: false,
        error: 'plan_not_ready',
        taskId,
        stepId,
        phase,
        message: `任务尚无计划（phase=${phase ?? 'unknown'}），暂不可审查/决策步骤`,
      })
    );
    return true;
  }
  if (!steps.some((s) => s.id === stepId)) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: false,
        error: 'step_not_found',
        taskId,
        stepId,
        message: `步骤不存在：${stepId}`,
      })
    );
    return true;
  }
  return false;
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
      // 2026-11-07（真机）：原实现回 `200 {error:'Not available'}` —— 与 `confirm` 同源的
      // 假成功（调用方无法区分"已审阅"与"什么都没做"）。任务未装载/不存在 ⇒ 404。
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: false,
          error: 'not_found',
          taskId,
          message: `PDCA 任务不存在或未在运行：${taskId}`,
        })
      );
      return;
    }
    const { terminal } = await (
      await getCoreAPI().getTaskOpsPort()
    ).getPdcaStatusSets();
    if (
      rejectTerminalOrMissingStep(res, orchestrator, taskId, stepId, terminal)
    )
      return;
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
    let decision = '';
    try {
      const body = await readRequestBody(req);
      const parsed = JSON.parse(body || '{}') as { decision?: unknown };
      decision = typeof parsed.decision === 'string' ? parsed.decision : '';
    } catch {
      // 请求体不是合法 JSON ⇒ 按"缺/非法 decision"处理（400，而非 500）
      decision = '';
    }
    if (!isPdcaStepDecision(decision)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: false,
          error: 'invalid_decision',
          decision,
          allowed: PDCA_STEP_DECISIONS,
        })
      );
      return;
    }
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
      // 2026-11-07（真机）：与 review / confirm 同口径 —— 不再回 `200 {error}` 假成功。
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: false,
          error: 'not_found',
          taskId,
          message: `PDCA 任务不存在或未在运行：${taskId}`,
        })
      );
      return;
    }
    const { terminal } = await (
      await getCoreAPI().getTaskOpsPort()
    ).getPdcaStatusSets();
    if (
      rejectTerminalOrMissingStep(res, orchestrator, taskId, stepId, terminal)
    )
      return;
    await orchestrator.decideStep(stepId, decision);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    broadcastEvent('pdca:decided', { taskId, stepId, decision });
  } catch (err) {
    sendError(res, err);
  }
}

/** 列表摘要条目 —— **不含** `plan` / `audit` / `lifecycle` 等大载荷（详情走 `GET /v1/pdca/:id`） */
interface PdcaListItem {
  taskId: string;
  phase: string;
  status: string;
  planId?: string;
  description?: string;
  source?: 'checkpoint';
  workItemId?: string;
  projectId?: string;
  workspaceId?: string;
  sessionId?: string;
  progress?: Record<string, number>;
  updatedAt?: string;
}

/** 进度只保留数值字段（防止把 `progress` 之外的大对象带进摘要） */
function pickProgress(
  item: Record<string, unknown>
): Record<string, number> | undefined {
  const progress = item.progress as Record<string, unknown> | undefined;
  if (!progress || typeof progress !== 'object') return undefined;
  const out: Record<string, number> = {};
  for (const key of [
    'total',
    'pending',
    'running',
    'completed',
    'failed',
    'cancelled',
    'percent',
  ]) {
    const value = progress[key];
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * 活动时间：内存条目取生命周期最后事件（实时），检查点条目取 `updatedAt`（落盘时间）。
 * 缺省返回 `undefined` ⇒ 排序时排最后（不伪造时间）。
 */
function resolveUpdatedAt(item: Record<string, unknown>): string | undefined {
  if (typeof item.updatedAt === 'string' && item.updatedAt)
    return item.updatedAt;
  const lifecycle = item.lifecycle;
  if (!Array.isArray(lifecycle)) return undefined;
  const last = lifecycle[lifecycle.length - 1] as
    | Record<string, unknown>
    | undefined;
  const ts = last?.['timestamp'];
  return typeof ts === 'number' && Number.isFinite(ts)
    ? new Date(ts).toISOString()
    : undefined;
}

/** 把完整状态/检查点投影成列表摘要（字段白名单，杜绝大载荷外泄） */
function summarizePdcaItem(
  item: Record<string, unknown>,
  opts: { source?: 'checkpoint' } = {}
): PdcaListItem {
  const summary: PdcaListItem = {
    taskId: String(item.taskId ?? ''),
    phase: typeof item.phase === 'string' && item.phase ? item.phase : 'none',
    status:
      typeof item.status === 'string' && item.status ? item.status : 'unknown',
  };
  for (const key of [
    'planId',
    'description',
    'workItemId',
    'projectId',
    'workspaceId',
    'sessionId',
  ] as const) {
    const value = item[key];
    if (typeof value === 'string' && value.length > 0) summary[key] = value;
  }
  const progress = pickProgress(item);
  if (progress) summary.progress = progress;
  if (opts.source) summary.source = opts.source;
  const updatedAt = resolveUpdatedAt(item);
  if (updatedAt) summary.updatedAt = updatedAt;
  return summary;
}

/** 条数归一：非法/非正 ⇒ 默认值；超过上限 ⇒ 截到上限 */
function normalizeListLimit(value: unknown): number {
  const limit = Number(value);
  if (!Number.isFinite(limit) || limit <= 0) return PDCA_LIST_DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), PDCA_LIST_MAX_LIMIT);
}

/** 偏移归一：非法/负数 ⇒ 0 */
function normalizeListOffset(value: unknown): number {
  const offset = Number(value);
  return Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;
}

/** 时间戳比较键（缺省/不可解析 ⇒ 0，排最后） */
function toTimeMs(iso: string | undefined): number {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * 列出所有 PDCA 任务（**摘要**，2026-11-08 改造）
 *
 * POST /v1/pdca/list
 * 请求体（可选）: { workspaceId?, projectId?, sessionId?, limit?, offset? }
 * 数据源 = 内存 orchestrator（活跃）+ checkpoint 回退（跨重启遗留，1-5 P1 前置 2026-09-03）：
 * checkpoint 含 Gap D 修复保留的归属字段（workItemId/workspaceId/projectId/status/phase），
 * 重启后 list 不再为空。过滤字段取自各条目的归属（checkpoint 优先）。
 *
 * 返回 `{ items, total, limit, offset }`：`items` 按最近活动时间倒序、默认 200 条（上限 500）；
 * 每项只含列表渲染所需字段（不含 `plan` / `audit` / `lifecycle`）。
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
      limit?: number;
      offset?: number;
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
        updatedAt: typeof ck.updatedAt === 'string' ? ck.updatedAt : undefined,
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

    // 摘要化 + 倒序（最近活动在前）+ 分页截断（2026-11-08：原为全量完整状态，1.19 MB）
    const summaries = filtered
      .map((item) =>
        item.source === 'checkpoint'
          ? summarizePdcaItem(item, { source: 'checkpoint' })
          : summarizePdcaItem(item)
      )
      .sort((a, b) => toTimeMs(b.updatedAt) - toTimeMs(a.updatedAt));
    const total = summaries.length;
    const limit = normalizeListLimit(filter.limit);
    const offset = normalizeListOffset(filter.offset);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        items: summaries.slice(offset, offset + limit),
        total,
        limit,
        offset,
      })
    );
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
 *
 * 2026-10-31（可证缺陷修复）：**不再假成功**。
 * app 侧编排器**没有** `confirm` 方法（见 `taskOpsPorts.ts` 的端口注释），旧实现
 * `await orchestrator.confirm?.(undefined)` 恒为 no-op，却回 `{ok:true}`；编排器缺失时
 * 又回 `200 + {error:'Not available'}` —— 调用方无法区分"已确认"与"什么都没做"。
 * 现按真实能力回应：任务不存在 ⇒ 404；能力未实现 ⇒ 501；真正执行 ⇒ 200。
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
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: false,
          error: 'not_found',
          taskId,
          message: `PDCA 任务不存在或未在运行：${taskId}`,
        })
      );
      return;
    }
    if (typeof orchestrator.confirm !== 'function') {
      logger.warn('pdca:confirm_unavailable', { taskId });
      res.writeHead(501, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: false,
          error: 'not_implemented',
          taskId,
          message: '当前编排器未提供 confirm 能力（尚未实现），未执行任何操作',
        })
      );
      return;
    }
    await orchestrator.confirm();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  } catch (err) {
    sendError(res, err);
  }
}
