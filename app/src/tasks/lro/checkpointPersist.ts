// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * checkpointPersist —— PDCA checkpoint 的**落盘投影**（P2 外移，2026-11-04）
 *
 * 从 `LongRunningTaskOrchestrator._persistCheckpoint` 外移（该文件顶到 R04-001 的 2000 行上限）。
 * 字段口径见 `lro/checkpointSnapshot`：这里只做"宿主字段 → checkpoint 载荷"的纯投影，
 * 失败按既有语义**不阻断任务执行**（`@ignore-catch`）。
 */

import {
  PDCA_TERMINAL_PHASES,
  PDCA_PHASE_FAILED,
  pdcaCheckpointStatus,
} from '@modules/tasks/phases';
import type { PdcaPhase } from '../LongRunningTaskOrchestrator';
import type { Plan } from '../TaskOrchestrator';
// 状态字面量唯一事实源（lint:state-ratchet：不得裸写 'failed'）
import { PLAN_STATUS_FAILED } from '../TaskOrchestrator';
import { writePdcaCheckpoint, readPdcaCheckpoint } from '../PdcaWorkItemBridge';
import type { BlockedCommandEntry } from './blockedCommandLedger.js';
// 2026-11-07：中止路径的审计报告落盘（与 completed/failed 两条路径同源）
import { persistAuditReportFile } from './reporting.js';
// 2026-11-08：中止同样要发终态回执（否则用户拒绝审批后会话停在「⏸ 已挂起等待审批」）
import {
  emitPdcaAbortReceipt,
  emitPdcaReceiptText,
} from './terminalReceipt.js';
import type { AuditReport } from '../AuditReport';
import { projectCheckpointSteps } from './checkpointSnapshot.js';
import type { TaskPolicySnapshot } from './policySnapshot.js';
import { releaseTaskScope } from './taskScopeRegistry.js';

/**
 * 中止路径的终态 checkpoint（载荷与改造前逐字一致）+ 回收任务档审批。
 *
 * `abort()` 直接写 checkpoint（不走 `persistPdcaCheckpoint`），因此单列一个入口，
 * 避免"任务已中止、任务档放行仍然生效"。
 *
 * 2026-11-07（真机）：中止路径**同样落审计报告** —— 否则重启后
 * `GET /v1/pdca/:id/audit` 无落盘文件可恢复（completed/failed 两条路径均已落盘）。
 * 报告由调用方以**工厂**传入：中止可能发生在计划创建之前（`generateReport` 会抛），
 * 此时不落盘，读取侧按 404 处理。
 */
export async function writeAbortCheckpoint(
  taskId: string,
  buildReport?: () => AuditReport,
  hasPushChannel = false
): Promise<void> {
  if (buildReport) {
    try {
      const report = buildReport();
      persistAuditReportFile(report);
      // 2026-11-08（真机 `pdca_mw6vej5m`）：拒绝审批 ⇒ 中止，此前**没有任何回执**
      emitPdcaAbortReceipt(report, hasPushChannel);
    } catch {
      // @ignore-catch — 无计划可生成报告时中止流程不受影响（读取侧按 404）
    }
  }
  await writePdcaCheckpoint(taskId, {
    phase: 'abort',
    status: 'abort',
    // 2026-11-08（真机 `pdca_mw7dmlhw` 复盘）：**覆盖崩溃标记** —— 崩溃恢复过的任务
    // 检查点里仍留着 `abortedBy='startup_scan'`；若不覆盖，用户之后主动中止的任务
    // 仍会被续跑判据当成"崩溃遗留"而放行。
    abortedBy: 'user_abort',
    abortedAt: new Date().toISOString(),
  });
  releaseTaskScope(taskId);
}

/**
 * 续跑失败收口（2026-11-08，真机 `pdca_mw7bjwo8`）。
 *
 * `POST /v1/pdca/:taskId/resume` 的 replan 分支在 Planner 两次输出都无法解析时抛
 * `PLAN_PARSE_FAILED`，原实现只把它交给调用方记录 ⇒ 检查点停在
 * `phase=plan / status=started`：`/resume` 此后永远 409「任务正在运行」（只能重启
 * daemon 解锁），会话里也没有任何结论。
 *
 * 现口径：落 `phase/status=failed` + `replanPending=true`（**保留可重试**，下一轮走
 * 增量 replan），并发一条 ⚠️ 回执；异常仍由调用方上抛（日志不丢）。
 */
export async function markResumeFailure(input: {
  taskId: string;
  sessionId?: string | null;
  error: unknown;
  /** 同步内存 phase（检查点之外的第二处投影） */
  onPhase?: (phase: PdcaPhase) => void;
}): Promise<void> {
  const reason =
    input.error instanceof Error ? input.error.message : String(input.error);
  input.onPhase?.(PDCA_PHASE_FAILED);
  const ck = (await readPdcaCheckpoint(input.taskId)) ?? {};
  await writePdcaCheckpoint(input.taskId, {
    taskId: input.taskId,
    phase: PDCA_PHASE_FAILED,
    status: PLAN_STATUS_FAILED,
    replanPending: true,
  });
  emitPdcaReceiptText({
    taskId: input.taskId,
    sessionId: (ck.sessionId as string | undefined) ?? input.sessionId,
    text: `⚠️ 长程任务续跑失败：${reason}（taskId ${input.taskId}）；可重试 POST /v1/pdca/${input.taskId}/resume`,
  });
}

/**
 * 启动期失败收口（2026-11-08 真机 `pdca_mw7gf70g`；第三十四轮补 CLI `/goal start` 路径）。
 *
 * 规划阶段抛 `PLAN_PARSE_FAILED` 时 `runFullPdca` 直接上抛，检查点停在
 * `status=started / phase=plan`：`/goal start` 的幂等判据是
 * `!PDCA_TERMINAL_PHASES.has(ck.phase)`（`phase` 缺失/plan ⇒ 视为进行中）⇒ 该会话
 * **再也起不了新任务**；`/goal list` 也一直把它列为进行中。
 *
 * 现口径与 HTTP `/v1/pdca/start` 一致：已终态（含用户中止）⇒ 不覆盖、返回 false；
 * 否则落 `failed` + `replanPending=false` 并发一条 ⚠️ 回执（无计划 ⇒ 不可 replan）。
 *
 * ⚠️ 分层：`infrastructure`（service 层）不能反向依赖本模块，其收口用端口版
 * `closeOutStartFailure`（`pdca-handlers.ts`），二者判据必须保持一致。
 */
export async function markStartFailure(input: {
  taskId: string;
  sessionId?: string | null;
  error: unknown;
  /** 同步内存 phase（调用方随即 `dispose()` 时可不传） */
  onPhase?: (phase: PdcaPhase) => void;
}): Promise<boolean> {
  const ck = (await readPdcaCheckpoint(input.taskId)) ?? {};
  const phase = ck.phase as string | undefined;
  if (phase !== undefined && PDCA_TERMINAL_PHASES.has(phase)) return false;
  input.onPhase?.(PDCA_PHASE_FAILED);
  await writePdcaCheckpoint(input.taskId, {
    taskId: input.taskId,
    phase: PDCA_PHASE_FAILED,
    status: PLAN_STATUS_FAILED,
    replanPending: false,
  });
  const reason =
    input.error instanceof Error ? input.error.message : String(input.error);
  emitPdcaReceiptText({
    taskId: input.taskId,
    sessionId: (ck.sessionId as string | undefined) ?? input.sessionId,
    text: `⚠️ 长程任务启动失败：${reason.slice(0, 200)}（taskId ${input.taskId}）；可重新发起任务`,
  });
  return true;
}

export interface CheckpointPersistInput {
  taskId: string;
  phase: PdcaPhase;
  planId: string | null;
  sessionId: string | null;
  /** 当前计划（无计划 ⇒ 步骤快照为空） */
  plan: Plan | undefined;
  lastEscalations: unknown;
  blockedCommands: BlockedCommandEntry[];
  totalTokens: number;
  /** 任务开始（0 ⇒ 不写） */
  startedAt: number;
  turnsExtensions: number;
  /** 2026-11-08：已执行的 PDCA 轮次（详情接口重启后据此显示「第 N 轮」；0 ⇒ 不写） */
  loopIteration?: number;
  /** P2（§3.3）：策略快照（旧任务无该字段 ⇒ 恢复侧保守降级 ask） */
  policySnapshot?: TaskPolicySnapshot;
}

/** 写入 PDCA checkpoint（合并写；任何失败都不影响任务执行） */
export async function persistPdcaCheckpoint(
  input: CheckpointPersistInput
): Promise<void> {
  try {
    await writePdcaCheckpoint(input.taskId, {
      taskId: input.taskId,
      phase: input.phase,
      // Gap D（1-0b）：status 随 phase 联动演进（findExistingTask 排除依赖终态 status）
      status: pdcaCheckpointStatus(input.phase),
      planId: input.planId ?? undefined,
      sessionId: input.sessionId ?? undefined,
      description: input.plan?.description ?? '',
      // 步骤快照投影（字段口径见 `lro/checkpointSnapshot`：扩容原因/依赖/产物台账等）
      steps: projectCheckpointSteps(input.plan),
      // D5（M6）：escalate 缺陷清单（跨重启恢复后增量 replan 仍生效）
      lastEscalations: input.lastEscalations,
      // LRO-13：阻塞命令台账随快照落盘（resume 后同一命令直接短路，不重放那堵墙）
      blockedCommands: input.blockedCommands,
      // D4（M4）：TAORLoop token 累计（阶段边界结算 → StageOrchestrator 成本护栏）
      totalTokens: input.totalTokens,
      // 2026-10-17：任务开始时间（跨重启恢复 duration 口径；0 ⇒ 不写）
      startedAt: input.startedAt || undefined,
      // S2/B（PR9）：max_turns 扩容续跑次数（跨重启累计，上限门禁）
      turnsExtensions: input.turnsExtensions,
      // 2026-11-08：轮次随检查点落盘（0 ⇒ 不写，保持旧任务载荷形状）
      ...(input.loopIteration ? { loopIteration: input.loopIteration } : {}),
      ...(input.policySnapshot ? { policySnapshot: input.policySnapshot } : {}),
    });
    // P2（§3.3）：终态落盘 ⇒ 回收任务档审批（活跃登记 + 放行记录）
    if (PDCA_TERMINAL_PHASES.has(input.phase)) releaseTaskScope(input.taskId);
  } catch {
    // @ignore-catch — checkpoint 写入失败不影响任务执行
  }
}
