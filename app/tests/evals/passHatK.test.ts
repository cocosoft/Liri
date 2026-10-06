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

import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  computeReliabilityCurve,
  passHatK,
  summarizeRun,
  summarizeTask,
} from '../../src/evals/scoring';
import { writeReport } from '../../src/evals/report';
import type { EvalAttempt, EvalTask } from '../../src/evals/types';

/**
 * 论文 A1（`.trae/specs/eval-pass-hat-k-reliability.md`）：`passHatK` 组合式估计 + 可靠性曲线。
 */

function mkTask(id: string): EvalTask {
  return {
    id,
    name: id,
    level: 'L1',
    assertionPolarity: 'positive',
    prompt: () => '',
    assert: async () => ({ pass: true }),
  };
}

/** `ok=true` ⇒ 符合期望（asExpected），用于构造成功次数 */
function mkAttempt(index: number, ok: boolean): EvalAttempt {
  return { index, assertion: { pass: ok }, asExpected: ok, durationMs: 1 };
}

const attempts = (okCount: number, n: number): EvalAttempt[] =>
  Array.from({ length: n }, (_, i) => mkAttempt(i + 1, i < okCount));

describe('passHatK（论文 A1）', () => {
  it('C(c,k)/C(n,k)：3/4 手算序列 = 0.75 / 0.5 / 0.25 / 0', () => {
    expect(passHatK(3, 4, 1)).toBeCloseTo(0.75, 10);
    expect(passHatK(3, 4, 2)).toBeCloseTo(0.5, 10); // C(3,2)/C(4,2) = 3/6
    expect(passHatK(3, 4, 3)).toBeCloseTo(0.25, 10); // C(3,3)/C(4,3) = 1/4
    expect(passHatK(3, 4, 4)).toBeCloseTo(0, 10); // k>c ⇒ 0
  });

  it('k=1 与 pass1 **同值**（successes/n）—— 自洽校验', () => {
    for (const [c, n] of [
      [0, 4],
      [1, 4],
      [3, 4],
      [4, 4],
      [2, 7],
    ] as const) {
      expect(passHatK(c, n, 1)).toBeCloseTo(c / n, 10);
    }
  });

  it('边界（不抛错，一律 0）', () => {
    expect(passHatK(0, 0, 1)).toBe(0); // n=0
    expect(passHatK(4, 4, 0)).toBe(0); // k=0
    expect(passHatK(4, 4, 5)).toBe(0); // k>n
    expect(passHatK(2, 4, 3)).toBe(0); // k>c
    expect(passHatK(-1, 4, 1)).toBe(0); // 负数截到 0
    expect(passHatK(Number.NaN, 4, 1)).toBe(0);
    expect(passHatK(4, Number.POSITIVE_INFINITY, 1)).toBe(0);
  });
});

describe('computeReliabilityCurve（论文 A1）', () => {
  it('全过 ⇒ 各点均 1；全挂 ⇒ 各点均 0', () => {
    const allPass = computeReliabilityCurve([
      { successes: 4, n: 4 },
      { successes: 4, n: 4 },
    ])!;
    expect(allPass.map((p) => p.k)).toEqual([1, 2, 3, 4]);
    expect(allPass.every((p) => p.value === 1 && p.tasks === 2)).toBe(true);

    const allFail = computeReliabilityCurve([
      { successes: 0, n: 4 },
      { successes: 0, n: 4 },
    ])!;
    expect(allFail.every((p) => p.value === 0)).toBe(true);
  });

  it('多点：3/4 与 4/4 的任务平均（手算可验）', () => {
    const curve = computeReliabilityCurve([
      { successes: 3, n: 4 },
      { successes: 4, n: 4 },
    ])!;

    expect(curve.map((p) => p.value)).toEqual([0.875, 0.75, 0.625, 0.5]);
    expect(curve.every((p) => p.tasks === 2)).toBe(true);
  });

  it('**不等 n**：`n_t < k` 的任务**退出该点**（不当作失败），并如实记录参与数', () => {
    const curve = computeReliabilityCurve([
      { successes: 1, n: 1 },
      { successes: 2, n: 4 },
    ])!;

    // k=1：两者都参与 ⇒ (1 + 2/4)/2 = 0.75
    expect(curve[0]).toEqual({ k: 1, value: 0.75, tasks: 2 });
    // k=2..4：只有 {2,4} 参与 ⇒ C(2,2)/C(4,2)=1/6 · k>c ⇒ 0 · k>c ⇒ 0
    expect(curve[1]).toEqual({ k: 2, value: 1 / 6, tasks: 1 });
    expect(curve[2]).toEqual({ k: 3, value: 0, tasks: 1 });
    expect(curve[3]).toEqual({ k: 4, value: 0, tasks: 1 });
  });

  it('无任何任务有运行记录 ⇒ `undefined`（不出字段，不编造）', () => {
    expect(computeReliabilityCurve([])).toBeUndefined();
    expect(computeReliabilityCurve([{ successes: 0, n: 0 }])).toBeUndefined();
  });
});

describe('报告展示（论文 A1）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'liri-a1-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  /** 建一轮：`successes[i]` = 第 i 个任务的成功次数（每任务跑 `k` 次） */
  const summaryOf = (k: number, successes: number[]) =>
    summarizeRun({
      startedAt: 't0',
      finishedAt: 't1',
      model: 'm',
      k,
      tasks: successes.map((c, i) =>
        summarizeTask(mkTask(`t${i}`), attempts(c, k))
      ),
    });

  it('k≥2 ⇒ 报告出「可靠性曲线」段；k=1 ⇒ **不出该段**（旧输出不变）', () => {
    const many = writeReport(summaryOf(4, [3, 4]), dir);
    expect(readFileSync(many.mdPath, 'utf-8')).toContain('## 可靠性曲线');

    const single = writeReport(summaryOf(1, [1]), dir);
    const singleMd = readFileSync(single.mdPath, 'utf-8');
    expect(singleMd).not.toContain('## 可靠性曲线');
    // k=1 ⇒ 曲线仅 1 点（字段仍在，但报告与 CLI 都不展示）
    const singleJson = JSON.parse(readFileSync(single.jsonPath, 'utf-8')) as {
      reliabilityCurve?: unknown[];
    };
    expect(singleJson.reliabilityCurve?.length).toBe(1);
  });

  it('任务存在但**零 attempt** ⇒ 曲线 `undefined` ⇒ JSON **不含**该键（字段缺省）', () => {
    const s = summarizeRun({
      startedAt: 't0',
      finishedAt: 't1',
      model: 'm',
      k: 1,
      tasks: [summarizeTask(mkTask('t0'), [])],
    });

    const empty = writeReport(s, dir);
    const json = JSON.parse(readFileSync(empty.jsonPath, 'utf-8')) as Record<
      string,
      unknown
    >;

    expect(Object.prototype.hasOwnProperty.call(json, 'reliabilityCurve')).toBe(
      false
    );
  });

  it('旧指标逐字不变：pass1 / passK / passKRate / pass1Mean 语义未动', () => {
    const s = summaryOf(4, [3]);

    expect(s.tasks[0].pass1).toBeCloseTo(0.75, 10);
    expect(s.tasks[0].passK).toBe(false);
    expect(s.passKRate).toBe(0);
    expect(s.pass1Mean).toBeCloseTo(0.75, 10);
  });
});
