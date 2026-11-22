// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * F14（2026-11-22）：禁用工具必须在**共同执行入口**（ToolRegistry）fail-closed。
 *
 * 背景（二次复查）：禁用状态只在 `ToolManager` 私有集合里 ⇒ 主聊天链（Registry）
 * 可直接执行已禁用工具；且别名调用用入参名判断 ⇒ 绕过。现状态收口到 Registry 并按真名。
 */

import { describe, expect, it } from 'bun:test';

import { ToolRegistry } from '../../src/tools/ToolRegistry';
import type { Tool } from '../../src/tools/types/Tool';
import type { ToolUseContext } from '../../src/tools/types/ToolUseContext';

function makeTool(executed: { value: boolean }): Tool {
  return {
    name: 'demo_tool',
    description: 'demo',
    params: [],
    aliases: ['demo_alias'],
    isEnabled: () => true,
    isReadOnly: () => true,
    isConcurrencySafe: () => true,
    async execute() {
      executed.value = true;
      return { success: true, data: 'ok' };
    },
  } as unknown as Tool;
}

const context = {
  sessionId: 's-f14',
  abortController: new AbortController(),
} as unknown as ToolUseContext;

describe('F14：Registry 禁用工具', () => {
  it('禁用后执行 ⇒ 失败且不调用工具', async () => {
    const registry = new ToolRegistry();
    const executed = { value: false };
    registry.registerTool(makeTool(executed));
    registry.disableTool('demo_tool');

    const result = await registry.executeTool(
      { toolName: 'demo_tool', input: {} },
      context
    );

    expect(executed.value).toBe(false);
    expect(result.success).toBe(false);
    expect(result.metadata?.reason).toBe('tool_disabled');
  });

  it('别名调用同样命中禁用', async () => {
    const registry = new ToolRegistry();
    const executed = { value: false };
    registry.registerTool(makeTool(executed));
    registry.disableTool('demo_tool');

    const result = await registry.executeTool(
      { toolName: 'demo_alias', input: {} },
      context
    );

    expect(executed.value).toBe(false);
    expect(result.metadata?.reason).toBe('tool_disabled');
  });

  it('重新启用后可执行', async () => {
    const registry = new ToolRegistry();
    const executed = { value: false };
    registry.registerTool(makeTool(executed));
    registry.disableTool('demo_tool');
    registry.enableTool('demo_alias');

    const result = await registry.executeTool(
      { toolName: 'demo_tool', input: {} },
      context
    );

    expect(executed.value).toBe(true);
    expect(result.success).toBe(true);
  });

  it('工具自报 isEnabled=false ⇒ 拒绝（F19）', async () => {
    const registry = new ToolRegistry();
    const executed = { value: false };
    const tool = { ...makeTool(executed), isEnabled: () => false } as Tool;
    registry.registerTool(tool);

    const result = await registry.executeTool(
      { toolName: 'demo_tool', input: {} },
      context
    );

    expect(executed.value).toBe(false);
    expect(result.metadata?.reason).toBe('tool_disabled');
  });
});
