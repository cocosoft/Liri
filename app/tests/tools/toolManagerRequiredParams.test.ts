/**
 * §41.4 续（2026-10-23）：**HTTP/CoreAPI 路径**的必填参数前置校验
 *
 * 背景：主聊天链（`ToolRegistry.executeTool`）与 PDCA（`stepExecution`）已 fail-closed，
 * 但 `CoreAPIImpl.executeTool` → `ToolManager.executeTool` 此前未校验 ⇒ 缺参仍会进工具内部
 * 裸抛（实测 `file_write`：`path.dirname(undefined)`）。本文件锁定：
 *  ① 缺必填参数 ⇒ 不执行工具，返回 `success:false` + 缺哪个参数 + 本次收到的键；
 *  ② 参数齐全 ⇒ 正常执行（不误伤）。
 */
import { describe, test, expect } from 'bun:test';
import { ToolManager } from '../../src/tools/ToolManager';
import { ToolRegistry } from '../../src/tools/ToolRegistry';
import type { Tool } from '../../src/tools/types/Tool';

const TOOL_NAME = 'required_param_probe';

const PARAMS = [
  {
    name: 'file_path',
    type: 'string',
    description: '目标文件路径',
    required: true,
  },
  {
    name: 'content',
    type: 'string',
    description: '写入内容',
    required: false,
  },
];

function createProbeTool(calls: { count: number }): Tool {
  return {
    name: TOOL_NAME,
    description: '必填参数校验探针',
    params: PARAMS,
    execute: async () => {
      calls.count += 1;
      return { success: true, data: { ok: true } };
    },
    getInfo: () => ({
      name: TOOL_NAME,
      description: '必填参数校验探针',
      params: PARAMS,
    }),
  } as unknown as Tool;
}

function createManager(calls: { count: number }): ToolManager {
  const manager = new ToolManager({
    loadBuiltinTools: false,
    registry: new ToolRegistry(),
  });
  manager.registerTool(createProbeTool(calls));
  return manager;
}

describe('ToolManager.executeTool：HTTP/CoreAPI 路径必填参数校验', () => {
  test('缺必填参数 ⇒ fail-closed，不执行工具，并给出可操作提示', async () => {
    const calls = { count: 0 };
    const manager = createManager(calls);

    const result = (await manager.executeTool(TOOL_NAME, {}, {})) as {
      success?: boolean;
      error?: string;
      newMessages?: Array<{ content: string }>;
    };

    expect(calls.count).toBe(0);
    expect(result.success).toBe(false);
    expect(result.error).toContain('file_path');
    expect(result.newMessages?.[0]?.content).toContain('file_path');
    expect(result.newMessages?.[0]?.content).toContain('（空）');
  });

  test('缺必填参数时提示本次收到的参数键（便于模型自纠）', async () => {
    const calls = { count: 0 };
    const manager = createManager(calls);

    const result = (await manager.executeTool(
      TOOL_NAME,
      { content: 'hello' },
      {}
    )) as { success?: boolean; newMessages?: Array<{ content: string }> };

    expect(calls.count).toBe(0);
    expect(result.success).toBe(false);
    expect(result.newMessages?.[0]?.content).toContain('content');
  });

  test('参数齐全 ⇒ 正常执行（不误伤）', async () => {
    const calls = { count: 0 };
    const manager = createManager(calls);

    const result = (await manager.executeTool(
      TOOL_NAME,
      { file_path: '/tmp/probe.txt', content: 'hello' },
      {}
    )) as { success?: boolean; data?: { ok?: boolean } };

    expect(calls.count).toBe(1);
    expect(result.success).toBe(true);
    expect(result.data?.ok).toBe(true);
  });
});
