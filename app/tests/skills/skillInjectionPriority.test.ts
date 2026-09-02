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
 * A1/A2（2026-09-01）修复验证：技能注入优先级与快照一致性
 *
 * 背景：zhihu 用户技能第 12 位注册（11 内置之后），被 maxActiveSkills=10 截断挤出
 * 注入列表；且快照 mtime 遍历全部技能（含被挤出者）、prompt 仅 active —— 不一致
 * 导致旧快照长期生效，模型看不到用户技能。
 *
 * A1：无溯源记录时用户/第三方技能优先于内置，不被截断挤出。
 * A2：快照 mtime 与 prompt 同源（均基于 active 技能），技能集一致。
 */
import { describe, it, expect } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SkillRegistry } from '../../src/skills/SkillRegistry';
import { SkillInjectionService } from '../../src/skills/services/SkillInjectionService';
import { SkillSource, SkillLoadMethod } from '../../src/skills/types';
import type { Skill } from '../../src/skills/types';

function makePromptSkill(
  name: string,
  source: SkillSource,
  loadedFrom: string
): Skill {
  return {
    name,
    description: `desc-${name}`,
    source,
    loadMethod: SkillLoadMethod.FILE_SYSTEM,
    loadedFrom,
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

describe('A1/A2 技能注入优先级与快照一致性', () => {
  it('根源修复：11 内置 + 1 用户技能（最后注册）时全部注入（不再截断）', async () => {
    const registry = new SkillRegistry();
    for (let i = 0; i < 11; i++) {
      registry.register(
        makePromptSkill(`builtin-${i}`, SkillSource.BUILTIN, 'bundled')
      );
    }
    // 用户技能最后注册（模拟 zhihu 场景：排在 11 内置之后）
    registry.register(
      makePromptSkill('user-skill', SkillSource.THIRD_PARTY, 'user')
    );

    const service = new SkillInjectionService(registry, {
      maxActiveSkills: 10, // 兼容字段，根源修复后不再截断
      enableSnapshotCache: false,
    });
    await service.refreshAll();

    const active = service.getActiveSkills().map((s) => s.name);
    // 修复前：slice(0,10) 截断 → user-skill 被挤出
    // 修复后：全量注入 → 用户技能与全部内置技能均可见
    expect(active).toContain('user-skill');
    expect(active).toContain('builtin-10');
    expect(active.length).toBe(12); // 全量，不受 maxActiveSkills 截断
  });

  it('A2：快照 prompt 与 mtime 技能集一致（同基于 active）', async () => {
    const registry = new SkillRegistry();
    for (let i = 0; i < 11; i++) {
      registry.register(
        makePromptSkill(`builtin-${i}`, SkillSource.BUILTIN, 'bundled')
      );
    }
    registry.register(
      makePromptSkill('user-skill', SkillSource.THIRD_PARTY, 'user')
    );

    const cacheDir = mkdtempSync(join(tmpdir(), 'skill-snapshot-'));
    const cachePath = join(cacheDir, 'snapshot.json');
    const service = new SkillInjectionService(registry, {
      maxActiveSkills: 10,
      enableSnapshotCache: true,
      snapshotCachePath: cachePath,
    });
    await service.refreshAll();

    const snapshot = JSON.parse(readFileSync(cachePath, 'utf-8')) as {
      prompt: string;
      mtime: string;
    };
    // prompt 中声明的技能名
    const promptNames = [
      ...snapshot.prompt.matchAll(/<name>([^<]+)<\/name>/g),
    ].map((m) => m[1]!);
    // mtime 中记录的技能名（格式 name:version:len:hash|...）
    const mtimeNames = snapshot.mtime.split('|').map((e) => e.split(':')[0]!);

    // 修复前：mtime 含全部注册技能（含被挤出者）≠ prompt（仅 active）
    // 修复后：mtime 与 prompt 同源（均基于全量 active）
    expect(mtimeNames.sort()).toEqual(promptNames.sort());
    expect(mtimeNames).toContain('user-skill');
    expect(mtimeNames).toContain('builtin-10'); // 全量后内置也进快照

    rmSync(cacheDir, { recursive: true, force: true });
  });
});
