// 方案 A（2026-09-05，复查收口）：TAOR stopReason → TerminationReason 纯映射单测
// 关键断言：loop_detected / timeout 显式映射，不再被 default 折叠成 completed
import { describe, expect, test } from 'bun:test';
import { mapTaorStopReasonToTermination } from './TAORLoop.js';

describe('mapTaorStopReasonToTermination（A 档收口）', () => {
  test('loop_detected → loop_detected（不落 completed）', () => {
    expect(mapTaorStopReasonToTermination('loop_detected')).toBe(
      'loop_detected'
    );
  });

  test('timeout → timeout（不落 completed）', () => {
    expect(mapTaorStopReasonToTermination('timeout')).toBe('timeout');
  });

  test('既有值域映射不变', () => {
    expect(mapTaorStopReasonToTermination('max_turns')).toBe('max_turns');
    expect(mapTaorStopReasonToTermination('budget_exhausted')).toBe(
      'budget_exhausted'
    );
    expect(mapTaorStopReasonToTermination('aborted')).toBe('aborted');
    expect(mapTaorStopReasonToTermination('error')).toBe('error');
    expect(mapTaorStopReasonToTermination('verifier_escalate')).toBe(
      'verifier_escalate'
    );
    expect(mapTaorStopReasonToTermination('diminishing_returns')).toBe(
      'diminishing_returns'
    );
  });

  test('空/未知 → completed（仅真完成兜底）', () => {
    expect(mapTaorStopReasonToTermination(undefined)).toBe('completed');
    expect(mapTaorStopReasonToTermination(null)).toBe('completed');
    expect(mapTaorStopReasonToTermination('some_future_reason')).toBe(
      'completed'
    );
  });
});
