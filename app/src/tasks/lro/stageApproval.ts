// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * stageApproval — 阶段审批的**收件箱卡**（P0，2026-11-24）。
 *
 * 根因（真机 `session_mwq5ookl21aa28ea96`）：工具审批有 Inbox 卡（TTL / 通知 / 过期回调），
 * 而**阶段审批只有 checkpoint**。启动扫描的判据是"待审批 ⇒ 收件箱应有 pending 卡"，
 * 阶段审批必然无卡 ⇒ 任何停在 `stage_awaiting_approval` 的任务**重启一次就被判孤儿**，
 * 回执还误称"进程重启"。
 *
 * 现口径：进入审批门时建卡（`source='pdca'` + `metadata.approvalKind='stage'`），
 * 离开审批门（批准 / 拒绝 / 中止）时把卡置过期；过期由入口层收口为
 * `abortedBy='approval_expired'`（见 `stageChainExpiry.ts`）。
 */
import { getLogger } from '@openliri/infra/monitoring';
import { readPdcaCheckpoint, writePdcaCheckpoint } from '../PdcaWorkItemBridge';
import { PDCA_PHASE_ABORT, pdcaCheckpointStatus } from '../phases';
import { ABORTED_BY_USER_ABORT } from './abortAttribution';
import { emitPdcaInterruptedReceipts } from './terminalReceipt';

const logger = getLogger('tasks:stageApproval');

/** 阶段审批卡的来源标记（`abortPdcaAfterExpiry` / 续跑分流据此走阶段链语义） */
export const STAGE_APPROVAL_KIND = 'stage';

export interface OpenStageApprovalInput {
  /** 阶段链父任务 ID（不是子阶段 ID） */
  taskId: string;
  sessionId: string;
  stageId: string;
  stageName: string;
}

/**
 * 建阶段审批卡；无会话 / 写库失败 ⇒ `null`（不阻断阶段链，只是回到"无卡"旧行为）。
 */
export async function openStageApprovalCard(
  input: OpenStageApprovalInput
): Promise<string | null> {
  if (!input.sessionId) return null;
  try {
    const { inboxManager } =
      await import('@openliri/service/runtime/InboxManager');
    const item = await inboxManager.submit({
      sessionId: input.sessionId,
      type: 'approval',
      title: `阶段审批：${input.stageName}`,
      message: `阶段「${input.stageName}」已产出交付物，确认后继续后续阶段。`,
      offlineCapable: true,
      options: ['approve', 'deny'],
      source: 'pdca',
      metadata: {
        taskId: input.taskId,
        approvalKind: STAGE_APPROVAL_KIND,
        stageId: input.stageId,
        sourceModule: 'stage_chain',
      },
    });
    logger.info('阶段审批卡已创建', {
      taskId: input.taskId,
      stageId: input.stageId,
      inboxId: item.id,
    });
    return item.id;
  } catch (err) {
    // @ignore-catch — 卡片属附加通道，失败不得阻断阶段链
    logger.warn('阶段审批卡创建失败（阶段链继续等待）', {
      taskId: input.taskId,
      stageId: input.stageId,
      error: String(err),
    });
    return null;
  }
}

/**
 * 关闭阶段审批卡（置过期）。
 *
 * ⚠️ 用 `expireByIds`（只改状态 + 审计）而**不是**等待 TTL 扫描：后者会触达过期监听器，
 * 把刚批准、正在推进的链又收口一次。
 */
export async function expireStageApprovalCard(
  inboxId: string | undefined
): Promise<void> {
  if (!inboxId) return;
  try {
    const { inboxManager } =
      await import('@openliri/service/runtime/InboxManager');
    await inboxManager.expireByIds([inboxId]);
  } catch (err) {
    logger.warn('阶段审批卡关闭失败（不影响阶段推进）', {
      inboxId,
      error: String(err),
    });
  }
}

/**
 * 阶段审批落定（入口层注册的回调，服务层 `resumePdcaIfApplicable` 调用）。
 *
 * - 批准 ⇒ `StageOrchestrator.resumeAfterApproval()`（已完成阶段不重跑）；
 * - 拒绝 ⇒ 写 abort 终态并发回执（与"用户中止"同口径，不谎报进程重启）。
 */
export async function settleStageApproval(input: {
  taskId: string;
  sessionId: string;
  approved: boolean;
}): Promise<void> {
  const { StageOrchestrator, createDefaultStageRunner } =
    await import('../StageOrchestrator');
  const orchestrator = await StageOrchestrator.fromCheckpoint(input.taskId, {
    runStage: createDefaultStageRunner(),
  });
  if (!orchestrator) {
    logger.warn('阶段审批落定：目标不是阶段链任务', { taskId: input.taskId });
    return;
  }
  if (input.approved) {
    try {
      await orchestrator.resumeAfterApproval();
      logger.info('阶段审批通过 ⇒ 阶段链已续跑', { taskId: input.taskId });
    } catch (err) {
      logger.warn('阶段审批通过后阶段链续跑失败', {
        taskId: input.taskId,
        error: String(err),
      });
    }
    return;
  }

  const ck = (await readPdcaCheckpoint(input.taskId)) ?? {};
  const aborted: Record<string, unknown> = {
    ...ck,
    phase: PDCA_PHASE_ABORT,
    status: pdcaCheckpointStatus(PDCA_PHASE_ABORT),
    abortedBy: ABORTED_BY_USER_ABORT,
    abortedAt: new Date().toISOString(),
  };
  await writePdcaCheckpoint(input.taskId, aborted);
  // 回执照实播报（阶段数/产物），归因走 `user_abort` ⇒ 文案为"用户拒绝"
  emitPdcaInterruptedReceipts([aborted]);
  logger.info('阶段审批被拒 ⇒ 阶段链已中止', { taskId: input.taskId });
}
