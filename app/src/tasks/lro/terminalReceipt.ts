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

import { mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { resolveTaskDeliveryPath } from '@openliri/infra/environment';
import { getLogger } from '@openliri/infra/monitoring';
import type { AuditReport } from '../AuditReport';
import {
  taskOrchestrator,
  PLAN_STATUS_FAILED,
  STEP_STATUS_COMPLETED,
} from '../TaskOrchestrator';
import type { Plan } from '../TaskOrchestrator';
// 2026-11-08：回执里的「可 replan」以检查点为准（与 `/resume` 的 409 判据同源）
import { readPdcaCheckpoint } from '../PdcaWorkItemBridge';

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
  /**
   * 2026-11-08（真机 `pdca_mw76rof9`）：**可 replan 续跑**（有步骤决策为 escalate）。
   *
   * escalate 收尾时 `phase` 故意留在 `execute`（防覆盖 `replanPending`）⇒ 回执若只说
   * "未完成"，用户看不到唯一的恢复入口；补一句"可 replan 续跑"。
   */
  replanAvailable?: boolean;
  /**
   * 2026-11-08（真机 `pdca_mw7f7h2g`）：**任务级失败**（如目标未收敛
   * `PDCA_GOAL_NOT_CONVERGED`）。此时步骤可能 2/2 全通过、0 失败 ⇒ 只按步数会输出假的
   * 「✅ 长程任务完成」，与 `plan.status=failed` / `/resume` 409 自相矛盾。
   */
  taskFailed?: boolean;
  /**
   * B3（2026-11-09）：交付事实 —— **产物路径清单**（各步 `artifacts` 台账去重汇总）。
   * 缺失/为空 ⇒ 回执不追加该段（不造占位，CS04）。
   */
  artifacts?: string[];
  /**
   * B3：**未能验证的验收项**（步骤未完成且从未产出审查结果）。
   * 只是事实投影，不推断"达成"或"未达成"。
   */
  unverified?: string[];
  /** B3：建议的后续动作（仅由既有事实推导，如可 replan）；缺失 ⇒ 不追加 */
  nextSteps?: string[];
}

/**
 * 终态回执文案（纯函数，供单测；与 `emitPdcaReceipt` 同一口径）。
 *
 * 口径：**不做状态词汇比较**（`lint:state-ratchet`：状态字面量须收敛到唯一事实源），
 * 只用"步数事实 + 阶段名（数据）+ 显式挂起/中止标记"决定文案。
 */
export function formatPdcaReceipt(input: PdcaReceiptFacts): string {
  const {
    taskId,
    phase,
    completed,
    total,
    failed,
    paused,
    aborted,
    replanAvailable,
    taskFailed,
  } = input;
  let head: string;
  if (aborted) {
    head = `⏹ 长程任务已中止：${completed}/${total} 步已达成（taskId ${taskId}）`;
  } else if (paused) {
    head = `⏸ 长程任务已挂起等待审批：${completed}/${total} 步已达成（阶段 ${phase}，taskId ${taskId}）`;
  } else if (!taskFailed && total > 0 && completed === total && failed === 0) {
    head = `✅ 长程任务完成：${completed}/${total} 步（taskId ${taskId}）`;
  } else if (failed > 0) {
    head = `⚠️ 长程任务未完成：${completed}/${total} 步达成，${failed} 步失败（阶段 ${phase}，taskId ${taskId}）${
      replanAvailable ? '；可 replan 续跑' : ''
    }`;
  } else if (taskFailed) {
    // 任务级失败但无失败步骤（目标未收敛）⇒ 不说「0 步失败」，只报事实
    head = `⚠️ 长程任务未完成：${completed}/${total} 步已达成，目标未通过终态校验（阶段 ${phase}，taskId ${taskId}）${
      replanAvailable ? '；可 replan 续跑' : ''
    }`;
  } else {
    head = `⏸ 长程任务未结束：${completed}/${total} 步已达成（阶段 ${phase}，taskId ${taskId}）`;
  }
  return head + formatDeliverySections(input);
}

/**
 * B3（2026-11-09）：交付分段 —— **仅在事实非空时追加**（缺失不造占位，CS04/CS06）。
 */
function formatDeliverySections(input: PdcaReceiptFacts): string {
  const sections: string[] = [];
  const artifacts = (input.artifacts ?? [])
    .map((a) => a.trim())
    .filter(Boolean);
  if (artifacts.length > 0) {
    sections.push(['📦 产物：', ...artifacts.map((a) => `- ${a}`)].join('\n'));
  }
  const unverified = (input.unverified ?? [])
    .map((u) => u.trim())
    .filter(Boolean);
  if (unverified.length > 0) {
    sections.push(
      ['⚠️ 未验证的验收项：', ...unverified.map((u) => `- ${u}`)].join('\n')
    );
  }
  const nextSteps = (input.nextSteps ?? [])
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3);
  if (nextSteps.length > 0) {
    sections.push(
      ['➡️ 下一步：', ...nextSteps.map((s) => `- ${s}`)].join('\n')
    );
  }
  return sections.length > 0 ? `\n\n${sections.join('\n\n')}` : '';
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
  const text = formatPdcaReceipt(facts);
  emitPdcaReceiptText({
    taskId: facts.taskId,
    sessionId: facts.sessionId,
    text,
  });
}

/**
 * B3（2026-11-09）：从计划快照收集**交付事实**（只投影既有数据，不推断）。
 *
 * - `artifacts`：各步 `artifacts` 台账去重汇总（执行器的写后读回台账）；
 * - `unverified`：**未完成且从未产出审查结果**的步骤验收项 —— 这类验收项确实"没能验证"；
 *   已验证但被判不通过的步骤不计入（那是"未通过"，已由失败步数表达）。
 */
export function collectDeliveryFacts(plan: Plan | undefined): {
  artifacts?: string[];
  unverified?: string[];
} {
  if (!plan) return {};
  const artifacts = [
    ...new Set(
      plan.steps.flatMap((s) => s.artifacts ?? []).map((a) => a.trim())
    ),
  ].filter(Boolean);
  const unverified = plan.steps
    .filter((s) => s.status !== STEP_STATUS_COMPLETED && !s.reviewResult)
    .map((s) => (s.acceptanceCriteria ?? '').trim() || s.description)
    .filter(Boolean);
  return {
    ...(artifacts.length > 0 ? { artifacts } : {}),
    ...(unverified.length > 0 ? { unverified } : {}),
  };
}

/**
 * B3（2026-11-09）：demand 会话的交付留存 —— `<data>/artifacts/<taskId>/delivery.md`。
 *
 * 与回执**同源文案**（同一 `formatPdcaReceipt` 产物），只补任务/会话/阶段头信息。
 * 写盘失败只告警：交付留存属附加面，不得影响任务终态（会话回执已发出）。
 */
function persistDemandDelivery(input: {
  taskId: string;
  sessionId?: string | null;
  phase: string;
  text: string;
}): void {
  try {
    const path = resolveTaskDeliveryPath(input.taskId);
    mkdirSync(dirname(path), { recursive: true });
    const header = [
      `# 交付回执 · ${input.taskId}`,
      '',
      `- 生成时间：${new Date().toISOString()}`,
      `- 会话：${input.sessionId ?? '（无）'}`,
      `- 阶段：${input.phase || '（未知）'}`,
      '',
      '---',
      '',
    ].join('\n');
    writeFileSync(path, `${header}${input.text}\n`, 'utf-8');
    logger.info('demand 交付回执已落盘', { taskId: input.taskId, path });
  } catch (err) {
    // @ignore-catch — 交付留存属附加动作，失败不得影响任务终态
    logger.warn('demand 交付回执落盘失败（不影响任务结果）', {
      taskId: input.taskId,
      error: String(err),
    });
  }
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
 * 启动扫描把**崩溃遗留**任务标 abort 后的回执（入口层调用）。
 *
 * 2026-11-08（真机 `pdca_mw7d3dq3`）：进程被杀 ⇒ 重启扫描把任务标 abort，但会话里
 * **没有任何结论**，用户只看到停在半截的消息。现补一条中断回执，并告知可续跑入口
 * （扫描已写 `abortedBy='startup_scan'`，`/resume` 与 `PDCA_AUTO_RESUME` 均放行）。
 */
export function emitPdcaInterruptedReceipts(
  checkpoints: Array<Record<string, unknown>>
): void {
  for (const ck of checkpoints) {
    const taskId = String(ck.taskId ?? '');
    const steps = Array.isArray(ck.steps) ? ck.steps.length : 0;
    const tail =
      steps > 0
        ? `可 POST /v1/pdca/${taskId}/resume 或 /goal resume 续跑`
        : '无步骤快照，无法自动续跑';
    emitPdcaReceiptText({
      taskId,
      sessionId: (ck.sessionId as string | undefined) ?? null,
      text: `⏹ 长程任务因进程重启被中断：${steps} 步计划已保留（taskId ${taskId}）；${tail}`,
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
  hasPushChannel: boolean,
  /** B3（2026-11-09）：许愿式（demand）会话 ⇒ 终态额外落盘 `delivery.md` */
  demand = false
): void {
  // 2026-11-08（真机 `pdca_mw76rof9`）：escalate 收尾时 phase 留在 execute（防覆盖
  // replanPending）⇒ ⚠️ 回执要带上"可 replan"的提示。
  // 2026-11-08（真机 `pdca_mw771zbt`）：**以检查点的 `replanPending` 为准** —— 只看步骤
  // `decision='escalate'` 会在 replan 次数用尽后仍写"可 replan 续跑"，而 `/resume` 此时
  // 按设计回 409（提示与事实不符）。读取失败/无检查点 ⇒ 不提示（回执本身照发）。
  void (async () => {
    const plan = report.planId
      ? taskOrchestrator.getPlan(report.planId)
      : undefined;
    let replanAvailable = false;
    try {
      const ck = await readPdcaCheckpoint(report.taskId);
      replanAvailable = ck?.replanPending === true;
    } catch (err) {
      // @ignore-catch — replan 提示属附加信息，读取失败不得影响回执
      logger.warn('读取检查点失败（回执不提示 replan）', {
        taskId: report.taskId,
        error: String(err),
      });
    }
    const delivery = collectDeliveryFacts(plan);
    const facts: PdcaReceiptFacts = {
      taskId: report.taskId,
      phase: plan?.status ?? '',
      completed: report.completedSteps,
      total: report.totalSteps,
      failed: report.failedSteps,
      replanAvailable,
      // 2026-11-08（真机 `pdca_mw7f7h2g`）：目标未收敛时步骤可能全通过、0 失败 ⇒
      // 必须把**任务级失败**显式带给文案，否则会输出假的「✅ 完成」。
      taskFailed: plan?.status === PLAN_STATUS_FAILED,
      ...delivery,
      // B3：可 replan 是唯一能由事实确定的后续动作；其余不猜（缺失不造占位）
      ...(replanAvailable
        ? {
            nextSteps: [`POST /v1/pdca/${report.taskId}/resume 续跑（replan）`],
          }
        : {}),
    };
    emitPdcaReceipt({
      ...facts,
      sessionId: plan?.sessionId,
      hasPushChannel,
    });
    if (demand) {
      persistDemandDelivery({
        taskId: report.taskId,
        sessionId: plan?.sessionId,
        phase: facts.phase,
        text: formatPdcaReceipt(facts),
      });
    }
  })();
}

/**
 * 中止回执（`writeAbortCheckpoint` 落点）：用户拒绝审批 / 手动中止时也要有结论。
 *
 * 2026-11-08（真机 `pdca_mw6vej5m`）：拒绝审批后任务 `phase=abort`、检查点 aborted，
 * 但会话里**只有挂起那一刻的 ⏸**，用户看不出任务已经结束。
 */
export function emitPdcaAbortReceipt(
  report: AuditReport,
  hasPushChannel: boolean,
  /** B3（2026-11-09）：许愿式（demand）会话 ⇒ 中止也留交付回执 */
  demand = false
): void {
  const plan = report.planId
    ? taskOrchestrator.getPlan(report.planId)
    : undefined;
  const facts: PdcaReceiptFacts = {
    taskId: report.taskId,
    phase: 'abort',
    completed: report.completedSteps,
    total: report.totalSteps,
    failed: report.failedSteps,
    aborted: true,
    ...collectDeliveryFacts(plan),
  };
  emitPdcaReceipt({
    ...facts,
    sessionId: plan?.sessionId,
    hasPushChannel,
  });
  if (demand) {
    persistDemandDelivery({
      taskId: report.taskId,
      sessionId: plan?.sessionId,
      phase: facts.phase,
      text: formatPdcaReceipt(facts),
    });
  }
}
