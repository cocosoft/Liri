/**
 * A5（2026-09-26，《Liri 优化方案》）：**信号基线** —— 回归门禁 ≠ 信号基线。
 *
 * 锁三件事：
 *  ① **零数据可用**：`saturated`（全过 = 无区分度）/ `floored`（全挂）**只依赖本次 run**，
 *     不传信号基线也能发现（这是方案 A5 的headline 收益）；
 *  ② **区间判定**（可选）：登记了 `expectedPassRange` 的题，pass^1 越界要报出；
 *  ③ **k<2 显式提示**：`pass^1 ∈ {0,1}` ⇒ 区分度判定无意义，不得给出"看起来很严重"的假结论；
 *  ④ **与退出码无关**：本函数是纯观测（其调用点（cli）不参与 process.exit）。
 */
import { describe, expect, it } from 'bun:test';
import {
  summarizeSignal,
  type Baseline,
} from '../../src/evals/scoring';
import type {
  EvalRunSummary,
  EvalTask,
  EvalTaskResult,
} from '../../src/evals/types';

function fakeTask(id: string): EvalTask {
  return {
    id,
    name: id,
    level: 'L2',
    assertionPolarity: 'positive',
    prompt: () => `task ${id}`,
    assert: async () => ({ pass: true }),
  };
}

function result(id: string, pass1: number): EvalTaskResult {
  return {
    task: fakeTask(id),
    attempts: [],
    assertPassCount: 0,
    pass1,
    passK: pass1 === 1,
  };
}

function summary(tasks: EvalTaskResult[], k = 2): EvalRunSummary {
  return {
    startedAt: '2026-09-26T00:00:00.000Z',
    finishedAt: '2026-09-26T00:00:00.000Z',
    model: 'fixture-model',
    k,
    tasks,
    passKRate: 0,
    pass1Mean: 0,
    judgeSanityOk: true,
  };
}

describe('A5: 零数据可用 —— 仅凭本次 run 识别"无信号 / 全挂"', () => {
  it('不传信号基线也能报出全过与全挂，且有区分度的题不进关注项', () => {
    const s = summarizeSignal(
      summary([result('t-pass', 1), result('t-fail', 0), result('t-mid', 0.5)])
    );

    expect(s.saturated).toBe(1);
    expect(s.floored).toBe(1);
    expect(s.findings.map((f) => f.taskId).sort()).toEqual(['t-fail', 't-pass']);
    expect(s.findings.find((f) => f.taskId === 't-pass')?.label).toBe(
      'saturated'
    );
    expect(s.findings.find((f) => f.taskId === 't-fail')?.label).toBe('floored');
    // 未登记区间 ⇒ 不可能判越界
    expect(s.findings.every((f) => f.outOfRange === false)).toBe(true);
  });

  it('全部题有区分度 ⇒ 关注项为空', () => {
    const s = summarizeSignal(summary([result('a', 0.25), result('b', 0.75)]));
    expect(s.findings).toEqual([]);
  });

  it('空基线（tasks: {}）不影响全过/全挂判定', () => {
    const empty: Baseline = { requireJudgeSanity: true, tasks: {} };
    const s = summarizeSignal(summary([result('t-pass', 1)]), empty);
    expect(s.findings).toHaveLength(1);
    expect(s.findings[0].label).toBe('saturated');
  });
});

describe('A5: 区间判定（expectedPassRange 可选）', () => {
  const baseline: Baseline = {
    requireJudgeSanity: true,
    tasks: {
      't-mid': {
        requirePassK: false,
        minPass1: 0,
        expectedPassRange: [0.3, 0.8],
      },
    },
  };

  it('pass^1 在区间内 ⇒ 不报', () => {
    const s = summarizeSignal(summary([result('t-mid', 0.5)]), baseline);
    expect(s.findings).toEqual([]);
  });

  it('pass^1 高于上界 ⇒ outOfRange + 明细含区间', () => {
    const s = summarizeSignal(summary([result('t-mid', 0.9)]), baseline);
    expect(s.findings).toHaveLength(1);
    expect(s.findings[0].outOfRange).toBe(true);
    expect(s.findings[0].expectedPassRange).toEqual([0.3, 0.8]);
    expect(s.findings[0].detail).toContain('之外');
  });

  it('pass^1 低于下界 ⇒ outOfRange', () => {
    const s = summarizeSignal(summary([result('t-mid', 0.1)]), baseline);
    expect(s.findings[0].outOfRange).toBe(true);
  });

  it('未在信号基线登记的题 ⇒ 无区间可判（outOfRange 恒 false）', () => {
    const s = summarizeSignal(summary([result('t-unknown', 0.9)]), baseline);
    expect(s.findings).toEqual([]);
  });
});

describe('A5: k<2 时区分度判定无意义（显式提示而非假结论）', () => {
  it('k=1 且全过 ⇒ kTooSmall=true（调用方应提示"请用 --k=4 采信号"）', () => {
    const s = summarizeSignal(summary([result('a', 1)], 1));
    expect(s.kTooSmall).toBe(true);
    expect(s.saturated).toBe(1);
  });

  it('k>=2 ⇒ kTooSmall=false', () => {
    expect(summarizeSignal(summary([result('a', 0.5)], 2)).kTooSmall).toBe(
      false
    );
  });
});
