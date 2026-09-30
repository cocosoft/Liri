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
 * SkillProvider 统一技能来源契约测试（W2）
 * 验证：4 种来源加载器均实现 SkillProvider 契约；聚合工具顺序语义正确
 */

import { describe, expect, it } from 'bun:test';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  BundledSkillLoader,
  FileSkillLoader,
  MCPSkillLoader,
  PluginSkillLoader,
  SkillProvider,
  SkillCandidate,
  PROVIDER_RANK,
  toCandidates,
  collectSkillsFromProviders,
} from '@modules/skills';
import { SkillSource, SkillLoadMethod } from '@modules/skills/types';
import type { Skill } from '@modules/skills/types';
// D-44 守卫：判据 = 生成物（与 tests/tools/toolNameLists.test.ts 同一事实源）
import { TOOL_NAMES } from '../../src/tools/toolNames.generated';

/** 构造一个最小可测 Skill */
function makeSkill(name: string, source: SkillSource): Skill {
  return {
    name,
    description: `desc-${name}`,
    source,
    loadMethod: SkillLoadMethod.EMBEDDED,
    loadedFrom: 'test',
    impl: {
      kind: 'prompt',
      getPromptForCommand: async () => [
        { type: 'text', text: `prompt-${name}` },
      ],
    },
  };
}

describe('SkillProvider 契约（W2）', () => {
  it('BundledSkillLoader 实现 list/get/invalidate 契约', async () => {
    const loader = new BundledSkillLoader();
    expect(loader.name).toBe('bundled');

    const candidates = await loader.list();
    expect(candidates.length).toBeGreaterThan(0);
    const first = candidates[0]!;
    expect(first.rank).toBe(PROVIDER_RANK.BUILTIN);
    expect(first.source).toBe(SkillSource.BUILTIN);
    expect(first.locator).toBeDefined();

    // get() 还原完整技能
    const skill = await loader.get(first);
    expect(skill?.name).toBe(first.name);
    expect(skill?.impl.kind).toBe('prompt');

    // invalidate() 不抛错（无缓存预留）
    expect(() => loader.invalidate()).not.toThrow();
  });

  it('FileSkillLoader 空目录返回空候选', async () => {
    const loader = new FileSkillLoader({
      directories: [join(tmpdir(), 'pyapp-skill-provider-nonexist')],
      source: SkillSource.THIRD_PARTY,
      loadedFrom: 'user',
    });
    expect(loader.name).toBe('file:user');
    const candidates = await loader.list();
    expect(candidates).toEqual([]);
  });

  it('MCPSkillLoader 与 PluginSkillLoader 暴露契约方法', async () => {
    const mcp = new MCPSkillLoader();
    expect(typeof mcp.list).toBe('function');
    expect(typeof mcp.get).toBe('function');
    expect(typeof mcp.invalidate).toBe('function');
    expect(mcp.name).toBe('mcp');

    const plugin = new PluginSkillLoader();
    expect(typeof plugin.list).toBe('function');
    expect(typeof plugin.get).toBe('function');
    expect(typeof plugin.invalidate).toBe('function');
    expect(plugin.name).toBe('plugin');
  });

  it('toCandidates 桥接 Skill[] → 候选（locator = Skill 本体）', async () => {
    const skill = makeSkill('demo', SkillSource.BUILTIN);
    const candidates = toCandidates([skill], PROVIDER_RANK.BUILTIN);
    expect(candidates).toEqual([
      {
        name: 'demo',
        description: 'desc-demo',
        source: SkillSource.BUILTIN,
        rank: PROVIDER_RANK.BUILTIN,
        locator: skill,
      },
    ]);
  });

  it('collectSkillsFromProviders 按 Provider 顺序合并，同名后者覆盖', async () => {
    const builtinSkill = makeSkill('dup', SkillSource.BUILTIN);
    const userSkill = makeSkill('dup', SkillSource.THIRD_PARTY);

    const providers: SkillProvider[] = [
      {
        name: 'builtin',
        list: async () => toCandidates([builtinSkill], PROVIDER_RANK.BUILTIN),
        get: (c) => Promise.resolve(c.locator as Skill),
        invalidate: () => {},
      },
      {
        name: 'user',
        list: async () => toCandidates([userSkill], PROVIDER_RANK.USER),
        get: (c) => Promise.resolve(c.locator as Skill),
        invalidate: () => {},
      },
    ];

    const merged = await collectSkillsFromProviders(providers);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.source).toBe(SkillSource.THIRD_PARTY); // 后者（user）覆盖前者
  });

  it('collectSkillsFromProviders 跳过 get 返回 undefined 的候选', async () => {
    const skill = makeSkill('keep', SkillSource.BUILTIN);
    const providers: SkillProvider[] = [
      {
        name: 'p1',
        list: async () => [
          {
            name: 'gone',
            source: SkillSource.BUILTIN,
            rank: 0,
            locator: null,
          },
          {
            name: 'keep',
            source: SkillSource.BUILTIN,
            rank: 0,
            locator: skill,
          },
        ],
        get: (c) => Promise.resolve(c.locator as Skill | undefined),
        invalidate: () => {},
      },
    ];
    const merged = await collectSkillsFromProviders(providers);
    expect(merged.map((s) => s.name)).toEqual(['keep']);
  });

  it('L1 sortByRank：乱序传入时低 rank 胜出（与传入顺序无关）', async () => {
    const builtinSkill = makeSkill('dup', SkillSource.BUILTIN);
    const userSkill = makeSkill('dup', SkillSource.THIRD_PARTY);
    const provider = (
      name: string,
      rank: number,
      skill: Skill
    ): SkillProvider => ({
      name,
      list: async () => toCandidates([skill], rank),
      get: (c) => Promise.resolve(c.locator as Skill),
      invalidate: () => {},
    });

    // 乱序：user(70) 在前、builtin(90) 在后 → 排序后 low-rank(user) 后处理覆盖
    const merged = await collectSkillsFromProviders(
      [
        provider('user', PROVIDER_RANK.USER, userSkill),
        provider('builtin', PROVIDER_RANK.BUILTIN, builtinSkill),
      ],
      { sortByRank: true }
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]!.source).toBe(SkillSource.THIRD_PARTY); // 低 rank（user）胜出
  });

  it('L1 sortByRank：默认关闭时保持传入顺序（零回归）', async () => {
    const builtinSkill = makeSkill('dup', SkillSource.BUILTIN);
    const userSkill = makeSkill('dup', SkillSource.THIRD_PARTY);
    const provider = (
      name: string,
      rank: number,
      skill: Skill
    ): SkillProvider => ({
      name,
      list: async () => toCandidates([skill], rank),
      get: (c) => Promise.resolve(c.locator as Skill),
      invalidate: () => {},
    });

    // 未开 sortByRank：后传入的 builtin(90) 覆盖前序 user(70)（现状语义）
    const merged = await collectSkillsFromProviders([
      provider('user', PROVIDER_RANK.USER, userSkill),
      provider('builtin', PROVIDER_RANK.BUILTIN, builtinSkill),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]!.source).toBe(SkillSource.BUILTIN);
  });
});

/**
 * 内置技能 `allowedTools` 的**防漂移守卫**（2026-09-29，台账 **D-44**）。
 *
 * **为什么需要**：`allowedTools` 会**显示给用户** —— `commands/builtin/skill/index.ts`（中文
 * "允许的工具: …"）与 `skills/cli/skills.ts`（`Allowed tools: …`）。若写成 CC 名
 * （`Read`/`Write`/`Edit`/`Grep`/`Glob`/`AskUserQuestion`）⇒ 用户会看到**本仓不存在**的工具名
 *（`file_search` 同族漂移：D-32 / D-39）。
 *
 * **判据** = 生成物 `TOOL_NAMES`（与 `tests/tools/toolNameLists.test.ts` **同一事实源**）。
 */
describe('内置技能 allowedTools ⊆ 真实注册名（D-44 防漂移守卫）', () => {
  it('每个内置技能的 allowedTools 都必须落在生成物 TOOL_NAMES 内', async () => {
    const skills = await new BundledSkillLoader().loadSkills();
    const live = new Set<string>(TOOL_NAMES);

    const offenders: Array<{ skill: string; tool: string }> = [];
    for (const s of skills) {
      for (const t of s.allowedTools ?? []) {
        if (!live.has(t)) offenders.push({ skill: s.name, tool: t });
      }
    }
    // 失败时直接打印违规对（而非只报 null/[] ）
    expect({ offenders }).toEqual({ offenders: [] });
  });

  it('正向断言：至少一个内置技能声明了 allowedTools（否则上面会"空集假绿"）', async () => {
    const skills = await new BundledSkillLoader().loadSkills();
    expect(skills.some((s) => (s.allowedTools ?? []).length > 0)).toBe(true);
  });

  it('**防回退**：不得再出现 CC 风格名（Read/Write/Edit/Grep/Glob/AskUserQuestion）', async () => {
    const skills = await new BundledSkillLoader().loadSkills();
    const drifted = [
      'Read',
      'Write',
      'Edit',
      'Grep',
      'Glob',
      'AskUserQuestion',
    ];
    const leftovers = skills.flatMap((s) =>
      (s.allowedTools ?? []).filter((t) => drifted.includes(t))
    );
    expect(leftovers).toEqual([]);
  });
});
