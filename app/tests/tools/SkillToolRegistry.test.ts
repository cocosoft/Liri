// MIT License
// Copyright (c) 2026 190615273@qq.com
// T9' skills_list/skill_view 注册回归测试（2026-08-30）
// 根因：SkillListTool/SkillViewTool 此前仅存在于 getAllBaseTools() 工具池路径，
// 未注册进 ToolManager loaders → ToolRegistry 无此工具 → tool_search 搜不到 →
// 模型按 <available_skills> 引导反复搜索 → 工具死循环（turnCount 249）。
// 本测试验证 getBuiltinToolLoaders 注册后，ToolRegistry 可查到 skills_list/skill_view。

import { describe, expect, it, afterEach } from 'bun:test';
import { ToolFactory } from '../../src/tools/ToolFactory';
import { createToolRegistry, setToolRegistry } from '../../src/tools/ToolRegistry';
import { getBuiltinToolLoaders } from '../../src/tools/utils/ToolManagerUtils';

/** ToolSearchTool.execute 内部用全局 getToolRegistry()，测试需显式设置并在用例间复位 */
function setupRegistry() {
  const registry = createToolRegistry();
  setToolRegistry(registry);
  const factory = new ToolFactory();
  for (const loader of getBuiltinToolLoaders()) {
    const tool = loader(factory);
    if (tool) registry.registerTool(tool);
  }
  return registry;
}

afterEach(() => {
  setToolRegistry(createToolRegistry());
});

describe('T9\' skills_list/skill_view 注册（循环根因修复回归）', () => {
  it('getBuiltinToolLoaders 注册后 ToolRegistry 包含 skills_list/skill_view', () => {
    const registry = setupRegistry();

    expect(registry.getTool('skills_list')).toBeDefined();
    expect(registry.getTool('skill_view')).toBeDefined();
    // 与 SkillTool 并列存在（SKILL_TOOL_NAME = 'Skill'）
    expect(registry.getTool('Skill')).toBeDefined();
  });

  it('tool_search select:skills_list 可命中（模拟死循环场景）', () => {
    const registry = setupRegistry();

    const allTools = Array.from(registry.getTools().values());
    const skillsList = allTools.find((t) => t.name === 'skills_list');
    const skillView = allTools.find((t) => t.name === 'skill_view');
    expect(skillsList).toBeDefined();
    expect(skillView).toBeDefined();
    // 非延迟工具（deferred=false），走工具池常规路径
    expect(skillsList!.getInfo().deferred).toBe(false);
    expect(skillView!.getInfo().deferred).toBe(false);
  });

  it('tool_search execute: select:skills_list 命中；select:不存在工具给出候选提示（A 项）', async () => {
    const registry = setupRegistry();

    const searchTool = registry.getTool('tool_search')!;
    const context = {} as Parameters<typeof searchTool.execute>[1];
    const onProgress = undefined;

    // 命中：select:skills_list
    const hit = await searchTool.execute(
      { query: 'select:skills_list', max_results: 5 },
      context,
      onProgress
    );
    const hitData = hit.data as { matches: string[]; query: string };
    expect(hitData.matches).toContain('skills_list');

    // 未命中：select:no_such_tool_xyz → 空 matches + 候选提示
    const miss = await searchTool.execute(
      { query: 'select:no_such_tool_xyz', max_results: 5 },
      context,
      onProgress
    );
    const missData = miss.data as { matches: string[]; query: string };
    expect(missData.matches).toEqual([]);
    const missJson = JSON.stringify(miss);
    expect(missJson).toContain('可用工具示例');
  });
});
