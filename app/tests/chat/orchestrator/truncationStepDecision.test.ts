/**
 * P2-1d-3 —— S6「截断 / 降级」**纯决策**契约测试（2026-10-10）。
 *
 * 依据：`.trae/specs/stream-message-flow-split.md` §3-S6 / §5；实现见
 * `src/chat/orchestrator/streamMessageTruncationStep.ts`。
 *
 * 锁定「决策」的**四态**与**降级预算公式**（动作 —— 写事件 / yield / `continue` —— 不在本层，
 * 故本测试只断言判据，不断言控制流）。
 */
import { describe, expect, it } from 'bun:test';

import {
  decideTruncationStep,
  DEGRADE_BUDGET_FLOOR,
} from '../../../src/chat/orchestrator/streamMessageTruncationStep.js';

const base = {
  hasContent: false,
  degradeTried: false,
  currentMaxTokens: 32000,
};

describe('P2-1d-3 S6 截断/降级 · 纯决策', () => {
  it('非截断结束（含 `undefined`）⇒ `stop`（不重试）', () => {
    expect(decideTruncationStep({ ...base, stopReason: 'stop' })).toEqual({
      kind: 'stop',
    });
    expect(decideTruncationStep({ ...base, stopReason: undefined })).toEqual({
      kind: 'stop',
    });
  });

  it('有正文 ⇒ `grow`（加大预算续写；与是否降级过无关）', () => {
    expect(
      decideTruncationStep({
        ...base,
        stopReason: 'max_tokens',
        hasContent: true,
      })
    ).toEqual({ kind: 'grow' });
    expect(
      decideTruncationStep({
        ...base,
        stopReason: 'max_tokens',
        hasContent: true,
        degradeTried: true,
      })
    ).toEqual({ kind: 'grow' });
  });

  it('无正文且**未**降级 ⇒ `degrade`，预算 = 上一轮的一半', () => {
    expect(decideTruncationStep({ ...base, stopReason: 'max_tokens' })).toEqual(
      { kind: 'degrade', maxTokens: 16000 }
    );
  });

  it('无正文且**已**降级 ⇒ `give-up`（不连环无效重试）', () => {
    expect(
      decideTruncationStep({
        ...base,
        stopReason: 'max_tokens',
        degradeTried: true,
      })
    ).toEqual({ kind: 'give-up' });
  });

  it('降级预算有**下限**（`DEGRADE_BUDGET_FLOOR`）：小预算不会被折成 0', () => {
    const step = decideTruncationStep({
      ...base,
      stopReason: 'max_tokens',
      currentMaxTokens: 400,
    });
    expect(step).toEqual({
      kind: 'degrade',
      maxTokens: DEGRADE_BUDGET_FLOOR,
    });
  });
});
