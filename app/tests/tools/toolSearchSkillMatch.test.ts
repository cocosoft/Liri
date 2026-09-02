// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * tool_search 技能检索增强测试（2026-09-01）
 *
 * 背景：模型反复用 tool_search 找技能（"zhihu 技能"、"技能列表"）返回空
 * 是死循环放大器——技能是 SkillTool 参数而非独立工具，工具搜索永不命中。
 * 增强：按技能名/描述匹配查询，返回 skill:<name> 引导模型用 Skill 工具执行。
 */
import { describe, it, expect, beforeAll } from 'bun:test';

import { ToolSearchTool } from '../../src/tools/ToolSearchTool/ToolSearchTool';
import { getSkillRegistryLazy } from '../../src/tools/SkillTool/skillRegistryAccess';
import { SkillSource, SkillLoadMethod } from '@modules/skills/types';
import type { Skill } from '@modules/skills/types';

function makePromptSkill(name: string, description: string): Skill {
  return {
    name,
    description,
    source: SkillSource.THIRD_PARTY,
    loadMethod: SkillLoadMethod.FILE_SYSTEM,
    loadedFrom: 'user',
    userInvocable: true,
    disableModelInvocation: false,
    contentLength: 0,
    progressMessage: '',
    impl: {
      kind: 'prompt',
      getPromptForCommand: async () => [
        { type: 'text', text: `prompt-${name}` },
      ],
    },
  };
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe('tool_search 技能检索增强', () => {
  let tool: ToolSearchTool;

  beforeAll(async () => {
    // 触发 skillRegistry 懒加载并等待就绪
    getSkillRegistryLazy();
    await import('@modules/constants/systemPromptSections');
    await flushMicrotasks();
    getSkillRegistryLazy();

    // 注册一个用户技能（模拟 zhihu）
    const { skillRegistry } = await import('@modules/constants/systemPromptSections');
    skillRegistry.register(
      makePromptSkill('zhihu', '使用知乎开放平台搜索知乎和全网内容、获取热榜')
    );

    tool = new ToolSearchTool();
  });

  it('按技能名匹配：tool_search "zhihu" → 返回 skill:zhihu', async () => {
    const result = await tool.execute(
      { query: 'zhihu', max_results: 5 },
      {} as never
    );
    const json = JSON.stringify(result);
    expect(json).toContain('skill:zhihu');
  });

  it('按描述兜底匹配：tool_search "知乎 搜索" → 返回 skill:zhihu', async () => {
    const result = await tool.execute(
      { query: '知乎 搜索', max_results: 5 },
      {} as never
    );
    const json = JSON.stringify(result);
    expect(json).toContain('skill:zhihu');
  });

  it('工具搜索仍正常：无技能匹配时不返回 skill: 条目', async () => {
    const result = await tool.execute(
      { query: 'glob', max_results: 5 },
      {} as never
    );
    const json = JSON.stringify(result);
    expect(json).not.toContain('skill:');
  });
});
