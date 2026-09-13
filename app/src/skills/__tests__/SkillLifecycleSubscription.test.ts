/**
 * 技能生命周期订阅 scope 化（T3.7）测试
 *
 * 对齐方案 v4.2 T3.7 验收标准：
 * - 三个 tracker（UsageTracker / Curator / ProvenanceTracker）的
 *   subscribeToRegistry 返回取消订阅函数
 * - unsub 调用后，Registry 事件不再触发 tracker 副作用（监听可回收）
 */

import { describe, test, expect } from 'bun:test';
import { SkillRegistry } from '../SkillRegistry.js';
import { SkillCurator } from '../SkillCurator.js';
import { SkillProvenanceTracker } from '../SkillProvenanceTracker.js';
import { SkillUsageTracker } from '../SkillUsageTracker.js';
import type { Skill } from '../types.js';

function makeSkill(name: string): Skill {
  return {
    name,
    description: `技能 ${name}`,
    version: '1.0.0',
    source: 'test' as never,
    aliases: [],
    isEnabled: () => true,
  } as unknown as Skill;
}

describe('技能生命周期订阅 scope 化（T3.7）', () => {
  test('SkillCurator 订阅返回 unsub，调用后 unregistered 不再清理状态', () => {
    const reg = new SkillRegistry();
    const curator = new SkillCurator();

    const unsub = curator.subscribeToRegistry(reg);

    // 订阅生效：unregister → removeState
    reg.register(makeSkill('demo'));
    curator.pin('demo');
    expect(curator.getState('demo')).not.toBeNull();
    reg.unregister('demo');
    expect(curator.getState('demo')).toBeNull();

    // 回收监听后：unregister 不再触发 removeState
    reg.register(makeSkill('demo'));
    curator.pin('demo');
    unsub();
    reg.unregister('demo');
    expect(curator.getState('demo')).not.toBeNull();
  });

  test('SkillCurator 订阅返回 unsub，调用后 cleared 不再触发 clearAll', () => {
    const reg = new SkillRegistry();
    const curator = new SkillCurator();
    const unsub = curator.subscribeToRegistry(reg);

    curator.pin('a');
    reg.clear();
    expect(curator.getAllStates().size).toBe(0);

    curator.pin('b');
    unsub();
    reg.clear();
    expect(curator.getAllStates().size).toBe(1);
  });

  test('SkillProvenanceTracker 订阅返回 unsub，调用后 registered 不再追踪', () => {
    const reg = new SkillRegistry();
    const tracker = new SkillProvenanceTracker();

    const unsub = tracker.subscribeToRegistry(reg);

    reg.register(makeSkill('demo'));
    expect(tracker.getProvenance('demo')).toBeDefined();

    unsub();
    reg.register(makeSkill('ghost'));
    expect(tracker.getProvenance('ghost')).toBeUndefined();
  });

  test('SkillUsageTracker 订阅返回 unsub，调用后 registered 不再记录', () => {
    const reg = new SkillRegistry();
    const tracker = new SkillUsageTracker();

    const unsub = tracker.subscribeToRegistry(reg);

    reg.register(makeSkill('demo'));
    expect(tracker.getSummary('demo')).not.toBeNull();

    unsub();
    reg.register(makeSkill('ghost'));
    expect(tracker.getSummary('ghost')).toBeNull();
  });
});
