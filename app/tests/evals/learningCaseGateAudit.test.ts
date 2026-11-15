/**
 * 学习语料的真实回归审计（M6，2026-11-15）
 *
 * 钉住四件事：
 * ① **口径单一**：审计与 `checkGate` 共用 `checkTaskAgainstBaseline`（同一份判据、同一份文案）；
 * ② **三态齐全**：通过 / 回归（`passK` / `pass1`）/ 未登记；
 * ③ **范围隔离**：非 `learning-case-*` 的任务即使回归也不计入；
 * ④ **不伪造**：报告里没有学习语料 ⇒ `total = 0`，不产出"0 回归"的假结论。
 */
import { describe, expect, it } from 'bun:test';

import {
  checkTaskAgainstBaseline,
  type BaselineEntry,
} from '@modules/evals/scoring';
import {
  auditLearningCaseGate,
  learningCaseTaskId,
  type GateReportTask,
} from '@modules/evals/tasks/learning-cases';

const PASSING: BaselineEntry = { minPass1: 0.8, requirePassK: true };

function task(over: Partial<GateReportTask> = {}): GateReportTask {
  return {
    id: learningCaseTaskId('a1'),
    pass1: 1,
    passK: true,
    attempts: [{ asExpected: true }, { asExpected: true }],
    ...over,
  };
}

describe('checkTaskAgainstBaseline（唯一判据）', () => {
  it('未登记 ⇒ 单条 unregistered（文案与历史 checkGate 一致）', () => {
    const v = checkTaskAgainstBaseline(
      'learning-case-x',
      { pass1: 1, passK: true, attempts: [] },
      undefined
    );
    expect(v).toEqual([
      {
        kind: 'unregistered',
        message: 'learning-case-x: 基线中未登记该任务（新增任务须先登记基线）',
      },
    ]);
  });

  it('pass^1 低于基线 ⇒ pass1', () => {
    const v = checkTaskAgainstBaseline(
      't',
      { pass1: 0.5, passK: true, attempts: [] },
      { minPass1: 0.8, requirePassK: false }
    );
    expect(v.map((x) => x.kind)).toEqual(['pass1']);
    expect(v[0].message).toContain('pass^1 50% < 基线 80%');
  });

  it('pass^k 未达标 ⇒ passK（带符合期望计数）；两项同时违反时 passK 在前', () => {
    const v = checkTaskAgainstBaseline(
      't',
      {
        pass1: 0.5,
        passK: false,
        attempts: [{ asExpected: true }, { asExpected: false }],
      },
      PASSING
    );
    expect(v.map((x) => x.kind)).toEqual(['passK', 'pass1']);
    expect(v[0].message).toContain('符合期望 1/2');
  });
});

describe('auditLearningCaseGate（语料三态）', () => {
  it('全部通过 ⇒ passed = total，failures 为空', () => {
    const audit = auditLearningCaseGate(
      [task(), task({ id: learningCaseTaskId('b2') })],
      {
        [learningCaseTaskId('a1')]: PASSING,
        [learningCaseTaskId('b2')]: PASSING,
      }
    );
    expect(audit).toEqual({ total: 2, passed: 2, failures: [] });
  });

  it('回归与未登记分别记账（跨题不串味）', () => {
    const audit = auditLearningCaseGate(
      [
        task(),
        task({ id: learningCaseTaskId('reg1'), pass1: 0.2 }),
        task({ id: learningCaseTaskId('new1'), pass1: 0.9 }),
      ],
      {
        [learningCaseTaskId('a1')]: PASSING,
        [learningCaseTaskId('reg1')]: PASSING,
        // new1 故意不登记
      }
    );
    expect(audit.total).toBe(3);
    expect(audit.passed).toBe(1);
    expect(audit.failures.map((f) => `${f.id}:${f.kind}`)).toEqual([
      `${learningCaseTaskId('reg1')}:pass1`,
      `${learningCaseTaskId('new1')}:unregistered`,
    ]);
  });

  it('非 learning-case 任务即使回归也不计入（不冒充全局门禁）', () => {
    const audit = auditLearningCaseGate(
      [task({ id: 'file-create', pass1: 0 }), task()],
      { [learningCaseTaskId('a1')]: PASSING }
    );
    expect(audit.total).toBe(1);
    expect(audit.passed).toBe(1);
    expect(audit.failures).toHaveLength(0);
  });

  it('报告里没有学习语料 ⇒ total = 0（不伪造 0 回归结论）', () => {
    expect(auditLearningCaseGate([], {})).toEqual({
      total: 0,
      passed: 0,
      failures: [],
    });
  });
});
