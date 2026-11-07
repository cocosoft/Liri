// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * terminalReceipt — PDCA 终态回执的**唯一发出点**（2026-11-08）
 *
 * 为什么下沉到编排层：`POST /v1/pdca/start` 拿到的编排器**没有** `onTaskMessage`
 * （日志 `hasOnTaskMessage:false`）⇒ 会话一条消息都没有。原实现把回执挂在 **HTTP 启动
 * 路径**的 `.then()` 上，于是「审批 → 续跑」这条路径（`inboxApproval` →
 * `resumeAfterApproval`，与 HTTP 启动无关）**永远拿不到回执**：真机 `pdca_mw6rx5kr`
 * 批准并续跑后最终 escalate，会话里只剩挂起那一刻的「⏸ 未结束」，用户看不到结果。
 *
 * 现口径：**completed / failed（含 escalate）/ 挂起** 三个落点各发一条，统一走本模块；
 * 有推送通道（CLI/REPL 的 `onTaskMessage`）的任务不再重复发（否则同一结果两条）。
 */

import { getLogger } from '@openliri/infra/monitoring';
import type { AuditReport } from '../AuditReport';
import { taskOrchestrator } from '../TaskOrchestrator';

const logger = getLogger('tasks:longRunning');

/** 回执文案所需的**事实**（只用步数 + 阶段名，不比较状态词汇） */
export interface PdcaReceiptFacts {
  taskId: string;
  phase: string;
  completed: number;
  total: number;
  failed: number;
  /**
   * 2026-11-08（真机 `pdca_mw6tie3k`）：**已挂起等待审批**。
   *
   * 必须由落点显式标注：挂起时"可见步骤恰好全部完成"是常见形态（产物已写好，只剩一条
   * 需要批准的 shell 命令）⇒ 只按步数判定会输出「✅ 长程任务完成」，而任务其实在等审批
   * （真机：会话里就出现了这条假的完成回执）。
   */
  paused?: boolean;
  /**
   * 2026-11-08（真机 `pdca_mw6vej5m`）：**已中止**（用户拒绝审批 / 手动中止）。
   *
   * 中止走的是 `writeAbortCheckpoint`，此前**完全不出回执** ⇒ 用户拒绝后会话停在
   * 「⏸ 已挂起等待审批」再无下文，看起来像卡死。
   */
  aborted?: boolean;
}

/**
 * 终态回执文案（纯函数，供单测；与 `emitPdcaReceipt` 同一口径）。
 *
 * 口径：**不做状态词汇比较**（`lint:state-ratchet`：状态字面量须收敛到唯一事实源），
 * 只用"步数事实 + 阶段名（数据）+ 显式挂起/中止标记"决定文案。
 */
export function formatPdcaReceipt(input: PdcaReceiptFacts): string {
  const { taskId, phase, completed, total, failed, paused, aborted } = input;
  if (aborted)
    return `⏹ 长程任务已中止：${completed}/${total} 步已达成（taskId ${taskId}）`;
  if (paused)
    return `⏸ 长程任务已挂起等待审批：${completed}/${total} 步已达成（阶段 ${phase}，taskId ${taskId}）`;
  if (total > 0 && completed === total && failed === 0)
    return `✅ 长程任务完成：${completed}/${total} 步（taskId ${taskId}）`;
  if (failed > 0)
    return `⚠️ 长程任务未完成：${completed}/${total} 步达成，${failed} 步失败（阶段 ${phase}，taskId ${taskId}）`;
  return `⏸ 长程任务未结束：${completed}/${total} 步已达成（阶段 ${phase}，taskId ${taskId}）`;
}

/** 回执落点（会话消息写入由 app 层注册；tasks 域不直接持有 chatManager） */
export type PdcaReceiptSink = (payload: {
  taskId: string;
  sessionId: string;
  text: string;
}) => void;

let receiptSink: PdcaReceiptSink | undefined;

/** 注册回执落点（与 `setStepLoopFactory` 同型：进程级、幂等、可清理） */
export function setPdcaReceiptSink(sink: PdcaReceiptSink | undefined): void {
  receiptSink = sink;
}

/**
 * 终态收口：作废本任务遗留的待审批卡（2026-11-08 真机 `pdca_mw6yabdj`）。
 *
 * 为什么会留下：步骤执行期先提交审批卡，之后才判"挂起轮次上限"；达上限直接落 failed 时，
 * 那张卡**永远不会**再被续跑消费，却仍挂在收件箱/会话里（用户点"批准"只会给已失败任务
 * 触发一次无效续跑）。终态即置 `expired`（保留历史，不删行）。
 */
async function expireOrphanApprovalCards(
  taskId: string,
  sessionId: string
): Promise<void> {
  try {
    const { inboxManager, INBOX_STATUS_PENDING } =
      await import('@openliri/service/runtime/InboxManager');
    const listed = await inboxManager.list({
      sessionId,
      status: INBOX_STATUS_PENDING,
      type: 'approval',
      limit: 50,
      offset: 0,
    });
    const ids = listed.items
      .filter(
        (i) =>
          i.metadata?.pdcaTaskId === taskId || i.metadata?.taskId === taskId
      )
      .map((i) => i.id);
    if (ids.length === 0) return;
    const expired = await inboxManager.expireByIds(ids);
    logger.info('PDCA 终态 ⇒ 遗留审批卡已置过期', { taskId, expired });
  } catch (err) {
    // @ignore-catch — 清理属收口附加动作，失败不得影响任务终态
    logger.warn('终态清理遗留审批卡失败（不影响任务结果）', {
      taskId,
      error: String(err),
    });
  }
}

/** 发一条回执；无落点 / 无会话 / 有推送通道 / 写入失败 ⇒ 静默跳过（不阻断任务） */
export function emitPdcaReceipt(
  facts: PdcaReceiptFacts & {
    sessionId?: string | null;
    hasPushChannel?: boolean;
  }
): void {
  // 挂起态（paused）的卡是**有效**审批卡，必须保留；只有终态才作废遗留卡。
  // 与推送通道无关：CLI/REPL 同样会建 Inbox 卡。
  if (!facts.paused && facts.sessionId) {
    void expireOrphanApprovalCards(facts.taskId, facts.sessionId);
  }
  if (facts.hasPushChannel) return;
  const text = formatPdcaReceipt({
    taskId: facts.taskId,
    phase: facts.phase,
    completed: facts.completed,
    total: facts.total,
    failed: facts.failed,
    ...(facts.paused ? { paused: true } : {}),
    ...(facts.aborted ? { aborted: true } : {}),
  });
  emitPdcaReceiptText({
    taskId: facts.taskId,
    sessionId: facts.sessionId,
    text,
  });
}

/**
 * 原文回执（异常/非标准路径用）：不经过步数投影，避免为凑文案而**编造步数**（CS04）。
 */
export function emitPdcaReceiptText(input: {
  taskId: string;
  sessionId?: string | null;
  text: string;
}): void {
  const sessionId = input.sessionId;
  if (!sessionId || !receiptSink) return;
  try {
    receiptSink({ taskId: input.taskId, sessionId, text: input.text });
  } catch (err) {
    // @ignore-catch — 回执属附加信息，写入失败不得影响任务终态
    logger.warn('PDCA 终态回执写入失败（不影响任务结果）', {
      taskId: input.taskId,
      sessionId,
      error: String(err),
    });
  }
}

/**
 * 审计报告落盘后的终态回执（completed / failed 两条路径共用同一落点）。
 *
 * 口径与 `persistAuditReport` 同源：报告字段即"步数事实"，阶段名取计划的 `status`。
 */
export function emitPdcaReceiptFromAudit(
  report: AuditReport,
  hasPushChannel: boolean
): void {
  const plan = report.planId
    ? taskOrchestrator.getPlan(report.planId)
    : undefined;
  emitPdcaReceipt({
    taskId: report.taskId,
    sessionId: plan?.sessionId,
    phase: plan?.status ?? '',
    completed: report.completedSteps,
    total: report.totalSteps,
    failed: report.failedSteps,
    hasPushChannel,
  });
}

/**
 * 中止回执（`writeAbortCheckpoint` 落点）：用户拒绝审批 / 手动中止时也要有结论。
 *
 * 2026-11-08（真机 `pdca_mw6vej5m`）：拒绝审批后任务 `phase=abort`、检查点 aborted，
 * 但会话里**只有挂起那一刻的 ⏸**，用户看不出任务已经结束。
 */
export function emitPdcaAbortReceipt(
  report: AuditReport,
  hasPushChannel: boolean
): void {
  const plan = report.planId
    ? taskOrchestrator.getPlan(report.planId)
    : undefined;
  emitPdcaReceipt({
    taskId: report.taskId,
    sessionId: plan?.sessionId,
    phase: 'abort',
    completed: report.completedSteps,
    total: report.totalSteps,
    failed: report.failedSteps,
    aborted: true,
    hasPushChannel,
  });
}
