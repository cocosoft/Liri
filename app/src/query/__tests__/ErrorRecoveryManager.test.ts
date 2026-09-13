/**
 * ErrorRecoveryManager 单元测试（C1）
 *
 * 覆盖：
 * - 新增类型分类：invalid_tool_arguments / prompt_too_long
 * - 新增动作：retry_with_correction / retry_higher_output / truncate_head_and_retry
 * - max_output 翻倍单次后降级
 * - 串行化/恢复保留 maxOutputDoubled
 */
import { describe, test, expect } from 'bun:test';
import { createErrorRecoveryManager } from '../ErrorRecoveryManager';

function makeError(message: string): Error {
  return new Error(message);
}

const ctx = { turnCount: 1, tokenUsage: 1000 };

describe('classifyError — C1 新类型', () => {
  test('invalid tool arguments 分类', () => {
    const rm = createErrorRecoveryManager();
    const r = rm.assess(
      makeError('invalid_tool_arguments: failed to parse JSON in arguments'),
      ctx
    );
    expect(r.action).toBe('retry_with_correction');
    expect(r.recovered).toBe(true);
  });

  test('tool argument JSON 解析失败分类', () => {
    const rm = createErrorRecoveryManager();
    const r = rm.assess(
      makeError('invalid_tool_arguments: failed to parse JSON in arguments'),
      ctx
    );
    expect(r.action).toBe('retry_with_correction');
  });

  test('prompt too long 分类', () => {
    const rm = createErrorRecoveryManager();
    const r = rm.assess(makeError('This prompt is too long'), ctx);
    expect(r.action).toBe('truncate_head_and_retry');
    expect(r.recovered).toBe(true);
  });
});

describe('assess — C1 新动作', () => {
  test('max_output 首次翻倍', () => {
    const rm = createErrorRecoveryManager();
    const r1 = rm.assess(makeError('max_output_tokens exceeded'), ctx);
    expect(r1.action).toBe('retry_higher_output');
  });

  test('max_output 翻倍后降级为 retry', () => {
    const rm = createErrorRecoveryManager();
    const r1 = rm.assess(makeError('max_output_tokens exceeded'), ctx);
    expect(r1.action).toBe('retry_higher_output');
    const r2 = rm.assess(makeError('max_output_tokens exceeded again'), ctx);
    expect(r2.action).toBe('retry');
    expect(r2.message).toContain('输出达到上限');
  });

  test('invalid_tool_arguments 重试上限 3 次后 abort', () => {
    const rm = createErrorRecoveryManager();
    for (let i = 0; i < 3; i++) {
      const r = rm.assess(makeError('invalid_tool_arguments'), ctx);
      expect(r.action).toBe('retry_with_correction');
    }
    const r4 = rm.assess(makeError('invalid_tool_arguments'), ctx);
    expect(r4.action).toBe('abort');
    expect(r4.recovered).toBe(false);
  });

  test('prompt_too_long 单次后 abort', () => {
    const rm = createErrorRecoveryManager();
    const r1 = rm.assess(makeError('prompt is too long'), ctx);
    expect(r1.action).toBe('truncate_head_and_retry');
    const r2 = rm.assess(makeError('prompt is too long again'), ctx);
    expect(r2.action).toBe('abort');
  });
});

describe('serialize/restore — maxOutputDoubled 持久化', () => {
  test('恢复后保留翻倍标记', () => {
    const rm = createErrorRecoveryManager();
    rm.assess(makeError('max_output_tokens exceeded'), ctx);
    const state = rm.serialize();
    expect(state.maxOutputDoubled).toBe(true);
    const rm2 = createErrorRecoveryManager();
    rm2.restore(state);
    const r = rm2.assess(makeError('max_output_tokens exceeded'), ctx);
    // 已翻倍 → 直接降级 retry
    expect(r.action).toBe('retry');
  });

  test('resetAll 清除翻倍标记', () => {
    const rm = createErrorRecoveryManager();
    rm.assess(makeError('max_output_tokens exceeded'), ctx);
    rm.resetAll();
    const r = rm.assess(makeError('max_output_tokens exceeded'), ctx);
    expect(r.action).toBe('retry_higher_output');
  });
});
