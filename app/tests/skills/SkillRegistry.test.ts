/**
 * SkillRegistry 单元测试（v1.5 步骤 0）
 * 覆盖：setEnabled、查询出口单点过滤（get/getAll/has/search）、skill-updated 事件、双视图（listAll）
 */

import { describe, it, expect } from 'bun:test';

import { SkillRegistry } from '../../src/skills/SkillRegistry';
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
    ...overrides,
  };
}

describe('SkillRegistry（enabled 单点过滤）', () => {
  it('默认所有技能视为启用（未 setEnabled 前）', () => {
    const registry = new SkillRegistry();
    registry.register(makeSkill('alpha'));
    registry.register(makeSkill('beta'));

    expect(registry.getAll().map((s) => s.name)).toEqual(['alpha', 'beta']);
    expect(registry.get('alpha')).toBeDefined();
    expect(registry.has('alpha')).toBe(true);
    expect(registry.search('alp')).toHaveLength(1);
  });

  it('setEnabled(false) 后运行时视图排除该技能，管理视图（includeDisabled/listAll）仍含', () => {
    const registry = new SkillRegistry();
    registry.register(makeSkill('alpha'));
    registry.register(makeSkill('beta'));

    registry.setEnabled('alpha', false);

    // 运行时视图
    expect(registry.getAll().map((s) => s.name)).toEqual(['beta']);
    expect(registry.get('alpha')).toBeUndefined();
    expect(registry.has('alpha')).toBe(false);
    expect(registry.search('alpha')).toHaveLength(0);
    expect(registry.getByCategory('x')).toEqual([]);

    // 管理视图
    expect(registry.getAll({ includeDisabled: true }).map((s) => s.name).sort()).toEqual(['alpha', 'beta']);
    expect(registry.get('alpha', { includeDisabled: true })?.name).toBe('alpha');
    expect(registry.has('alpha', { includeDisabled: true })).toBe(true);
    expect(registry.search('alpha', { includeDisabled: true })).toHaveLength(1);
    expect(registry.listAll().map((s) => s.name).sort()).toEqual(['alpha', 'beta']);
  });

  it('重新启用后运行时视图恢复可见', () => {
    const registry = new SkillRegistry();
    registry.register(makeSkill('alpha'));

    registry.setEnabled('alpha', false);
    expect(registry.getAll()).toHaveLength(0);

    registry.setEnabled('alpha', true);
    expect(registry.getAll().map((s) => s.name)).toEqual(['alpha']);
  });

  it('setEnabled 触发 skill-updated 事件（携带技能对象）', () => {
    const registry = new SkillRegistry();
    registry.register(makeSkill('alpha'));

    let updatedName: string | undefined;
    let updatedSkill: Skill | undefined;
    registry.on('skill-updated', (event, skill) => {
      if (event === 'skill-updated') {
        updatedName = skill?.name;
        updatedSkill = skill;
      }
    });

    registry.setEnabled('alpha', false);

    expect(updatedName).toBe('alpha');
    expect(updatedSkill?.name).toBe('alpha');
  });

  it('setEnabled 同时更新 skill.isEnabled 钩子（外部读一致）', () => {
    const registry = new SkillRegistry();
    const alpha = makeSkill('alpha');
    registry.register(alpha);

    registry.setEnabled('alpha', false);
    expect(alpha.isEnabled?.()).toBe(false);

    registry.setEnabled('alpha', true);
    expect(alpha.isEnabled?.()).toBe(true);
  });

  it('unregister 清理 enabled 状态，重注册回到默认启用', () => {
    const registry = new SkillRegistry();
    registry.register(makeSkill('alpha'));
    registry.setEnabled('alpha', false);
    registry.unregister('alpha');

    registry.register(makeSkill('alpha'));
    expect(registry.getAll().map((s) => s.name)).toEqual(['alpha']);
  });

  it('size/countBySource 仅统计运行时可见（启用）技能', () => {
    const registry = new SkillRegistry();
    registry.register(makeSkill('alpha'));
    registry.register(makeSkill('beta', { source: SkillSource.OFFICIAL }));

    registry.setEnabled('beta', false);

    expect(registry.size()).toBe(1);
    expect(registry.countBySource(SkillSource.OFFICIAL)).toBe(0);
  });
});
