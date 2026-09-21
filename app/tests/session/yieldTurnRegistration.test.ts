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
  YIELD_TOOL_NAME,
} from '../../src/session/yield';

describe('registerYieldFromResults（两条链路共用的 yield 登记）', () => {
  beforeEach(() => {
    resetYieldRegistry();
  });

  afterEach(() => {
    resetYieldRegistry();
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
