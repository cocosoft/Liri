/**
 * SkillProvider 禁用拦截测试（v1.5 阶段 0 补充）
 * 覆盖：禁用后 matchSkill/getAvailableSkills 不含被禁技能；重新启用后恢复。
 * 行为由 SkillRegistry 查询出口单点过滤保证（SkillProvider 走 registry.getAll）。
 */

import { describe, it, expect } from 'bun:test';

import { SkillRegistry } from '../../src/skills/SkillRegistry';
import { SkillProvider } from '../../src/ai/localAgent/SkillProvider';
import type { ISkillRegistry } from '../../src/ai/localAgent/SkillProvider';
import {
  SkillSource,
  SkillLoadMethod,
  type Skill,
} from '../../src/skills/types';

function makeSkill(name: string, overrides: Partial<Skill> = {}): Skill {
  return {
    name,
    description: `desc of ${name}`,
    source: SkillSource.THIRD_PARTY,
    loadMethod: SkillLoadMethod.ADAPTER,
    loadedFrom: 'test',
    impl: { kind: 'executable', execute: async () => undefined },
    manifest: { name },
    ...overrides,
  };
}

describe('SkillProvider（禁用拦截）', () => {
  it('禁用后 matchSkill 不命中被禁技能（P2-10）', async () => {
    const registry = new SkillRegistry();
    registry.register(makeSkill('alpha'));
    registry.register(makeSkill('beta'));
    registry.setEnabled('alpha', false);

    const provider = new SkillProvider({
      enabled: true,
      skillRegistry: registry as ISkillRegistry,
    });

    // alpha 被过滤：不再出现在 getAll 中，matchSkill 无法命中
    expect(await provider.matchSkill('please use alpha skill')).toBeNull();
    // beta 已启用：正常命中
    expect((await provider.matchSkill('please use beta skill'))?.skillName).toBe('beta');
  });

  it('禁用后 getAvailableSkills 不含被禁技能', () => {
    const registry = new SkillRegistry();
    registry.register(makeSkill('alpha'));
    registry.register(makeSkill('beta'));
    registry.setEnabled('alpha', false);

    const provider = new SkillProvider({
      enabled: true,
      skillRegistry: registry as ISkillRegistry,
    });

    const available = provider.getAvailableSkills();
    expect(available).toContain('beta');
    expect(available).not.toContain('alpha');
  });

  it('重新启用后 matchSkill 可命中该技能', async () => {
    const registry = new SkillRegistry();
    registry.register(makeSkill('alpha'));
    registry.setEnabled('alpha', false);
    registry.setEnabled('alpha', true);

    const provider = new SkillProvider({
      enabled: true,
      skillRegistry: registry as ISkillRegistry,
    });

    expect((await provider.matchSkill('use alpha'))?.skillName).toBe('alpha');
  });
});
