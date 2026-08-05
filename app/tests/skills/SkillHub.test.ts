/**
 * SkillHub 单元测试（v1.5 步骤 0）
 * 覆盖：bindTo 幂等接线、事件驱动快照刷新（registered/skill-updated → search 过滤）
 */

import { describe, it, expect } from 'bun:test';

import { SkillRegistry } from '../../src/skills/SkillRegistry';
import { SkillHub } from '../../src/skills/SkillHub';
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

describe('SkillHub（事件联动）', () => {
  it('bindTo 后立即投影 registry 当前快照', () => {
    const registry = new SkillRegistry();
    registry.register(makeSkill('alpha'));
    const hub = new SkillHub();
    hub.bindTo(registry);

    expect(hub.search({}).map((e) => e.name)).toEqual(['alpha']);
    expect(hub.hasSkill('alpha')).toBe(true);
  });

  it('bindTo 后新注册技能自动出现在 Hub', () => {
    const registry = new SkillRegistry();
    const hub = new SkillHub();
    hub.bindTo(registry);

    registry.register(makeSkill('alpha'));
    registry.register(makeSkill('beta'));

    expect(hub.search({}).map((e) => e.name)).toEqual(['alpha', 'beta']);
  });

  it('setEnabled(false) 触发 skill-updated → Hub.search 立即不含被禁技能', () => {
    const registry = new SkillRegistry();
    registry.register(makeSkill('alpha'));
    registry.register(makeSkill('beta'));
    const hub = new SkillHub();
    hub.bindTo(registry);

    registry.setEnabled('alpha', false);

    const names = hub.search({}).map((e) => e.name);
    expect(names).toContain('beta');
    expect(names).not.toContain('alpha');
    expect(hub.hasSkill('alpha')).toBe(false);
  });

  it('重新启用后 Hub 快照恢复含该技能', () => {
    const registry = new SkillRegistry();
    registry.register(makeSkill('alpha'));
    const hub = new SkillHub();
    hub.bindTo(registry);

    registry.setEnabled('alpha', false);
    registry.setEnabled('alpha', true);

    expect(hub.hasSkill('alpha')).toBe(true);
  });

  it('bindTo 同一 registry 幂等（不重复订阅导致重复刷新副作用）', () => {
    const registry = new SkillRegistry();
    const hub = new SkillHub();
    hub.bindTo(registry);
    hub.bindTo(registry);

    registry.register(makeSkill('alpha'));
    expect(hub.search({}).map((e) => e.name)).toEqual(['alpha']);
  });

  it('unregistered 后 Hub 快照移除', () => {
    const registry = new SkillRegistry();
    registry.register(makeSkill('alpha'));
    const hub = new SkillHub();
    hub.bindTo(registry);

    registry.unregister('alpha');

    expect(hub.hasSkill('alpha')).toBe(false);
  });
});
