/**
 * P2-6 —— **圈复杂度棘轮门禁自证（负向对照）**。
 *
 * 复用纯比较核心（`app/scripts/complexityRatchetCore.ts`）—— **不在测试里跑 ESLint**（保测试快），
 * 断言："持平 ⇒ 通过 / **新增离群 ⇒ 必报** / 缩小 ⇒ 通过并提示下调基线 / 非法基线 ⇒ 报错"。
 */
import { describe, expect, it } from 'bun:test';

import {
  compareComplexity,
  type ComplexityBaseline,
} from '../../scripts/complexityRatchetCore.js';

const BASE: ComplexityBaseline = {
  version: 1,
  threshold: 100,
  countAtThreshold: 7,
};

/** 造 `n` 个离群值（≥ threshold） */
const outliers = (n: number): number[] => Array.from({ length: n }, () => 120);

describe('P2-6 复杂度棘轮 · 负向自证', () => {
  it('持平（≥阈值计数 == 基线）⇒ 无违规', () => {
    const r = compareComplexity([...outliers(7), 50, 30], BASE);
    expect(r.atThreshold).toBe(7);
    expect(r.problems).toEqual([]);
    expect(r.shrink).toBeNull();
  });

  it('**新增离群** ⇒ 报错（棘轮只允许减少）', () => {
    const r = compareComplexity(outliers(8), BASE);
    expect(r.atThreshold).toBe(8);
    expect(r.problems.length).toBe(1);
    expect(r.problems[0]).toContain('增加');
  });

  it('缩小 ⇒ 无违规，但提示**下调基线**锁定成果', () => {
    const r = compareComplexity(outliers(2), BASE);
    expect(r.problems).toEqual([]);
    expect(r.shrink).toContain('下调基线');
  });

  it('非法基线（缺 threshold/countAtThreshold）⇒ 报错（不得静默通过）', () => {
    const r = compareComplexity(outliers(3), {
      version: 1,
    } as ComplexityBaseline);
    expect(r.problems.length).toBe(1);
    expect(r.problems[0]).toContain('非法基线');
  });

  it('`above40` 口径 = 值 ≥40 的计数（与 `state-complexity-audit` 对齐）', () => {
    expect(compareComplexity([39, 40, 41, 100], BASE).above40).toBe(3);
  });
});
