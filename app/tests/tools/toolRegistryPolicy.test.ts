/**
 * A2-a：ToolRegistry.executeTool 的策略收口集成测试。
 *
 * 覆盖：
 * ① guest 上下文 ⇒ 有副作用工具在**执行前**被拒绝，`tool.execute` 不被调用；
 * ② owner 上下文 ⇒ 正常执行（默认行为零变化）；
 * ③ 拒绝结果走 `newMessages` 系统消息（与 Tool not found 同形）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { ToolRegistry } from '../../src/tools/ToolRegistry.js';
import { resetDefaultToolPolicyPipelineForTest } from '../../src/tools/policy/defaultPipeline.js';
import { getEmptyToolUseContext } from '../../src/tools/types/ToolUseContext.js';
import type { ToolUseContext } from '../../src/tools/types/ToolUseContext.js';
import type { Tool } from '../../src/tools/types/Tool.js';
import { createToolResult } from '../../src/tools/types/ToolResult.js';

let executed: string[] = [];

function fakeTool(name: string): Tool {
  return {
    name,
    execute: async () => {
      executed.push(name);
      return createToolResult('ok');
    },
  } as unknown as Tool;
}

function ctxWith(
  policyContext?: NonNullable<ToolUseContext['policyContext']>
): ToolUseContext {
  return {
    ...getEmptyToolUseContext(),
    ...(policyContext ? { policyContext } : {}),
  } as ToolUseContext;
}

beforeEach(() => {
  executed = [];
  resetDefaultToolPolicyPipelineForTest();
});

afterEach(() => {
  resetDefaultToolPolicyPipelineForTest();
});

describe('A2-a ToolRegistry 策略收口', () => {
  it('guest：bash 在执行前被拒绝', async () => {
    const registry = new ToolRegistry();
    registry.registerTool(fakeTool('bash'));

    const result = await registry.executeTool(
      { toolName: 'bash', input: {} },
      ctxWith({ userRole: 'guest' })
    );

    expect(executed).toEqual([]);
    const content = String(
      (result.newMessages as Array<{ content?: string }> | undefined)?.[0]
        ?.content
    );
    expect(content).toContain('not allowed by policy');
    expect(content).toContain('GuestReadOnlyPolicy');
  });

  it('guest：只读工具 file_read 正常执行', async () => {
    const registry = new ToolRegistry();
    registry.registerTool(fakeTool('file_read'));

    const result = await registry.executeTool(
      { toolName: 'file_read', input: {} },
      ctxWith({ userRole: 'guest' })
    );

    expect(executed).toEqual(['file_read']);
    expect(result.data).toBe('ok');
  });

  it('owner / 未显式提供上下文：行为不变', async () => {
    const registry = new ToolRegistry();
    registry.registerTool(fakeTool('bash'));

    const result = await registry.executeTool(
      { toolName: 'bash', input: {} },
      ctxWith()
    );

    expect(executed).toEqual(['bash']);
    expect(result.data).toBe('ok');
  });
});
