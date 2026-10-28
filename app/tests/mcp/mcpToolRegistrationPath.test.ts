/**
 * MCP 工具注册**单一通路**守卫（方案 §8.6-1，P4-3，2026-10-28）
 *
 * 方案的原始判断是「`services/mcp/MCPToolRegistry.ts` 是并行第二套注册表 ⇒ MCP 工具不在主
 * `ToolRegistry` ⇒ `resolveToolParamNames()` 查不到 ⇒ 路径参数不受 PathGuard 保护」。
 *
 * **实测（2026-10-28）**：注册早在 B18-a 起就经**注入端口**转发到 `ToolManager.registerTool`
 * （= 全局 `getToolRegistry()` 单例），`MCPToolRegistry` 只剩"增强层缓存"角色且**读消费者为 0**。
 * 所以"折进主注册表"这件事**已经是既成事实**；真正会退化的是**这条通路本身** —— 一旦有人
 * 把注册改回只写 `mcpToolRegistry`（或换一个新的私有 Map），PathGuard 就会静默失去 MCP 覆盖。
 *
 * 本用例把这条**安全属性**钉死（而不是钉死实现细节）：
 *   ① 未注册 ⇒ `resolveToolParamNames()` 返回 `null`（负向基线，保证下面的断言非恒真）；
 *   ② 经 `ToolManager.registerTool()`（组合根注入的端口实现）注册 ⇒ 主注册表可查 ⇒
 *      路径参数名可解析（PathGuard 覆盖成立）；
 *   ③ 只写 `mcpToolRegistry`（增强层缓存）⇒ **不会**让 PathGuard 看见（证明它不是注册通路）；
 *   ④ 注销 ⇒ 解析结果回到 `null`（覆盖随工具生命周期同步，不留幽灵）。
 */
import { afterEach, describe, expect, it } from 'bun:test';

import { McpToolWrapper } from '../../src/services/mcp/McpToolWrapper';
import { mcpToolRegistry } from '../../src/services/mcp/MCPToolRegistry';
import type { SerializedTool } from '../../src/services/mcp/types';
import { ToolManager } from '../../src/tools/ToolManager';
import {
  getToolRegistry,
  resolveToolParamNames,
} from '../../src/tools/ToolRegistry';

const SERVER = 'alpha';
const MCP_TOOL_NAME = `${SERVER}__write_file`;

function makeWrapper(): McpToolWrapper {
  const data: SerializedTool = {
    name: 'write_file',
    description: 'MCP write tool',
    inputJSONSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'abs path' },
        content: { type: 'string' },
      },
      required: ['file_path'],
    },
  };
  return new McpToolWrapper(SERVER, data, () => undefined);
}

afterEach(() => {
  getToolRegistry().removeTool(MCP_TOOL_NAME);
  mcpToolRegistry.unregisterServer(SERVER);
});

describe('MCP 工具注册通路（PathGuard 覆盖）', () => {
  it('未注册 ⇒ `resolveToolParamNames()` 为 null（负向基线，非恒真）', () => {
    expect(resolveToolParamNames(MCP_TOOL_NAME)).toBeNull();
  });

  it('经 `ToolManager.registerTool()` 注册 ⇒ 主注册表可查，路径参数名可解析', () => {
    const manager = new ToolManager({ loadBuiltinTools: false });
    manager.registerTool(makeWrapper());

    // 主注册表（全局单例）确实拿到了它
    expect(getToolRegistry().getTool(MCP_TOOL_NAME)).toBeDefined();
    // PathGuard 的入参名解析由此成立（`ReActToolLoop` / `TAORLoop` 注入点）
    expect(resolveToolParamNames(MCP_TOOL_NAME)).toEqual([
      'file_path',
      'content',
    ]);
  });

  it('只写 `mcpToolRegistry`（增强层缓存）⇒ PathGuard **看不见**（它不是注册通路）', () => {
    const wrapper = makeWrapper();
    mcpToolRegistry.registerTool(
      SERVER,
      wrapper.name,
      wrapper.description,
      { type: 'object', properties: { file_path: { type: 'string' } } },
      wrapper
    );

    // 缓存里有
    expect(mcpToolRegistry.getTool(SERVER, MCP_TOOL_NAME)?.name).toBe(
      MCP_TOOL_NAME
    );
    // 但主注册表没有 ⇒ 路径参数不受保护
    expect(resolveToolParamNames(MCP_TOOL_NAME)).toBeNull();
  });

  it('注销 ⇒ 解析回到 null（不留幽灵覆盖）', () => {
    const manager = new ToolManager({ loadBuiltinTools: false });
    manager.registerTool(makeWrapper());
    expect(resolveToolParamNames(MCP_TOOL_NAME)).not.toBeNull();

    manager.unregisterTool(MCP_TOOL_NAME);
    expect(resolveToolParamNames(MCP_TOOL_NAME)).toBeNull();
  });

  it('名字形态 `server__tool` ⇒ 归类为 `mcp`（与 `getToolCategory` 判据一致）', () => {
    expect(makeWrapper().name).toBe(MCP_TOOL_NAME);
    expect(makeWrapper().isMcp).toBe(true);
  });
});
