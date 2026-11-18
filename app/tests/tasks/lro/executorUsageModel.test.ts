/**
 * ExecutorFn 金额记账（2026-11-18）：自定义执行器回传 `model` ⇒ 记 USD 台账。
 *
 * 口径：`model` 为非空字符串才用于折算；缺省 / 非字符串 / 空白 ⇒ `undefined`
 * （只记 token，维持既有行为，不臆造金额）。
 */
import { describe, expect, it } from 'bun:test';

import { resolveExecutorUsageModel } from '../../../src/tasks/lro/executorBudgetGuard';

describe('resolveExecutorUsageModel', () => {
  it('回传非空模型名 ⇒ 原样（去首尾空白）', () => {
    expect(
      resolveExecutorUsageModel({ content: 'x', model: ' glm-5.2 ' })
    ).toBe('glm-5.2');
  });

  it('缺省 / 空白 / 非字符串 ⇒ undefined', () => {
    expect(resolveExecutorUsageModel({ content: 'x' })).toBeUndefined();
    expect(
      resolveExecutorUsageModel({ content: 'x', model: '' })
    ).toBeUndefined();
    expect(
      resolveExecutorUsageModel({ content: 'x', model: '   ' })
    ).toBeUndefined();
    expect(
      resolveExecutorUsageModel({ content: 'x', model: 123 })
    ).toBeUndefined();
  });

  it('纯文本结果 / null / 非对象 ⇒ undefined', () => {
    expect(resolveExecutorUsageModel('plain text')).toBeUndefined();
    expect(resolveExecutorUsageModel(null)).toBeUndefined();
    expect(resolveExecutorUsageModel(undefined)).toBeUndefined();
  });
});
