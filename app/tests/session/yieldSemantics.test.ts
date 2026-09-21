/**
 * yield 语义测试（阶段 A / A1-a + A1-b）
 *
 * 覆盖：
 * - `isYieldedTurnEnd`：turn 收尾的 yield 判定（含负例）
 * - `isSuccessfulYieldResult`：成功 yield 结果判定（含"旧假桩结果不再被判成功"的回归护栏）
 * - `getYieldToolCallId`：本轮 yield toolCallId 提取（本轮边界 / 兼容两种 tool_call 形态）
 * - `YieldRegistry`：登记、turn 取代判定、结算收敛、引用相等校验
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import {
  isYieldedTurnEnd,
  isSuccessfulYieldResult,
  getYieldToolCallId,
  YieldRegistry,
  YIELD_STATUS_RESUMED,
} from '../../src/session/yield';

describe('isYieldedTurnEnd（turn 收尾判定）', () => {
  test('yielded 标记 + finishReason=yielded ⇒ true', () => {
    expect(
      isYieldedTurnEnd({ yielded: true, finishReason: 'yielded', turn: 3 })
    ).toBe(true);
  });

  test('finishReason 非 yielded ⇒ false', () => {
    expect(isYieldedTurnEnd({ yielded: true, finishReason: 'stop' })).toBe(
      false
    );
    expect(isYieldedTurnEnd({ yielded: true, finishReason: 'tool_use' })).toBe(
      false
    );
  });

  test('缺 yielded 标记 ⇒ false（普通收尾不算 yield）', () => {
    expect(isYieldedTurnEnd({ finishReason: 'yielded' })).toBe(false);
  });

  test('带 error ⇒ false', () => {
    expect(
      isYieldedTurnEnd({ yielded: true, finishReason: 'yielded', error: 'x' })
    ).toBe(false);
  });

  test('非对象输入 ⇒ false（不抛错）', () => {
    expect(isYieldedTurnEnd(null)).toBe(false);
    expect(isYieldedTurnEnd(undefined)).toBe(false);
    expect(isYieldedTurnEnd('yielded')).toBe(false);
    expect(isYieldedTurnEnd([1, 2])).toBe(false);
  });
});

describe('isSuccessfulYieldResult（工具结果判定）', () => {
  test('顶层 status（buildYieldResult 契约对象形态）⇒ true', () => {
    expect(
      isSuccessfulYieldResult({
        status: 'yielded',
        sessionId: 'sess-1',
        reason: 'r',
        timestamp: 1,
      })
    ).toBe(true);
  });

  test('ToolResult 契约形态（data.status=yielded）⇒ true', () => {
    expect(
      isSuccessfulYieldResult({ success: true, data: { status: 'yielded' } })
    ).toBe(true);
  });

  test('output 为 JSON 字符串（status=yielded）⇒ true', () => {
    expect(
      isSuccessfulYieldResult({ output: JSON.stringify({ status: 'yielded' }) })
    ).toBe(true);
  });

  test('success:false ⇒ false', () => {
    expect(
      isSuccessfulYieldResult({ success: false, data: { status: 'yielded' } })
    ).toBe(false);
  });

  test('error 非空 ⇒ false', () => {
    expect(
      isSuccessfulYieldResult({
        success: true,
        data: { status: 'yielded' },
        error: 'boom',
      })
    ).toBe(false);
  });

  test('status 非 yielded ⇒ false', () => {
    expect(
      isSuccessfulYieldResult({ success: true, data: { status: 'running' } })
    ).toBe(false);
  });

  test('非法 JSON 字符串 ⇒ false（不抛错）', () => {
    expect(isSuccessfulYieldResult('not-json')).toBe(false);
    expect(isSuccessfulYieldResult('{')).toBe(false);
  });

  test('回归护栏：A1-c 之前旧的假桩返回值不再被判为成功', () => {
    // 旧实现返回 { yieldId, fromSessionId, timestamp, reason, statePreserved }
    expect(
      isSuccessfulYieldResult({
        success: true,
        data: {
          yieldId: 'yield_1_ab',
          fromSessionId: 'current',
          timestamp: 1,
          reason: 'Yielding control',
          statePreserved: true,
        },
      })
    ).toBe(false);
  });
});

describe('getYieldToolCallId（本轮 yield toolCallId 提取）', () => {
  test('assistant.tool_calls 命中 sessions_yield ⇒ 返回其 id', () => {
    expect(
      getYieldToolCallId([
        { role: 'user', content: '开始' },
        {
          role: 'assistant',
          tool_calls: [{ id: 'call_y1', name: 'sessions_yield' }],
        },
      ])
    ).toBe('call_y1');
  });

  test('user 消息之后的才算本轮（user 即停）', () => {
    expect(
      getYieldToolCallId([
        {
          role: 'assistant',
          tool_calls: [{ id: 'call_old', name: 'sessions_yield' }],
        },
        { role: 'user', content: '新一轮' },
      ])
    ).toBeNull();
  });

  test('多个 yield tool_call ⇒ 取最后一个', () => {
    expect(
      getYieldToolCallId([
        { role: 'user', content: '开始' },
        {
          role: 'assistant',
          tool_calls: [
            { id: 'call_1', name: 'sessions_yield' },
            { id: 'call_2', name: 'sessions_yield' },
          ],
        },
      ])
    ).toBe('call_2');
  });

  test('兼容 OpenAI 形态 function.name', () => {
    expect(
      getYieldToolCallId([
        { role: 'user', content: '开始' },
        {
          role: 'assistant',
          tool_calls: [{ id: 'call_f1', function: { name: 'sessions_yield' } }],
        },
      ])
    ).toBe('call_f1');
  });

  test('非 yield 工具 / 空输入 ⇒ null', () => {
    expect(
      getYieldToolCallId([
        {
          role: 'assistant',
          tool_calls: [{ id: 'call_x', name: 'bash' }],
        },
      ])
    ).toBeNull();
    expect(getYieldToolCallId([])).toBeNull();
    expect(getYieldToolCallId(null)).toBeNull();
  });
});

describe('YieldRegistry（等待登记与收敛）', () => {
  let registry: YieldRegistry;

  beforeEach(() => {
    registry = new YieldRegistry();
  });

  test('登记后处于等待态', () => {
    const entry = registry.register({
      sessionId: 's1',
      turn: 5,
      toolCallId: 'call_y1',
      yieldedAt: 1000,
    });
    expect(registry.isWaiting('s1')).toBe(true);
    expect(registry.size()).toBe(1);
    expect(registry.get('s1')).toBe(entry);
  });

  test('turn 取代判定：latestTurn 大于登记 turn ⇒ 已取代', () => {
    registry.register({ sessionId: 's1', turn: 5, toolCallId: 'c1' });
    expect(registry.isSuperseded('s1', 5)).toBe(false);
    expect(registry.isSuperseded('s1', 6)).toBe(true);
    expect(registry.isSuperseded('s2', 99)).toBe(false); // 无登记
  });

  test('结算收敛：无活跃 run + 结算不早于登记 + turn 未推进会 ⇒ 可恢复', () => {
    registry.register({
      sessionId: 's1',
      turn: 5,
      toolCallId: 'c1',
      yieldedAt: 1000,
    });
    expect(
      registry.shouldResume({
        sessionId: 's1',
        latestTurn: 5,
        hasActiveRuns: false,
        endedAt: 1000,
      })
    ).toBe(true);
  });

  test('结算收敛负例：仍有活跃 run / 结算早于登记 / turn 已推进', () => {
    registry.register({
      sessionId: 's1',
      turn: 5,
      toolCallId: 'c1',
      yieldedAt: 1000,
    });
    expect(
      registry.shouldResume({
        sessionId: 's1',
        latestTurn: 5,
        hasActiveRuns: true,
        endedAt: 2000,
      })
    ).toBe(false);
    expect(
      registry.shouldResume({
        sessionId: 's1',
        latestTurn: 5,
        hasActiveRuns: false,
        endedAt: 999,
      })
    ).toBe(false);
    expect(
      registry.shouldResume({
        sessionId: 's1',
        latestTurn: 6,
        hasActiveRuns: false,
        endedAt: 2000,
      })
    ).toBe(false);
  });

  test('resolve 后不再是等待态', () => {
    const entry = registry.register({
      sessionId: 's1',
      turn: 1,
      toolCallId: 'c1',
    });
    expect(registry.resolve('s1', YIELD_STATUS_RESUMED, entry)).toBe(true);
    expect(registry.isWaiting('s1')).toBe(false);
    expect(registry.size()).toBe(0);
  });

  test('引用相等校验：等待期间被新 yield 覆盖时，旧条目不得误结新条目', () => {
    const oldEntry = registry.register({
      sessionId: 's1',
      turn: 1,
      toolCallId: 'c_old',
    });
    const newEntry = registry.register({
      sessionId: 's1',
      turn: 2,
      toolCallId: 'c_new',
    });
    // 用旧引用结算 → 被拒；新条目仍在等待
    expect(registry.resolve('s1', YIELD_STATUS_RESUMED, oldEntry)).toBe(false);
    expect(registry.get('s1')).toBe(newEntry);
    // 用新引用结算 → 成功
    expect(registry.resolve('s1', YIELD_STATUS_RESUMED, newEntry)).toBe(true);
  });

  test('updateTurn 回填 turn 后，取代判定按新值生效', () => {
    const entry = registry.register({
      sessionId: 's1',
      turn: 0,
      toolCallId: 'c1',
    });
    // 登记时 turn 未知记 0 ⇒ 任何正数 latestTurn 都被判为已取代
    expect(registry.isSuperseded('s1', 1)).toBe(true);

    expect(registry.updateTurn('s1', 7, entry)).toBe(true);
    expect(registry.get('s1')?.turn).toBe(7);
    expect(registry.isSuperseded('s1', 7)).toBe(false);
    expect(registry.isSuperseded('s1', 8)).toBe(true);
  });

  test('updateTurn 引用不等 ⇒ 拒绝（防覆盖后误改新条目）', () => {
    const oldEntry = registry.register({
      sessionId: 's1',
      turn: 0,
      toolCallId: 'c_old',
    });
    const newEntry = registry.register({
      sessionId: 's1',
      turn: 0,
      toolCallId: 'c_new',
    });
    expect(registry.updateTurn('s1', 9, oldEntry)).toBe(false);
    expect(registry.get('s1')?.turn).toBe(0);
    expect(registry.updateTurn('s1', 9, newEntry)).toBe(true);
    expect(registry.get('s1')?.turn).toBe(9);
  });

  test('abandon 作废登记', () => {
    registry.register({ sessionId: 's1', turn: 1, toolCallId: 'c1' });
    expect(registry.abandon('s1')).toBe(true);
    expect(registry.isWaiting('s1')).toBe(false);
  });

  test('clear 清空全部登记', () => {
    registry.register({ sessionId: 's1', turn: 1, toolCallId: 'c1' });
    registry.register({ sessionId: 's2', turn: 1, toolCallId: 'c2' });
    registry.clear();
    expect(registry.size()).toBe(0);
  });
});
