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
}

/**
 * 终态回执文案（纯函数，供单测；与 `emitPdcaReceipt` 同一口径）。
 *
 * 口径：**不做状态词汇比较**（`lint:state-ratchet`：状态字面量须收敛到唯一事实源），
 * 只用"步数事实 + 阶段名（数据）"决定文案。
 */
export function formatPdcaReceipt(input: PdcaReceiptFacts): string {
  const { taskId, phase, completed, total, failed } = input;
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

/** 发一条回执；无落点 / 无会话 / 有推送通道 / 写入失败 ⇒ 静默跳过（不阻断任务） */
export function emitPdcaReceipt(
  facts: PdcaReceiptFacts & {
    sessionId?: string | null;
    hasPushChannel?: boolean;
  }
): void {
  if (facts.hasPushChannel) return;
  const text = formatPdcaReceipt({
    taskId: facts.taskId,
    phase: facts.phase,
    completed: facts.completed,
    total: facts.total,
    failed: facts.failed,
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
