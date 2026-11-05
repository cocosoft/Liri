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
 * 两次运行的**可复现性对比**（P39 验收：两次运行差异可解释 ±10%）。
 *
 * **纯函数**：不读文件、不跑模型、不依赖沙箱 ⇒ 同一份报告可复算、可直接单测。
 * 与 `orderInvariance.ts` 同取向（那份比的是"正序 vs 倒序"的**结论序列**，本份比的是
 * "同一题集连跑两轮"的 **pass^1 漂移**），门禁取向也一致：**仅当两轮可比时给结论**。
 *
 * 口径（**不做解释性推断**，只如实列示）：
 * - `pass^1` 已按 G-08 排除环境噪声（`failureKind === 'infra'`）⇒ 两轮的噪声次数单独列出，
 *   供"差异是否由基建造成"的人工判断；
 * - **逐题差异** = 第二轮 `pass^1` − 第一轮 `pass^1`（正 = 第二轮更好）；`|diff| > tolerance`
 *   记为 `drift`（超出 ±10%）；
 * - **聚合差异**用参与比对任务的 `pass^1` 均值的**相对变化**（`|B−A| / A`），
 *   第一轮均值为 0 ⇒ 不给相对差（`undefined`，不臆造 0%）。
 *
 * 结论口径：`withinTolerance = 题集一致 ∧ 有可比对任务 ∧ 相对差 ≤ tolerance`。
 * **逐题 drift 不单独否决**：两次真实模型运行的题内波动本就可能超过 10%（k 小时尤甚），
 * 面板要的是"总体差异可解释"；`drifted` 只用于把差异摆到台面上（由人解释）。
 */

import type {
  EvalTaskResult,
  RunVarianceReport,
  TaskVariance,
} from './types.js';

// 契约层（`types.ts`）持有类型；本文件只保留判定实现（R00-003：types ↔ 实现互引会成环）
export type { RunVarianceReport, TaskVariance } from './types.js';

/** 默认容差（10%，与 P39 验收口径一致） */
export const DEFAULT_VARIANCE_TOLERANCE = 0.1;

/**
 * P39 采样门槛（2026-11-05）：±10% **复现性门禁**要求 k≥8。
 *
 * 实测依据（同题集 12 题 · 300s 超时 · infra 重试 1）：
 * - k=4 两轮相对差 **15.6%**（判"不达标"）—— 单题粒度就是 25%，实为抽样噪声；
 * - k=8 两轮相对差 **2.2%**（达标），逐题漂移全部是单次 attempt 翻转（±12.5%）。
 * ⇒ k<8 时该门禁会给出**假失败**，必须先提高采样再门禁化。
 * 代价：12 题 × 8 次 × 2 轮 ≈ 96 次调用 / 约 90 分钟。
 */
export const MIN_K_FOR_VARIANCE_GATE = 8;

export interface VarianceSamplingCheck {
  ok: boolean;
  reason?: string;
}

/** 采样是否足以支撑 ±10% 门禁（纯函数；CLI 在 `--check-variance` 时调用） */
export function checkVarianceSampling(k: number): VarianceSamplingCheck {
  if (Number.isInteger(k) && k >= MIN_K_FOR_VARIANCE_GATE) return { ok: true };
  return {
    ok: false,
    reason:
      `--check-variance 需要 k≥${MIN_K_FOR_VARIANCE_GATE}（当前 k=${k}）：` +
      `k=4 时单题粒度 25%、实测两轮相对差 15.6% 属抽样噪声 ⇒ 门禁会假失败；` +
      `k=${MIN_K_FOR_VARIANCE_GATE} 实测 2.2%。请加 --k=${MIN_K_FOR_VARIANCE_GATE}` +
      `（约 96 次调用 / 90 分钟）。`,
  };
}

function noiseOf(result: EvalTaskResult): number {
  return result.environmentNoiseAttempts ?? 0;
}

/**
 * 对比两轮结果（**纯函数**）。
 *
 * @param first  第一轮（基线轮）
 * @param second 第二轮（复现轮）
 * @param tolerance 容差（默认 10%；传 `0` ⇒ 只接受逐题完全相同）
 */
export function compareRunVariance(
  first: readonly EvalTaskResult[],
  second: readonly EvalTaskResult[],
  tolerance: number = DEFAULT_VARIANCE_TOLERANCE
): RunVarianceReport {
  const firstById = new Map(first.map((r) => [r.task.id, r]));
  const secondById = new Map(second.map((r) => [r.task.id, r]));

  const onlyFirst: string[] = [];
  const onlySecond: string[] = [];
  for (const id of firstById.keys()) {
    if (!secondById.has(id)) onlyFirst.push(id);
  }
  for (const id of secondById.keys()) {
    if (!firstById.has(id)) onlySecond.push(id);
  }

  const tasks: TaskVariance[] = [];
  for (const [id, a] of firstById) {
    const b = secondById.get(id);
    if (!b) continue;
    const delta = b.pass1 - a.pass1;
    const status: TaskVariance['status'] =
      delta === 0
        ? 'stable'
        : Math.abs(delta) <= tolerance
          ? 'within_tolerance'
          : 'drift';
    tasks.push({
      taskId: id,
      firstPass1: a.pass1,
      secondPass1: b.pass1,
      delta,
      firstNoise: noiseOf(a),
      secondNoise: noiseOf(b),
      status,
    });
  }

  const compared = tasks.length;
  const firstMean =
    compared === 0
      ? 0
      : tasks.reduce((sum, t) => sum + t.firstPass1, 0) / compared;
  const secondMean =
    compared === 0
      ? 0
      : tasks.reduce((sum, t) => sum + t.secondPass1, 0) / compared;
  const meanDelta = secondMean - firstMean;
  const relativeDelta =
    compared === 0 || firstMean === 0
      ? undefined
      : Math.abs(meanDelta) / firstMean;

  return {
    tolerance,
    compared,
    onlyFirst,
    onlySecond,
    firstMean,
    secondMean,
    meanDelta,
    ...(relativeDelta !== undefined ? { relativeDelta } : {}),
    tasks,
    drifted: tasks.filter((t) => t.status === 'drift').map((t) => t.taskId),
    stable: tasks.filter((t) => t.status === 'stable').length,
    withinTolerance:
      compared > 0 &&
      onlyFirst.length === 0 &&
      onlySecond.length === 0 &&
      relativeDelta !== undefined &&
      relativeDelta <= tolerance,
  };
}

/** 人读摘要（CLI 输出用；纯字符串拼接，便于断言） */
export function formatRunVariance(report: RunVarianceReport): string[] {
  const lines: string[] = [];
  const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;
  lines.push(
    `[两次运行] 可比对 ${report.compared} 题 ｜ pass^1 均值 ${pct(report.firstMean)} → ${pct(report.secondMean)}` +
      `（相对差 ${report.relativeDelta === undefined ? 'n/a（首轮均值为 0）' : pct(report.relativeDelta)}，容差 ${pct(report.tolerance)}）`
  );
  lines.push(
    `  逐题：稳定 ${report.stable} ｜ 容差内 ${report.tasks.filter((t) => t.status === 'within_tolerance').length} ｜ 超出 ${report.drifted.length}`
  );
  for (const id of report.onlyFirst) lines.push(`  ❌ 仅第一轮出现：${id}`);
  for (const id of report.onlySecond) lines.push(`  ❌ 仅第二轮出现：${id}`);
  for (const task of report.tasks) {
    if (task.status !== 'drift') continue;
    lines.push(
      `  ⚠️ 漂移 ${task.taskId}：${pct(task.firstPass1)} → ${pct(task.secondPass1)}` +
        `（${task.delta > 0 ? '+' : ''}${pct(task.delta)}）` +
        ` ｜ 噪声 ${task.firstNoise}/${task.secondNoise} 次`
    );
  }
  lines.push(
    report.withinTolerance
      ? '  ✅ 结论：两次运行总体差异在容差内'
      : '  ⚠️ 结论：**两次运行差异超出容差**（或题集不一致）—— 需先解释差异再采信基线'
  );
  return lines;
}
