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

import { describe, expect, it } from 'bun:test';
import { summarizeRun, summarizeTask } from '../../src/evals/scoring';
import {
  deriveF2pP2P,
  type JunitCaseResult,
} from '../../src/evals/repoTestJudge';
import type {
  EvalAttempt,
  EvalTask,
  EvalTaskResult,
} from '../../src/evals/types';

/**
 * A2（`.trae/specs/eval-s1-real-task-baseline.md`）T2/T3：
 * `deriveF2pP2P` 派生 + `summarizeTask` 的 resolved / breaking / no-op。
 */

// ── 夹具 ──────────────────────────────────────────────────────────────────
function mkTask(id: string, f2p?: string[], p2p?: string[]): EvalTask {
  return {
    id,
    name: id,
    level: 'L1',
    assertionPolarity: 'positive',
    prompt: () => '',
    assert: async () => ({ pass: true }),
    ...(f2p ? { f2p } : {}),
    ...(p2p ? { p2p } : {}),
  };
}

/** `passedCases === undefined` 表示"该 attempt 无逐用例结果"（执行异常等） */
function mkAttempt(index: number, passedCases?: string[]): EvalAttempt {
  return {
    index,
    assertion: { pass: false, ...(passedCases ? { passedCases } : {}) },
    asExpected: false,
    durationMs: 1,
  };
}

const c = (
  file: string,
  classname: string,
  name: string,
  status: JunitCaseResult['status']
): JunitCaseResult => ({ file, classname, name, status });

// ── deriveF2pP2P（T2） ────────────────────────────────────────────────────
describe('deriveF2pP2P（A2/T2）', () => {
  it('起点红⇒F2P、起点绿⇒P2P、起点 skipped 两不入', () => {
    const start = [
      c('a/t.test.ts', 's', 'fail1', 'failed'),
      c('a/t.test.ts', 's', 'ok1', 'passed'),
      c('a/t.test.ts', 's', 'lazy', 'skipped'),
    ];
    const fixed = [
      c('a/t.test.ts', 's', 'fail1', 'passed'),
      c('a/t.test.ts', 's', 'ok1', 'passed'),
      c('a/t.test.ts', 's', 'lazy', 'skipped'),
    ];

    const lists = deriveF2pP2P(start, fixed)!;

    expect(lists.f2p).toEqual(['a/t.test.ts::s::fail1']);
    expect(lists.p2p).toEqual(['a/t.test.ts::s::ok1']);
  });

  it('任一侧用例缺失 ⇒ null（fail-closed，不猜）', () => {
    expect(deriveF2pP2P(null, [c('a', 's', 'x', 'passed')])).toBeNull();
    expect(deriveF2pP2P([c('a', 's', 'x', 'passed')], null)).toBeNull();
  });

  it('起点失败、修复态**仍失败** ⇒ 不计入 F2P（题目不自洽）', () => {
    const start = [c('a/t.test.ts', 's', 'x', 'failed')];
    const fixed = [c('a/t.test.ts', 's', 'x', 'failed')];

    const lists = deriveF2pP2P(start, fixed)!;

    expect(lists.f2p).toEqual([]);
    expect(lists.p2p).toEqual([]);
  });
});

// ── summarizeTask 三态（T3） ──────────────────────────────────────────────
describe('summarizeTask 的 resolved / breaking / no-op（A2/T3）', () => {
  const task = mkTask('fix-x', ['a'], ['b']);

  it('三态逐 attempt 判定并计数；F2P 部分过 / 无逐用例结果 ⇒ **未归类**', () => {
    const attempts = [
      mkAttempt(1, ['a', 'b']), // F2P 全过 ∧ P2P 全过 ⇒ resolved
      mkAttempt(2, ['a']), // F2P 全过 ∧ P2P 破  ⇒ breaking
      mkAttempt(3, ['b']), // F2P 全不过        ⇒ no-op
      mkAttempt(4, []), // F2P 全不过        ⇒ no-op
      mkAttempt(5), // 无逐用例结果      ⇒ 未归类
      mkAttempt(6, ['a', 'b', 'c']), // 额外通过不影响 ⇒ resolved
    ];

    const r = summarizeTask(task, attempts);

    expect(r.f2pP2P).toEqual({
      f2pTotal: 1,
      p2pTotal: 1,
      resolved: 2,
      breaking: 1,
      noOp: 2,
      attempts: 6,
    });
  });

  it('F2P **部分**通过 ⇒ 三态皆不计（如实留白）', () => {
    const multi = mkTask('fix-y', ['a', 'x'], ['b']);

    const r = summarizeTask(multi, [mkAttempt(1, ['a', 'b'])]);

    expect(r.f2pP2P).toEqual({
      f2pTotal: 2,
      p2pTotal: 1,
      resolved: 0,
      breaking: 0,
      noOp: 0,
      attempts: 1,
    });
  });

  it('未声明 f2p ⇒ **不带** f2pP2P（旧题行为逐字不变）', () => {
    const plain = mkTask('plain');

    const r = summarizeTask(plain, [mkAttempt(1, ['a'])]);

    expect(r.f2pP2P).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(r, 'f2pP2P')).toBe(false);
  });
});

// ── summarizeRun.resolvedRate（T3） ───────────────────────────────────────
describe('summarizeRun.resolvedRate（A2/T3）', () => {
  const summaryOf = (results: EvalTaskResult[]) =>
    summarizeRun({
      startedAt: 't0',
      finishedAt: 't1',
      model: 'm',
      k: 2,
      tasks: results,
    });

  it('仅 F2P/P2P 任务参与分母；k 次**全** resolved 才计入分子', () => {
    const fully = summarizeTask(mkTask('ok', ['a']), [
      mkAttempt(1, ['a']),
      mkAttempt(2, ['a']),
    ]);
    const partial = summarizeTask(mkTask('bad', ['a']), [
      mkAttempt(1, ['a']),
      mkAttempt(2, []),
    ]);

    // 两者都声明了 F2P ⇒ 分母 2；仅 `fully` 两次全 resolved ⇒ 1/2
    expect(summaryOf([fully, partial]).resolvedRate).toBe(0.5);
  });

  it('未声明 F2P/P2P 的任务**不进分母**', () => {
    const withList = summarizeTask(mkTask('ok', ['a']), [
      mkAttempt(1, ['a']),
      mkAttempt(2, ['a']),
    ]);
    const plain = summarizeTask(mkTask('plain'), [mkAttempt(1)]);

    // 分母只有 `withList`（1 个），且它全 resolved ⇒ 1
    expect(summaryOf([withList, plain]).resolvedRate).toBe(1);
  });

  it('无 F2P/P2P 任务 ⇒ `undefined`（报告不显示该段，避免"0%"假信号）', () => {
    const plain = summarizeTask(mkTask('plain'), [mkAttempt(1)]);

    expect(summaryOf([plain]).resolvedRate).toBeUndefined();
  });
});
