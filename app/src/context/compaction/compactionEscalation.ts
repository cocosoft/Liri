/**
 * compactionEscalation.ts — 预算低水位 × 工具 Schema 熵 → **压缩升级**判据（纯函数，2026-10-21）
 *
 * 由来（`dev_docs/20261020/google ai 建议.md` §三）：纯 Token 水位触发的压缩与多智能体轮次
 * 深度脱节 ⇒ 建议把「剩余金额低水位」与「工具 Schema 熵超标」联立，强制升级到激进裁剪。
 *
 * 衔接既有实现（不重复造轮子）：
 * - 剩余 USD 水位：`usdWaterlineShadow.ts`（G-05 影子观察，已算好 `remainingPct`）——
 *   本模块复用其 `USD_WATERLINE_TRIGGER_PCT`，不自带第二份 20；
 * - 熵阈值：由**调用方**传入 `SCHEMA_ENTROPY_PERCENT_THRESHOLD`（单一事实源在 `tools`），
 *   本文件不复制 30 这个数字；
 * - 本模块只做**联立判定**，不执行压缩。
 *
 * **默认不启用**（与 G-05 取证一致：低水位成功样本不足）；开关见
 * `CONTEXT_COMPACTION_ESCALATION`（默认 `false`）。开启后仍要求两个信号**都有值**：
 * 缺失任一 / 非有限数 ⇒ 不升级（不臆造）。
 */

import { USD_WATERLINE_TRIGGER_PCT } from './usdWaterlineShadow';

export interface CompactionEscalationInput {
  /** 剩余额度百分比（0–100）；`null` = 未配置金额上限 */
  remainingPct: number | null;
  /** 最近一轮工具 Schema 占上下文窗口比例（%）；`null` = 尚无观测 */
  entropyPercent: number | null;
  /** 熵阈值（调用方传 `SCHEMA_ENTROPY_PERCENT_THRESHOLD`，保持单一事实源） */
  entropyThresholdPct: number;
  /** 剩余水位阈值（缺省复用 `USD_WATERLINE_TRIGGER_PCT` = 20） */
  remainingThresholdPct?: number;
}

export interface CompactionEscalationResult {
  escalate: boolean;
  /** 升级理由（仅 `escalate=true` 时提供，供日志/排查） */
  reason?: string;
}

/** 联立判定：低水位 **且** 熵超标 ⇒ 升级（两个信号缺一不判） */
export function shouldEscalateCompaction(
  input: CompactionEscalationInput
): CompactionEscalationResult {
  const remainingThreshold =
    input.remainingThresholdPct ?? USD_WATERLINE_TRIGGER_PCT;

  if (input.remainingPct === null || input.entropyPercent === null) {
    return { escalate: false };
  }
  // 非有限值视为"信号不可用"（NaN 比较恒 false，显式拦掉而不是靠隐式语义）
  if (
    !Number.isFinite(input.remainingPct) ||
    !Number.isFinite(input.entropyPercent)
  ) {
    return { escalate: false };
  }
  if (input.remainingPct > remainingThreshold) return { escalate: false };
  if (input.entropyPercent <= input.entropyThresholdPct) {
    return { escalate: false };
  }
  return {
    escalate: true,
    reason:
      `预算剩余 ${input.remainingPct}% ≤ ${remainingThreshold}%` +
      ` 且工具 Schema 熵 ${input.entropyPercent.toFixed(1)}% > ${input.entropyThresholdPct}%` +
      ' ⇒ 升级为激进裁剪',
  };
}
