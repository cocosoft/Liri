/**
 * SessionsYieldTool 真实化测试（阶段 A / A1-c）
 *
 * 覆盖：
 * - 缺会话上下文 ⇒ 显式失败（取代原"成功但无副作用"）
 * - 有会话上下文 ⇒ 契约化结果，且**能被 isSuccessfulYieldResult 识别**（跨模块契约闭环）
 * - `buildYieldResult` 唯一构造点结构稳定
 * - 参数面：无实现的假参数已移除（防回退）
 */
import { describe, test, expect } from 'bun:test';
import {
  SessionsYieldTool,
  buildYieldResult,
} from '../../src/tools/SessionsYieldTool/SessionsYieldTool';
import {
  isSuccessfulYieldResult,
  YIELD_RESULT_STATUS,
  YIELD_TOOL_NAME,
} from '../../src/session/yield';
import type { ToolUseContext } from '../../src/tools/types/Tool';

/** 测试用最小上下文（工具只读 sessionId） */
function ctx(sessionId?: string): ToolUseContext {
  return { sessionId } as unknown as ToolUseContext;
}

describe('SessionsYieldTool（阶段 A 真实化）', () => {
  test('工具名取自契约常量', () => {
    expect(new SessionsYieldTool().name).toBe(YIELD_TOOL_NAME);
  });

  test('缺少会话上下文 ⇒ 显式失败（不再"成功但无副作用"）', async () => {
    const result = await new SessionsYieldTool().execute(
      { reason: '等待子代理' },
      ctx(undefined)
    );
    expect(result.success).toBe(false);
    expect(String(result.error)).toContain('sessionId');
  });

  test('有会话上下文 ⇒ 契约化成功结果，且可被判定函数识别', async () => {
    const result = await new SessionsYieldTool().execute(
      { reason: '等待子代理', message: 'wait' },
      ctx('sess-1')
    );
    expect(result.success).toBe(true);
    // 跨模块契约闭环：工具产出的结果必须能被 session/yield 的判定函数识别
    expect(isSuccessfulYieldResult(result)).toBe(true);

    const data = result.data as {
      status: string;
      sessionId: string;
      message?: string;
    };
    expect(data.status).toBe(YIELD_RESULT_STATUS);
    expect(data.sessionId).toBe('sess-1');
    expect(data.message).toBe('wait');
  });

  test('buildYieldResult 为唯一构造点，结构稳定', () => {
    const built = buildYieldResult({
      sessionId: 's2',
      reason: 'r',
      timestamp: 123,
    });
    expect(built.status).toBe(YIELD_RESULT_STATUS);
    expect(built.sessionId).toBe('s2');
    expect(built.reason).toBe('r');
    expect(built.timestamp).toBe(123);
  });

  test('参数面：无实现的假参数已移除', () => {
    const names = new SessionsYieldTool().params.map((p) => p.name);
    expect(names).toContain('reason');
    expect(names).toContain('message');
    for (const removed of [
      'targetSessionId',
      'preserveState',
      'timeout',
      'resultData',
    ]) {
      expect(names).not.toContain(removed);
    }
  });
});
