/**
 * 技能生命周期迁移（T2.4）测试
 *
 * 对齐方案 T2.4 验收标准：
 * - 技能装载登记的副作用在卸载时按 LIFO 释放
 * - 未装载技能登记副作用 → 抛错
 * - clear 清空释放全部技能作用域
 */

import { describe, test, expect } from 'bun:test';
import { SkillRegistry } from '../SkillRegistry.js';
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

describe('技能生命周期迁移（T2.4）', () => {
  test('技能装载登记的副作用在卸载时按 LIFO 释放', async () => {
    const reg = new SkillRegistry();
    const skill = makeSkill('demo');
    reg.register(skill);

    const order: string[] = [];
    reg.onSkillDispose('demo', () => order.push('A'));
    reg.onSkillDispose('demo', () => order.push('B'));

    reg.unregister('demo');

    // dispose 是异步的，等待微任务完成
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(['B', 'A']); // LIFO
  });

  test('未装载技能登记副作用 → 抛错（use-before-register 防护）', () => {
    const reg = new SkillRegistry();
    expect(() => reg.onSkillDispose('ghost', () => {})).toThrow('未装载');
  });

  test('卸载两次只执行一次逆操作（scope 幂等）', async () => {
    const reg = new SkillRegistry();
    reg.register(makeSkill('idem'));
    let count = 0;
    reg.onSkillDispose('idem', () => count++);

    reg.unregister('idem');
    reg.unregister('idem'); // 第二次无 scope，跳过

    await new Promise((r) => setTimeout(r, 10));
    expect(count).toBe(1);
  });

  test('clear 释放全部技能作用域', async () => {
    const reg = new SkillRegistry();
    reg.register(makeSkill('a'));
    reg.register(makeSkill('b'));
    let released = 0;
    reg.onSkillDispose('a', () => released++);
    reg.onSkillDispose('b', () => released++);

    reg.clear();
    await new Promise((r) => setTimeout(r, 10));
    expect(released).toBe(2);
  });

  test('重装载技能可重新登记副作用（新 scope 实例）', async () => {
    const reg = new SkillRegistry();
    reg.register(makeSkill('reload'));
    reg.onSkillDispose('reload', () => {});
    reg.unregister('reload');
    await new Promise((r) => setTimeout(r, 10));

    // 重新装载 → 新 scope 可用
    reg.register(makeSkill('reload'));
    let count = 0;
    reg.onSkillDispose('reload', () => count++);
    reg.unregister('reload');
    await new Promise((r) => setTimeout(r, 10));
    expect(count).toBe(1);
  });
});
