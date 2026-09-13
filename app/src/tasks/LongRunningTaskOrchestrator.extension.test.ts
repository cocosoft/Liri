// 循环引擎 PDCA 优化方案（2026-09-05）：B-任务 max_turns 扩容续跑决策单测（5 场景）
import { describe, expect, test } from 'bun:test';
import {
  planTurnsExtensionDecision,
  shouldReRollMaxTurnsStep,
} from './LongRunningTaskOrchestrator.js';

describe('planTurnsExtensionDecision（max_turns 扩容续跑判定）', () => {
  test('场景1：存在 max_turns 终止步骤且未达上限 → 扩容（乘子×2、计数+1）', () => {
    const d = planTurnsExtensionDecision(
      [{ terminationReason: 'completed' }, { terminationReason: 'max_turns' }],
      0,
      3
    );
    expect(d.apply).toBe(true);
    expect(d.multiplier).toBe(2);
    expect(d.count).toBe(1);
  });

  test('场景2：无 max_turns 步骤（如 loop_detected）→ 不扩容', () => {
    const d = planTurnsExtensionDecision(
      [{ terminationReason: 'loop_detected' }],
      0,
      3
    );
    expect(d.apply).toBe(false);
    expect(d.multiplier).toBe(1);
    expect(d.count).toBe(0);
  });

  test('场景3：已达续跑次数上限 → 不再扩容（超次数转人工）', () => {
    const d = planTurnsExtensionDecision(
      [{ terminationReason: 'max_turns' }],
      3,
      3
    );
    expect(d.apply).toBe(false);
    expect(d.count).toBe(3);
  });
});

describe('shouldReRollMaxTurnsStep（候选步骤置回 pending 谓词）', () => {
  test('场景4：扩容激活 + max_turns → 置回 pending 重跑；loop_detected 拒绝', () => {
    expect(shouldReRollMaxTurnsStep(true, 'max_turns')).toBe(true);
    expect(shouldReRollMaxTurnsStep(true, 'loop_detected')).toBe(false);
    expect(shouldReRollMaxTurnsStep(false, 'max_turns')).toBe(false);
  });
});

describe('终态不复活（门禁语义，resume 前置 refusal 已覆盖）', () => {
  test('场景5：扩容判定对 aborted/completed 步骤不产生候选（不复活）', () => {
    const d = planTurnsExtensionDecision(
      [{ terminationReason: 'aborted' }, { terminationReason: 'completed' }],
      0,
      3
    );
    expect(d.apply).toBe(false);
  });
});
