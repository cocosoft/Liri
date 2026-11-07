/**
 * 2026-11-07：工具执行**不得复用结果缓存**
 *
 * 背景（真机复现）：`ToolManager.executeTool`（HTTP/CoreAPI 路径）此前经
 * `utils/OptimizedToolManagerUtils.optimizedExecuteTool` 以 `tool.name:JSON.stringify(input)`
 * 缓存 5 分钟 —— 且有副作用的工具（bash / file_write / code_run…）同样命中缓存：
 * 同一 `ver` 第二次 4ms 返回、`bash:` 日志一条没有 ⇒ **命令根本没执行**。
 *
 * 本文件锁定修复后的语义：
 *  ① 同一工具 + 同一入参连续两次 ⇒ 工具被调用两次（副作用工具必须真跑）；
 *  ② 工具抛错 ⇒ 收敛为 `{ error, toolName }`，且下次调用仍会执行（失败结果也不缓存）。
 */
import { describe, test, expect } from 'bun:test';
import { ToolManager } from '../../src/tools/ToolManager';
import { ToolRegistry } from '../../src/tools/ToolRegistry';
import type { Tool } from '../../src/tools/types/Tool';

const TOOL_NAME = 'no_cache_probe';

const PARAMS = [
  {
    name: 'command',
    type: 'string',
    description: '探针命令（内容不参与判定，只为满足必填参数校验）',
    required: true,
  },
];

interface ProbeState {
  calls: number;
  fail?: boolean;
}

function createProbeTool(state: ProbeState): Tool {
  return {
    name: TOOL_NAME,
    description: '结果缓存回归探针',
    params: PARAMS,
    execute: async () => {
      state.calls += 1;
      if (state.fail) throw new Error('probe boom');
      return { success: true, data: { seq: state.calls } };
    },
    getInfo: () => ({
      name: TOOL_NAME,
      description: '结果缓存回归探针',
      params: PARAMS,
    }),
  } as unknown as Tool;
}

function createManager(state: ProbeState): ToolManager {
  const manager = new ToolManager({
    loadBuiltinTools: false,
    registry: new ToolRegistry(),
  });
  manager.registerTool(createProbeTool(state));
  return manager;
}

describe('工具执行：不缓存结果（2026-11-07 修复）', () => {
  test('同一工具 + 同一入参连续两次 ⇒ 执行两次，且各自返回新结果', async () => {
    const state: ProbeState = { calls: 0 };
    const manager = createManager(state);
    const args = { command: 'ver' };

    const first = (await manager.executeTool(TOOL_NAME, args, {})) as {
      data?: { seq?: number };
    };
    const second = (await manager.executeTool(TOOL_NAME, args, {})) as {
      data?: { seq?: number };
    };

    expect(state.calls).toBe(2);
    expect(first.data).toEqual({ seq: 1 });
    expect(second.data).toEqual({ seq: 2 });
  });

  test('工具抛错 ⇒ 收敛为 { error, toolName }，且下次仍执行（失败不缓存）', async () => {
    const state: ProbeState = { calls: 0, fail: true };
    const manager = createManager(state);
    const args = { command: 'boom' };

    const first = (await manager.executeTool(TOOL_NAME, args, {})) as {
      error?: string;
      toolName?: string;
    };
    expect(first.toolName).toBe(TOOL_NAME);
    expect(String(first.error)).toContain('probe boom');

    state.fail = false;
    const second = (await manager.executeTool(TOOL_NAME, args, {})) as {
      data?: { seq?: number };
    };
    expect(state.calls).toBe(2);
    expect(second.data).toEqual({ seq: 2 });
  });
});
