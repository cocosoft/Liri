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
 * A3-b（2026-09-26，《Liri 优化方案》）：**顺序无关性校验**（纯函数）。
 *
 * **要治的病**：沙箱的"外层状态"不随任务边界重置 —— DB 来自真实库快照、`LIRI_HOME` /
 * `LIRI_DATA_DIR`、`/tmp`、已安装依赖、端口占用都会**跨任务累积** ⇒ 题目的**执行顺序会影响
 * 结论**（`--task=` 单跑通过、整轮跑失败）。这比 flaky 更隐蔽，且会**污染基线**。
 *
 * **做法**：正序 + 倒序各跑一轮，把同一题在两轮里的**结论序列**逐项比对；出现差异即存在
 * 顺序依赖。
 *
 * **比对判据（说明为什么不用浮点 `pass1` 做判据）**：以 `asExpected` **序列**（长度 + 逐项）
 * 与 `passK` 为准 —— 序列相同即蕴含 `pass1` 相同；直接把 `pass1` 当等式判据会引入浮点比较，
 * 反而更脆。`pass1` 仍随差异一并回显，便于人读。
 */

import type { EvalTaskResult } from './types.js';

/** 单题差异 */
export interface OrderMismatch {
  taskId: string;
  /** 正序轮：各 attempt 的"符合预期"结论 */
  forwardSeq: boolean[];
  /** 倒序轮：同一题的各 attempt 结论 */
  reversedSeq: boolean[];
  forwardPass1: number;
  reversedPass1: number;
  forwardPassK: boolean;
  reversedPassK: boolean;
}

/** 顺序无关性报告 */
export interface OrderInvarianceReport {
  /** 两轮都出现、可逐项比对的任务数 */
  compared: number;
  /** 仅在其中一轮出现（题集应相同 ⇒ 出现即异常） */
  onlyForward: string[];
  onlyReversed: string[];
  mismatches: OrderMismatch[];
  /** 有可比对任务 **且** 无差异 */
  invariant: boolean;
}

function seqOf(result: EvalTaskResult): boolean[] {
  return result.attempts.map((a) => a.asExpected);
}

function sameSeq(a: boolean[], b: boolean[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, i) => value === b[i]);
}

/**
 * 比对两轮结果。**纯函数**：不读写文件、不依赖沙箱与网络，便于直接单测。
 */
export function compareOrderInvariance(
  forward: EvalTaskResult[],
  reversed: EvalTaskResult[]
): OrderInvarianceReport {
  const forwardById = new Map(forward.map((r) => [r.task.id, r]));
  const reversedById = new Map(reversed.map((r) => [r.task.id, r]));

  const onlyForward: string[] = [];
  const onlyReversed: string[] = [];
  for (const id of forwardById.keys()) {
    if (!reversedById.has(id)) onlyForward.push(id);
  }
  for (const id of reversedById.keys()) {
    if (!forwardById.has(id)) onlyReversed.push(id);
  }

  const mismatches: OrderMismatch[] = [];
  for (const [id, f] of forwardById) {
    const r = reversedById.get(id);
    if (!r) continue;
    const forwardSeq = seqOf(f);
    const reversedSeq = seqOf(r);
    if (sameSeq(forwardSeq, reversedSeq) && f.passK === r.passK) continue;
    mismatches.push({
      taskId: id,
      forwardSeq,
      reversedSeq,
      forwardPass1: f.pass1,
      reversedPass1: r.pass1,
      forwardPassK: f.passK,
      reversedPassK: r.passK,
    });
  }

  const compared = forwardById.size - onlyForward.length;
  return {
    compared,
    onlyForward,
    onlyReversed,
    mismatches,
    invariant:
      compared > 0 &&
      mismatches.length === 0 &&
      onlyForward.length === 0 &&
      onlyReversed.length === 0,
  };
}

/** 人读摘要（CLI 输出用；保持纯字符串拼接，便于断言） */
export function formatOrderInvariance(report: OrderInvarianceReport): string[] {
  const lines: string[] = [];
  lines.push(
    `[顺序无关性] 可比对 ${report.compared} 题 ｜ 差异 ${report.mismatches.length} 题` +
      ` ｜ 仅正序 ${report.onlyForward.length} ｜ 仅倒序 ${report.onlyReversed.length}`
  );
  for (const id of report.onlyForward) lines.push(`  ❌ 仅正序出现：${id}`);
  for (const id of report.onlyReversed) lines.push(`  ❌ 仅倒序出现：${id}`);
  for (const m of report.mismatches) {
    lines.push(
      `  ❌ ${m.taskId}：正序 [${m.forwardSeq.join(',')}] (pass^1 ${(m.forwardPass1 * 100).toFixed(0)}%)` +
        ` ≠ 倒序 [${m.reversedSeq.join(',')}] (pass^1 ${(m.reversedPass1 * 100).toFixed(0)}%)` +
        ` ｜ pass^k ${m.forwardPassK ? '✅' : '❌'} vs ${m.reversedPassK ? '✅' : '❌'}`
    );
  }
  lines.push(
    report.invariant
      ? '  ✅ 结论：顺序无关（两轮逐项一致）'
      : '  ⚠️ 结论：**存在顺序依赖**（或题集不一致）——须定位污染源后再采基线'
  );
  return lines;
}
