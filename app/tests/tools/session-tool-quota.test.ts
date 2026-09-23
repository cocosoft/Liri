/**
 * 会话级工具调用通用配额测试（8.4①，2026-09-16）
 *
 * 覆盖：
 *  1. SessionToolQuota 纯逻辑（计数/超限/接近上限/重置）
 *  2. DefaultToolExecutor.executeTool 超限降级（返回可读提示而非抛错）
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import {
  SessionToolQuota,
  sessionToolQuota,
} from '@modules/tools/sessionToolQuota';
import { DefaultToolExecutor } from '@modules/ai/interfaces/ToolExecutor';
import type { ToolContext } from '@modules/tools/types';

/** 简单 fake 工具：记录调用次数 */
function makeFakeTool(name = 'fake_tool') {
  const state = { calls: 0 };
  return {
    name,
    description: 'fake tool',
    inputSchema: {},
    state,
    execute: async (_input: unknown, _context: ToolContext) => {
      state.calls += 1;
      return {
        result: { calls: state.calls },
        content: `ok-${state.calls}`,
        error: undefined,
        success: true,
      };
    },
  };
}

describe('SessionToolQuota 纯逻辑', () => {
  const quota = new SessionToolQuota(3);

  beforeEach(() => {
    quota.reset('sess-1');
  });

  test('初始为 0 且未超限', () => {
    expect(quota.current('sess-1')).toBe(0);
    expect(quota.isExceeded('sess-1')).toBe(false);
    expect(quota.isNearLimit('sess-1')).toBe(false);
  });

  test('consume 递增计数', () => {
    expect(quota.consume('sess-1')).toBe(1);
    expect(quota.consume('sess-1')).toBe(2);
    expect(quota.current('sess-1')).toBe(2);
  });

  test('达到上限后 isExceeded 为 true（hard limit）', () => {
    quota.consume('sess-1');
    quota.consume('sess-1');
    expect(quota.isExceeded('sess-1')).toBe(false);
    quota.consume('sess-1'); // 第 3 次
    expect(quota.isExceeded('sess-1')).toBe(true);
    expect(quota.max).toBe(3);
  });

  test('isNearLimit：≥80% 上限为接近', () => {
    quota.consume('sess-1'); // 1/3 ≈ 33%
    expect(quota.isNearLimit('sess-1')).toBe(false);
    quota.consume('sess-1'); // 2/3 ≈ 67%
    expect(quota.isNearLimit('sess-1')).toBe(false);
    quota.consume('sess-1'); // 3/3 = 100%
    expect(quota.isNearLimit('sess-1')).toBe(true);
  });

  test('reset 清除计数', () => {
    quota.consume('sess-1');
    quota.reset('sess-1');
    expect(quota.current('sess-1')).toBe(0);
  });

  test('不同会话相互隔离', () => {
    quota.consume('sess-a');
    expect(quota.current('sess-b')).toBe(0);
    expect(quota.isExceeded('sess-b')).toBe(false);
  });
});

describe('DefaultToolExecutor 会话配额降级', () => {
  beforeEach(() => {
    sessionToolQuota.reset('quota-sess');
  });

  test('未超限时正常执行并计数', async () => {
    const tool = makeFakeTool();
    const executor = new DefaultToolExecutor({
      registry: {
        getTool: () => tool,
        getAllTools: () => [tool],
        registerTool: () => {},
        unregisterTool: () => true,
      },
    });
    const result = await executor.executeTool(
      { name: 'fake_tool', input: {}, id: 't1' },
      { sessionId: 'quota-sess' }
    );
    expect(result.success).toBe(true);
    expect(sessionToolQuota.current('quota-sess')).toBe(1);
  });

  test('超限时返回降级提示而非抛错', async () => {
    const tool = makeFakeTool();
    const executor = new DefaultToolExecutor({
      registry: {
        getTool: () => tool,
        getAllTools: () => [tool],
        registerTool: () => {},
        unregisterTool: () => true,
      },
    });
    // 打满全局单例配额（默认 150）
    while (!sessionToolQuota.isExceeded('quota-sess')) {
      sessionToolQuota.consume('quota-sess');
    }
    const beforeCalls = tool.state.calls;
    const result = await executor.executeTool(
      { name: 'fake_tool', input: {}, id: 't2' },
      { sessionId: 'quota-sess' }
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('session tool quota exceeded');
    expect(result.content).toContain('配额已耗尽');
    // 工具本体未被调用（计数在工具执行前拦截）
    expect(tool.state.calls).toBe(beforeCalls);
  });

  test('无 sessionId 时不做配额拦截', async () => {
    const tool = makeFakeTool();
    const executor = new DefaultToolExecutor({
      registry: {
        getTool: () => tool,
        getAllTools: () => [tool],
        registerTool: () => {},
        unregisterTool: () => true,
      },
    });
    const result = await executor.executeTool(
      { name: 'fake_tool', input: {}, id: 't3' },
      {}
    );
    expect(result.success).toBe(true);
  });
});
