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
 * A3-b（2026-09-26，《Liri 优化方案》）：顺序无关性比对（纯函数）。
 *
 * 覆盖：两轮逐项一致 ⇒ `invariant`；单题某一 attempt 翻转 / attempt 数不同 ⇒ 计为差异；
 * 题集不一致（仅一轮出现）⇒ 也判失败；空输入 ⇒ **不**判"无关"（有可比对任务才算）。
 */
import { describe, expect, it } from 'bun:test';
import {
  compareOrderInvariance,
  formatOrderInvariance,
} from '../../src/evals/orderInvariance';
import type {
  EvalAttempt,
  EvalTask,
  EvalTaskResult,
} from '../../src/evals/types';

/** 用"结论序列"造一条任务结果（`asExpected` 序列即本轮逐次结论） */
function result(taskId: string, seq: boolean[]): EvalTaskResult {
  const attempts: EvalAttempt[] = seq.map((asExpected, i) => ({
    index: i + 1,
    assertion: { pass: asExpected },
    asExpected,
    durationMs: 1,
  }));
  const passCount = seq.filter(Boolean).length;
  return {
    task: { id: taskId } as unknown as EvalTask,
    attempts,
    assertPassCount: passCount,
    pass1: seq.length === 0 ? 0 : passCount / seq.length,
    passK: seq.length > 0 && seq.every(Boolean),
  };
}

describe('A3-b: compareOrderInvariance', () => {
  it('两轮逐项一致 ⇒ invariant=true，无差异', () => {
    const report = compareOrderInvariance(
      [result('t1', [true, true]), result('t2', [true, false])],
      [result('t2', [true, false]), result('t1', [true, true])]
    );
    expect(report.compared).toBe(2);
    expect(report.mismatches).toEqual([]);
    expect(report.onlyForward).toEqual([]);
    expect(report.onlyReversed).toEqual([]);
    expect(report.invariant).toBe(true);
  });

  it('单题某个 attempt 结论翻转 ⇒ 计为差异（顺序依赖信号）', () => {
    const report = compareOrderInvariance(
      [result('t1', [true, true, true])],
      [result('t1', [true, false, true])]
    );
    expect(report.invariant).toBe(false);
    expect(report.mismatches).toHaveLength(1);
    expect(report.mismatches[0].taskId).toBe('t1');
    expect(report.mismatches[0].forwardSeq).toEqual([true, true, true]);
    expect(report.mismatches[0].reversedSeq).toEqual([true, false, true]);
    expect(report.mismatches[0].forwardPassK).toBe(true);
    expect(report.mismatches[0].reversedPassK).toBe(false);
  });

  it('attempt 数不同 ⇒ 计为差异（不按"前缀相同"放过）', () => {
    const report = compareOrderInvariance(
      [result('t1', [true, true])],
      [result('t1', [true])]
    );
    expect(report.invariant).toBe(false);
    expect(report.mismatches.map((m) => m.taskId)).toEqual(['t1']);
  });

  it('题集不一致（仅一轮出现）⇒ 判失败并分列', () => {
    const report = compareOrderInvariance(
      [result('t1', [true]), result('only-forward', [false])],
      [result('t1', [true]), result('only-reversed', [true])]
    );
    expect(report.onlyForward).toEqual(['only-forward']);
    expect(report.onlyReversed).toEqual(['only-reversed']);
    expect(report.invariant).toBe(false);
  });

  it('空输入 ⇒ 不算"顺序无关"（无可比对任务）', () => {
    const report = compareOrderInvariance([], []);
    expect(report.compared).toBe(0);
    expect(report.invariant).toBe(false);
  });
});

describe('A3-b: formatOrderInvariance（CLI 输出）', () => {
  it('一致 ⇒ 出现 ✅ 结论行', () => {
    const lines = formatOrderInvariance(
      compareOrderInvariance([result('t1', [true])], [result('t1', [true])])
    );
    expect(lines[0]).toContain('可比对 1 题');
    expect(lines.some((l) => l.includes('✅ 结论：顺序无关'))).toBe(true);
  });

  it('有差异 ⇒ 逐题回显两轮序列 + ⚠️ 结论行', () => {
    const lines = formatOrderInvariance(
      compareOrderInvariance([result('t1', [true])], [result('t1', [false])])
    );
    expect(
      lines.some(
        (l) => l.includes('t1') && l.includes('[true]') && l.includes('[false]')
      )
    ).toBe(true);
    expect(lines.some((l) => l.includes('⚠️ 结论：**存在顺序依赖**'))).toBe(
      true
    );
  });
});
