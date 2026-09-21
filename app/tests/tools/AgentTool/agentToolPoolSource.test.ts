/**
 * AgentTool 子代理工具池的**取数来源**（N-41 / N-42，2026-09-21 真机实证回归）
 *
 * 背景（两条均在真机上以 OTel 实证）：
 * - N-41：`setAgentToolManager` 的**唯一**调用点是 `ToolManager.initialize()`，而运行时
 *   主链路直接经 `getToolRegistry()` 注册/消费工具，**从不调用该 initialize** ⇒ DI getter
 *   恒为 null ⇒ 原实现 `return []` ⇒ 子代理工具池为空（`subAgent.execute` span 实证
 *   `tools.count: 0`），"被授权角色可再委派"（T9）在真机上永不可能发生，且无任何日志。
 * - N-42：工具名必须满足 provider 命名约束（OpenAI 兼容 `^[a-zA-Z0-9_-]+$`）；media 模块
 *   15 个工具名含冒号（`media:image:convert` …）⇒ **整个 tools 数组被上游 400 拒绝**
 *   （实证 `Invalid 'tools[60].function.name'`）。
 *
 * 断言口径：`getInheritableToolPool` 是定义侧与执行侧的**同一入口**
 * （`buildToolDefinitions` 与 `toolInstances` 均取自它）⇒ 直接断言该入口的返回即可。
 */
import { describe, test, expect, afterEach } from 'bun:test';
import {
  AgentTool,
  setAgentToolManager,
  resetAgentToolManager,
} from '../../../src/tools/AgentTool/AgentTool';
import { getToolRegistry } from '../../../src/tools/ToolRegistry';
import type { Tool } from '../../../src/tools/types/Tool';

function fakeTool(name: string): Tool {
  return {
    name,
    getInfo: () => ({ name, description: `${name} tool`, params: [] }),
  } as unknown as Tool;
}

/**
 * 读取私有入口 `getInheritableToolPool` 的工具名（与 `buildToolDefinitions` 同源）。
 * **同步读取**：从 reset/注入 到断言之间不含 `await`，避免与其它文件的全局单例状态交错。
 */
function poolNames(tool: AgentTool, allowDelegation: boolean): string[] {
  const fn = Reflect.get(tool, 'getInheritableToolPool') as (options: {
    allowDelegation?: boolean;
  }) => Tool[];
  return fn.call(tool, { allowDelegation }).map((t) => t.name);
}

const LEGAL_PROBE = 'n41_legal_probe';
const ILLEGAL_PROBE = 'n42:illegal:probe';

describe('AgentTool 工具池取数来源（N-41 / N-42）', () => {
  afterEach(() => {
    getToolRegistry().unregisterTool(LEGAL_PROBE);
    getToolRegistry().unregisterTool(ILLEGAL_PROBE);
    // 恢复既有惯例（其它 AgentTool 测试默认注入空池）
    setAgentToolManager(() => []);
  });

  test('N-41：DI getter 未注入 ⇒ 回退唯一注册表，而非静默空池', () => {
    getToolRegistry().registerTool(fakeTool(LEGAL_PROBE));
    resetAgentToolManager();

    expect(poolNames(new AgentTool(), false)).toContain(LEGAL_PROBE);
  });

  test('N-41：DI getter 已注入 ⇒ 以注入为准（保持既有可控性）', () => {
    getToolRegistry().registerTool(fakeTool(LEGAL_PROBE));
    setAgentToolManager(() => [fakeTool('injected_only')]);

    expect(poolNames(new AgentTool(), false)).toEqual(['injected_only']);
  });

  test('N-42：名称不合法的工具被剔除（否则整个 tools 被上游 400）', () => {
    getToolRegistry().registerTool(fakeTool(LEGAL_PROBE));
    getToolRegistry().registerTool(fakeTool(ILLEGAL_PROBE));
    resetAgentToolManager();

    const names = poolNames(new AgentTool(), false);
    expect(names).toContain(LEGAL_PROBE);
    expect(names).not.toContain(ILLEGAL_PROBE);
  });
});
