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
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * U4 在线质量评估：**启发式打分 + 可疑轮判定**（**纯函数**，零 IO / 零 LLM）。
 *
 * 规格：`.trae/specs/online-quality-evaluation.md` §3 D1 / D2（本文件即 D1/D2 的实现）。
 *
 * 边界（详见 `./types.ts` 头注释）：
 * - **不消费 `BehaviorMetrics`**（该类型契约"仅观测、不得作判据"，且有反向锁定测试）；
 * - **不判正确性**（无 ground truth）⇒ `score` 是**相对分**，必须随 `evaluatorVersion` 一起消费；
 * - `status === 'running'` ⇒ **不评**（返回 `null`）：把"进行中"当低质是错的。
 */

import type {
  SuspiciousInput,
  SuspiciousReason,
  SuspiciousVerdict,
  TurnQualitySignals,
  TurnScore,
  TurnScoreComponents,
} from './types.js';
import {
  COMPLETION_SCORE,
  CONSECUTIVE_LOW_SCORE_RUNS,
  DURATION_HARD_MS,
  DURATION_SOFT_MS,
  EVALUATOR_VERSION,
  OUTPUT_TOKENS_HARD,
  OUTPUT_TOKENS_SOFT,
  SUSPICIOUS_SCORE_THRESHOLD,
  TOOL_CALLS_HARD_MAX,
  TOOL_CALLS_SOFT_MAX,
  VERDICT_SCORE,
  VERDICT_UNKNOWN,
  WEIGHTS,
} from './weights.js';

/** 归一化到 `[0,1]`（权重表若被改错也不让分数越界） */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * 软/硬阈之间的**线性衰减**：`≤ soft ⇒ 1`；`≥ hard ⇒ 0`；中间线性。
 *
 * 未知值（`undefined` 由调用方折算为 0）落在 `≤ soft` ⇒ **不扣分** —— 这是刻意的：
 * "没测到"不等于"花了很久"（CS03：不为未测到的情形编造惩罚）。
 */
function decay(value: number, soft: number, hard: number): number {
  if (!Number.isFinite(value) || value <= soft) return 1;
  if (value >= hard) return 0;
  return 1 - (value - soft) / (hard - soft);
}

/**
 * 对**单轮**打相对质量分。
 *
 * @returns `null` = 该轮**不该评**（`status === 'running'` 未终态）；否则为 0..1 的合成分。
 */
export function scoreTurn(signals: TurnQualitySignals): TurnScore | null {
  if (signals.status === 'running') return null;

  const completion = COMPLETION_SCORE[signals.status];
  const verdict = signals.verdict
    ? VERDICT_SCORE[signals.verdict.type]
    : VERDICT_UNKNOWN;
  const toolThrash = decay(
    signals.toolCalls,
    TOOL_CALLS_SOFT_MAX,
    TOOL_CALLS_HARD_MAX
  );
  // 时长与出参 token 各占一半 ⇒ 缺一不影响另一项的表达（未知侧不扣分）
  const cost =
    (decay(signals.durationMs ?? 0, DURATION_SOFT_MS, DURATION_HARD_MS) +
      decay(signals.outputTokens, OUTPUT_TOKENS_SOFT, OUTPUT_TOKENS_HARD)) /
    2;

  const components: TurnScoreComponents = {
    completion,
    verdict,
    toolThrash,
    cost,
  };

  const score =
    completion * WEIGHTS.completion +
    verdict * WEIGHTS.verdict +
    toolThrash * WEIGHTS.toolThrash +
    cost * WEIGHTS.cost;

  return {
    score: clamp01(score),
    components,
    evaluatorVersion: EVALUATOR_VERSION,
  };
}

/**
 * 维护"连续低分"计数（**纯函数**）：本轮低分 ⇒ 上一值 + 1，否则归 0。
 *
 * 供消费方（评估编排）在按轮遍历时累积；本函数只认**数值**判据（CS02）。
 */
export function nextLowScoreStreak(
  previousStreak: number,
  isLowScore: boolean
): number {
  return isLowScore ? Math.max(0, previousStreak) + 1 : 0;
}

/**
 * **可疑轮判定**（规格 D2）：四条规则**任一成立**即可疑 ⇒ 触发 LLM 复核。
 *
 * 1. `not-completed`：`status !== 'completed'`（`error` / `aborted`）；
 * 2. `verdict-negative`：该轮验证器结论 ∈ `{ REJECT, ESCALATE }`；
 * 3. `low-score`：启发式分 < `SUSPICIOUS_SCORE_THRESHOLD`；
 * 4. `low-score-streak`：**含本轮**连续低分 ≥ `CONSECUTIVE_LOW_SCORE_RUNS`（同一失败模式复现）。
 *
 * 规则 4 与规则 3 可能同时成立（前者是"反复"信号）⇒ 返回**全部**命中原因，便于事件载荷与复盘。
 */
export function isSuspicious(input: SuspiciousInput): SuspiciousVerdict {
  const reasons: SuspiciousReason[] = [];

  if (input.signals.status !== 'completed') {
    reasons.push('not-completed');
  }

  const verdictType = input.signals.verdict?.type;
  if (verdictType === 'REJECT' || verdictType === 'ESCALATE') {
    reasons.push('verdict-negative');
  }

  if (input.score < SUSPICIOUS_SCORE_THRESHOLD) {
    reasons.push('low-score');
  }

  if (input.consecutiveLowScores >= CONSECUTIVE_LOW_SCORE_RUNS) {
    reasons.push('low-score-streak');
  }

  return { suspicious: reasons.length > 0, reasons };
}
