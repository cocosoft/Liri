// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * escalate 收尾（半自动 replan）+ §60.4②「同一缺陷重复 N 次即终止」（2026-11-10）。
 *
 * **原实现**内联在 `LongRunningTaskOrchestrator` 的终态裁决里（约 25 行）：写
 * `replanFailCount`，达 `PDCA_REPLAN_MAX_RETRIES` 则 `replanPending=false` 转人工。
 * 外移到本模块的原因有二：
 *   1. 宿主文件已到 2000 行红线（`lint:size`），需要腾出空间加新判定；
 *   2. 判定逻辑可单测（`buildDefectSignature` / `decideDefectRepeat` 为纯函数）。
 *
 * **新增语义（§60.4②）**：escаlate 的缺陷清单归一后算指纹，**同一指纹连续出现**
 * 达 `PDCA_DEFECT_REPEAT_LIMIT`（默认 2）轮 ⇒ 不再 replan，直接以
 * `PDCA_DEFECT_REPEATED` 收尾并发一条结论回执（此前会一路重试到 `maxReplan`）。
 * 指纹不同（出现新缺陷）⇒ 仍走原 `maxReplan` 预算，不早停。
 *
 * 如实边界：指纹是**精确匹配**（缺陷文本归一 + 排序 + sha1）。若 replan 改写了步骤
 * 描述导致缺陷措辞变化，则视为「新缺陷」⇒ 回落到既有 `maxReplan` 兜底，不会误杀。
 */

import { createHash } from 'crypto';
import { configManager } from '@openliri/infra/config';
import { getLogger } from '@openliri/infra/monitoring';
import { readPdcaCheckpoint, writePdcaCheckpoint } from '../PdcaWorkItemBridge';
import { PLAN_STATUS_FAILED } from '../TaskOrchestrator';
import {
  PDCA_PHASE_EXECUTE,
  PDCA_PHASE_FAILED,
  type PdcaPhase,
} from '../phases';
import { replanMaxRetries } from './portResolvers.js';
import { emitPdcaReceiptText } from './terminalReceipt.js';
import { settleGoalById } from '../goal/goalRunBinding.js';
import { GOAL_STATUS_FAILED } from '../goal/TaskGoalStore';

const logger = getLogger('tasks:longRunning');

/** 缺陷指纹（短哈希 + 人读摘要） */
export interface DefectSignature {
  /** 归一 + 排序后的缺陷清单 sha1（跨轮可比、检查点体积可控） */
  signature: string;
  /** 人读摘要（去重后的前 3 条缺陷，≤200 字） */
  summary: string;
}

/**
 * 由本轮 escalate 捕获的缺陷清单算指纹；无缺陷（review 未给 issues）⇒ `null`
 * （无法判定"同一缺陷"⇒ 不早停，退回 `maxReplan` 兜底）。
 */
export function buildDefectSignature(
  escalations: ReadonlyArray<{ defects?: ReadonlyArray<string> }>
): DefectSignature | null {
  const defects = escalations
    .flatMap((e) => e.defects ?? [])
    .map((d) => d.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .sort();
  if (defects.length === 0) return null;
  const signature = createHash('sha1').update(defects.join('\n')).digest('hex');
  const summary = [...new Set(defects)].slice(0, 3).join('；');
  return {
    signature,
    summary: summary.length > 200 ? `${summary.slice(0, 200)}…` : summary,
  };
}

/**
 * 缺陷重复阈值（§60.4②）：`PDCA_DEFECT_REPEAT_LIMIT`，默认 2（第二次重现即终止）。
 * 下限 2：1 会让首轮 escalate 就无法 replan（等于废掉 replan 闭环）。
 */
export function defectRepeatLimit(): number {
  const raw = Number(configManager.env('PDCA_DEFECT_REPEAT_LIMIT'));
  return Number.isFinite(raw) && raw >= 2 ? Math.floor(raw) : 2;
}

/**
 * 同一缺陷指纹的连续重复判定。
 *
 * - 本轮无指纹（`null`）⇒ `count=0`、不终止；
 * - 与上一轮指纹相同 ⇒ `count = 上轮 + 1`；不同 ⇒ `count = 1`（重新计数）；
 * - `count >= limit` ⇒ `repeated=true`（调用方据此停止 replan）。
 */
export function decideDefectRepeat(input: {
  signature: string | null;
  previousSignature?: unknown;
  previousCount?: unknown;
  limit: number;
}): { count: number; repeated: boolean } {
  const limit =
    Number.isFinite(input.limit) && input.limit >= 2
      ? Math.floor(input.limit)
      : 2;
  if (!input.signature) return { count: 0, repeated: false };
  const prevSignature =
    typeof input.previousSignature === 'string'
      ? input.previousSignature
      : undefined;
  const prevCount = Number(input.previousCount);
  const same = prevSignature === input.signature;
  const count =
    same && Number.isFinite(prevCount) && prevCount > 0
      ? Math.floor(prevCount) + 1
      : 1;
  return { count, repeated: count >= limit };
}

export interface FinalizeEscalationInput {
  taskId: string;
  sessionId?: string | null;
  /** 目标（有 goalId 才在终止时把目标从 blocked 落为 failed） */
  goalId?: string | null;
  /** 本轮 escalate 捕获的缺陷（`_lastEscalations`；replan 后会被清空） */
  escalations: ReadonlyArray<{ defects?: ReadonlyArray<string> }>;
  /** 同步内存阶段（宿主 `setPhase`） */
  setPhase: (phase: PdcaPhase) => Promise<void>;
}

export interface FinalizeEscalationResult {
  /** 是否挂起等待 replan（与检查点同源） */
  replanPending: boolean;
  /** 同一缺陷达重复上限 ⇒ 调用方应把 escalate 语义降为 failed */
  stoppedByDefectRepeat: boolean;
  /** 终止时的失败原因（含缺陷摘要，供终态回执/生命周期使用） */
  failureReason?: string;
  defectRepeatCount: number;
  defectSummary?: string;
}

/**
 * escalate 收尾：写 `replanFailCount` + 缺陷重复计数，并按闸门决定是否还挂起 replan。
 *
 * 与原内联实现**逐字同口径**的部分：`next < maxReplan` ⇒ phase 回 `execute`，否则 `failed`
 * （2026-11-08 真机 `pdca_mw79lfjh`：用尽则落 failed，否则详情接口永远"执行中"）。
 */
export async function finalizeEscalation(
  input: FinalizeEscalationInput
): Promise<FinalizeEscalationResult> {
  const prevCk = (await readPdcaCheckpoint(input.taskId)) ?? {};
  const next = (Number(prevCk.replanFailCount) || 0) + 1;
  const maxReplan = replanMaxRetries();
  const built = buildDefectSignature(input.escalations);
  const decision = decideDefectRepeat({
    signature: built?.signature ?? null,
    previousSignature: prevCk.defectSignature,
    previousCount: prevCk.defectRepeatCount,
    limit: defectRepeatLimit(),
  });
  const stopped = decision.repeated;
  const replanPending = !stopped && next < maxReplan;
  const phase: PdcaPhase = replanPending
    ? PDCA_PHASE_EXECUTE
    : PDCA_PHASE_FAILED;

  await input.setPhase(phase);
  await writePdcaCheckpoint(input.taskId, {
    taskId: input.taskId,
    phase,
    status: PLAN_STATUS_FAILED,
    replanPending,
    replanFailCount: next,
    replanConvergedAt: replanPending ? undefined : new Date().toISOString(),
    // §60.4②：缺陷指纹/计数/摘要（跨 replan、跨重启累计；`/v1/pdca/:id` 可回溯）
    defectSignature: built?.signature,
    defectRepeatCount: decision.count,
    defectSummary: built?.summary ?? undefined,
    stopReason: stopped ? 'defect_repeated' : undefined,
  });
  logger.info('[orchestrator] escalate 收尾（半自动 replan）', {
    taskId: input.taskId,
    replanFailCount: next,
    maxReplan,
    replanPending,
    defectRepeatCount: decision.count,
    defectRepeated: stopped,
  });

  if (!stopped) {
    return {
      replanPending,
      stoppedByDefectRepeat: false,
      defectRepeatCount: decision.count,
      ...(built ? { defectSummary: built.summary } : {}),
    };
  }

  // ── 终止路径：给结论（回执 + 目标落 failed），不再消耗下一轮 replan ──
  const summary = built?.summary ?? '（本轮 escalate 未提供缺陷描述）';
  emitPdcaReceiptText({
    taskId: input.taskId,
    sessionId: input.sessionId,
    text: `⛔ 同一缺陷已连续 ${decision.count} 轮重现，停止重规划：${summary}`,
  });
  // 目标此前已按 escalate 落 `blocked`（非终态）⇒ 终止时改落 `failed`
  await settleGoalById({
    goalId: input.goalId ?? undefined,
    status: GOAL_STATUS_FAILED,
    reason: 'batch_failed',
  });
  return {
    replanPending,
    stoppedByDefectRepeat: true,
    failureReason: `PDCA_DEFECT_REPEATED: ${summary}`,
    defectRepeatCount: decision.count,
    defectSummary: summary,
  };
}
