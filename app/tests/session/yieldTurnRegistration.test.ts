/**
 * registerYieldFromResults 测试（阶段 A / N-28 修复）
 *
 * 背景：yield 登记此前只在 stream 路径（`ReActToolLoop.act()`）内有内联实现，
 * batch 路径（`TAORLoop.act()`）缺失 ⇒ 抽为共用函数后两条路径一致。
 * 本测试锁定该共用函数的判定与登记语义（不依赖模型行为）。
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  getYieldRegistry,
  resetYieldRegistry,
  registerYieldFromResults,
  setActiveSubagentRunProbe,
  YIELD_TOOL_NAME,
} from '../../src/session/yield';

describe('registerYieldFromResults（两条链路共用的 yield 登记）', () => {
  beforeEach(() => {
    resetYieldRegistry();
  });

  afterEach(() => {
    resetYieldRegistry();
    setActiveSubagentRunProbe(null);
  });

  test('成功 yield ⇒ 登记等待，返回条目（turn 记 0 待收尾点回填）', () => {
    const entry = registerYieldFromResults(
      [
        { toolCallId: 'c1', name: 'bash', status: 'success' },
        { toolCallId: 'c2', name: YIELD_TOOL_NAME, status: 'success' },
      ],
      's1'
    );

    expect(entry).not.toBeNull();
    expect(entry?.toolCallId).toBe('c2');
    expect(entry?.turn).toBe(0);
    expect(getYieldRegistry().isWaiting('s1')).toBe(true);
  });

  test('yield 工具失败 ⇒ 不登记（failure 不算让出）', () => {
    const entry = registerYieldFromResults(
      [{ toolCallId: 'c1', name: YIELD_TOOL_NAME, status: 'error' }],
      's1'
    );
    expect(entry).toBeNull();
    expect(getYieldRegistry().isWaiting('s1')).toBe(false);
  });

  test('本轮无 yield ⇒ 不登记且不影响既有等待', () => {
    // 先登记一个（模拟前一轮已让出）
    const first = registerYieldFromResults(
      [{ toolCallId: 'c0', name: YIELD_TOOL_NAME, status: 'success' }],
      's1'
    );
    expect(first).not.toBeNull();

    // 普通工具轮：不应清除/覆盖既有等待
    const none = registerYieldFromResults(
      [{ toolCallId: 'c1', name: 'bash', status: 'success' }],
      's1'
    );
    expect(none).toBeNull();
    expect(getYieldRegistry().get('s1')?.toolCallId).toBe('c0');
  });
});

describe('registerYieldFromResults：无在途子代理时的登记守卫（B1/O1-3，A10 断链）', () => {
  beforeEach(() => {
    resetYieldRegistry();
  });

  afterEach(() => {
    resetYieldRegistry();
    setActiveSubagentRunProbe(null);
  });

  test('装配探针后：该会话无在途 run ⇒ 拒绝登记（不进入永久 waiting）', () => {
    setActiveSubagentRunProbe(() => false);

    const entry = registerYieldFromResults(
      [{ toolCallId: 'c1', name: YIELD_TOOL_NAME, status: 'success' }],
      's1'
    );

    expect(entry).toBeNull();
    expect(getYieldRegistry().isWaiting('s1')).toBe(false);
  });

  test('装配探针后：该会话有在途 run ⇒ 正常登记（结算通知才有落点）', () => {
    setActiveSubagentRunProbe((sessionId) => sessionId === 's1');

    const entry = registerYieldFromResults(
      [{ toolCallId: 'c1', name: YIELD_TOOL_NAME, status: 'success' }],
      's1'
    );

    expect(entry).not.toBeNull();
    expect(getYieldRegistry().isWaiting('s1')).toBe(true);
  });

  test('探针按会话判定：其他会话有 run 不构成本会话的登记依据', () => {
    setActiveSubagentRunProbe((sessionId) => sessionId === 's2');

    const entry = registerYieldFromResults(
      [{ toolCallId: 'c1', name: YIELD_TOOL_NAME, status: 'success' }],
      's1'
    );

    expect(entry).toBeNull();
    expect(getYieldRegistry().isWaiting('s1')).toBe(false);
  });

  test('探针未装配 ⇒ 沿用既有行为（登记），不因守卫缺失而丢失让出', () => {
    const entry = registerYieldFromResults(
      [{ toolCallId: 'c1', name: YIELD_TOOL_NAME, status: 'success' }],
      's1'
    );
    expect(entry).not.toBeNull();
  });
});
