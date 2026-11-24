// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * stageChainExpiry — 审批卡过期 ⇒ **当场**收口阶段链父检查点（批次 5，2026-11-24）。
 *
 * 真机 `session_mwq5ookl21aa28ea96` 的触发链：
 *   审批卡 14:01 过期 → `abortPdcaAfterExpiry` 只 abort **子阶段** LRO（`pdca_x_requirement`）
 *   → 父检查点 `pdca_x` 仍停在 `stage_awaiting_approval`
 *   → 14:33 重启时被启动扫描按**孤儿**收口（`abortedBy='orphan_scan'`）
 *   → 用户要等到下次重启才知道，且被误导为"进程重启"。
 *
 * 本模块补的就是中间那一环：过期**当场**把父链收口为 `abort` +
 * `abortedBy='approval_expired'`，并立即发一条回执（含 `/goal resume stage` 续跑入口）。
 *
 * 只在父链**确实停在审批门**（`stage_awaiting_approval`）时收口：
 * 父链仍在 `running` 时由内存编排器自行感知子任务失败并推进，此处并发写 abort 会与其打架。
 */

import { getLogger } from '@openliri/infra/monitoring';
import { readPdcaCheckpoint, writePdcaCheckpoint } from '../PdcaWorkItemBridge';
import { STAGE_DEFS } from '../StageOrchestrator';
import {
  PDCA_PHASE_ABORT,
  PDCA_PHASE_STAGE_AWAITING_APPROVAL,
  PDCA_TERMINAL_PHASES,
  pdcaCheckpointStatus,
} from '../phases';
import { ABORTED_BY_APPROVAL_EXPIRED } from './abortAttribution';
import { emitPdcaInterruptedReceipts } from './terminalReceipt';

const logger = getLogger('tasks:stageChainExpiry');

/**
 * 子阶段 taskId（`<父链>_<stageId>`）→ 父链 taskId；不是阶段子任务 ⇒ `null`。
 *
 * 推导依据是 `StageOrchestrator.create` 的命名约定（`pdcaTaskId = ${taskId}_${stageId}`），
 * 检查点本身没有 parent 字段，故只能按约定反解（与 `STAGE_DEFS` 同源）。
 */
export function resolveParentStageChainId(taskId: string): string | null {
  for (const def of STAGE_DEFS) {
    const suffix = `_${def.id}`;
    if (taskId.length > suffix.length && taskId.endsWith(suffix)) {
      return taskId.slice(0, -suffix.length);
    }
  }
  return null;
}

/**
 * 审批卡过期后收口阶段链父检查点；返回被收口的父链 taskId（无需收口 ⇒ `null`）。
 *
 * 入参可以是**子阶段** ID（`<父链>_<stageId>`）或**父链** ID —— 阶段审批卡（P0，2026-11-24）
 * 直接携带父链 ID，故两种形态都要支持。
 *
 * 幂等：父链已是终态（含已 abort）⇒ 直接跳过，不重复发回执。
 */
export async function closeOutStageChainAfterApprovalExpiry(
  stageOrParentTaskId: string
): Promise<string | null> {
  const direct = await readPdcaCheckpoint(stageOrParentTaskId);
  const isParentChain = Array.isArray(direct?.stages);
  const parentId = isParentChain
    ? stageOrParentTaskId
    : resolveParentStageChainId(stageOrParentTaskId);
  if (!parentId) return null;
  try {
    const ck = isParentChain ? direct : await readPdcaCheckpoint(parentId);
    if (!ck || !Array.isArray(ck.stages)) return null;
    const phase = ck.phase as string | undefined;
    if (phase !== undefined && PDCA_TERMINAL_PHASES.has(phase)) return null;
    if (phase !== PDCA_PHASE_STAGE_AWAITING_APPROVAL) return null;

    const aborted: Record<string, unknown> = {
      ...ck,
      phase: PDCA_PHASE_ABORT,
      status: pdcaCheckpointStatus(PDCA_PHASE_ABORT),
      abortedBy: ABORTED_BY_APPROVAL_EXPIRED,
      abortedAt: new Date().toISOString(),
    };
    await writePdcaCheckpoint(parentId, aborted);
    // 当场给会话一条结论：用户不必等到下次重启才知道，也不被误导为"进程重启"。
    emitPdcaInterruptedReceipts([aborted]);
    logger.info('审批卡过期 ⇒ 阶段链已当场收口', {
      parentId,
      sourceTaskId: stageOrParentTaskId,
      phase,
    });
    return parentId;
  } catch (err) {
    // @ignore-catch — 收口属补充动作，失败不得影响子任务中止
    logger.warn('审批卡过期后收口阶段链失败（不影响子任务中止）', {
      parentId,
      sourceTaskId: stageOrParentTaskId,
      error: String(err),
    });
    return null;
  }
}
