/**
 * P2-7 —— **模式装配闭环复核断言**（`.trae/specs/pattern-wiring-closure.md` §12 复核）。
 *
 * 背景：外部核验项 M-6（21 模式 A8）。2026-10-10 复核结论：
 * 装配状态为 **2/5 ready**（`competitive_strategy` / `self_verify`）、**3/5 unavailable**
 * （`long_task_pdl` 有意不经装配；`iterative_refine` / `parallel_distributed` **缺触发面**）
 * —— 触发条件**已可操作化**（spec §11，含阈值 + 季度复评），按 **CS03** 维持 **不接线**。
 *
 * 本文件的职责是**把"登记"变成"机器守卫"**：
 * - `unavailable` 的**三段式原因**（承担方 / 装配入口 / 触发面）必须齐备（防措辞退回"无运行时"式误导）；
 * - 状态集合**冻结**——若有人把某模式接为 `ready`（或反向），本测试必须**显式修改**才通过
 *   （= 每个状态变化都对应一次**显式裁定**，防"静默接线 / 静默下线"）。
 */
import { describe, expect, it } from 'bun:test';

import { instantiatePattern } from '../../src/query/patternAssembler.js';

/** 最小选择对象（`instantiatePattern` 只读 `descriptor.assembly.assembler`） */
const selectionFor = (assembler: string): never =>
  ({ descriptor: { assembly: { assembler } } }) as never;

const UNAVAILABLE = [
  'long_task_pdl',
  'iterative_refine',
  'parallel_distributed',
] as const;

describe('P2-7 模式装配闭环 · 复核断言', () => {
  it('已接线且可达 ⇒ `ready`（competitive_strategy / self_verify）', () => {
    expect(
      instantiatePattern(selectionFor('competitive_strategy')).status
    ).toBe('ready');
    expect(instantiatePattern(selectionFor('self_verify')).status).toBe(
      'ready'
    );
  });

  it('`ready` 项必须带执行配方（loopKind / verifyPolicy / budgetPolicy）', () => {
    const r = instantiatePattern(selectionFor('self_verify'));
    expect(r.status).toBe('ready');
    if (r.status === 'ready') {
      expect(r.route).toBe('verify');
      expect(r.recipe.loopKind).toBe('verify');
      expect(r.recipe.verifyPolicy).toBe('blocking');
      expect(r.recipe.budgetPolicy).toBe('strict');
    }
  });

  it('未接线项 ⇒ `unavailable`，且原因须为**三段式**（承担方 / 装配入口 / 触发面）', () => {
    for (const assembler of UNAVAILABLE) {
      const r = instantiatePattern(selectionFor(assembler));
      expect(r.status).toBe('unavailable');
      if (r.status === 'unavailable') {
        expect(r.reason).toContain('承担方');
        expect(r.reason).toContain('装配入口');
        expect(r.reason).toContain('触发面');
      }
    }
  });

  it('【状态冻结】装配状态集合 = 2 ready + 3 unavailable（**改状态必须显式修改本断言**）', () => {
    const actual = ['competitive_strategy', ...UNAVAILABLE, 'self_verify'].map(
      (a) => `${a}:${instantiatePattern(selectionFor(a)).status}`
    );
    expect(actual).toEqual([
      'competitive_strategy:ready',
      'long_task_pdl:unavailable',
      'iterative_refine:unavailable',
      'parallel_distributed:unavailable',
      'self_verify:ready',
    ]);
  });

  it('未接线项**不得**臆造占位 stub：`unavailable` 分支**无** route / recipe', () => {
    for (const assembler of UNAVAILABLE) {
      const r = instantiatePattern(selectionFor(assembler)) as Record<
        string,
        unknown
      >;
      expect(r.route).toBeUndefined();
      expect(r.recipe).toBeUndefined();
    }
  });
});
