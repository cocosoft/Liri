// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * checkpointPersist —— PDCA checkpoint 的**落盘投影**（P2 外移，2026-11-04）
 *
 * 从 `LongRunningTaskOrchestrator._persistCheckpoint` 外移（该文件顶到 R04-001 的 2000 行上限）。
 * 字段口径见 `lro/checkpointSnapshot`：这里只做"宿主字段 → checkpoint 载荷"的纯投影，
 * 失败按既有语义**不阻断任务执行**（`@ignore-catch`）。
 */

import { pdcaCheckpointStatus } from '@modules/tasks/phases';
import type { PdcaPhase } from '../LongRunningTaskOrchestrator';
import type { Plan } from '../TaskOrchestrator';
import { writePdcaCheckpoint } from '../PdcaWorkItemBridge';
import type { BlockedCommandEntry } from './blockedCommandLedger.js';
import { projectCheckpointSteps } from './checkpointSnapshot.js';
import type { TaskPolicySnapshot } from './policySnapshot.js';

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
      ...(input.policySnapshot ? { policySnapshot: input.policySnapshot } : {}),
    });
  } catch {
    // @ignore-catch — checkpoint 写入失败不影响任务执行
  }
}
