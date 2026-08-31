/**
 * SkillMemoryGraph 技能×记忆学习图谱测试（P1-7，对标 Hermes learning_graph）
 *
 * 覆盖：
 * - addLink 双向关联：getMemoriesForSkill / getSkillsForMemory
 * - 同一对重复 add 覆盖（不产生重复）
 * - buildFromMemories：tags 匹配技能名自动构建
 * - stats 统计
 */
import { describe, test, expect } from 'bun:test';
import { SkillMemoryGraph } from '../../../src/memory/utils/SkillMemoryGraph';

describe('SkillMemoryGraph（P1-7）', () => {
  test('addLink：技能↔记忆双向查询', () => {
    const g = new SkillMemoryGraph();
    g.addLink('code-review', 'mem-1');
    g.addLink('code-review', 'mem-2');
    g.addLink('debugging', 'mem-2');

    const mems = g.getMemoriesForSkill('code-review');
    expect(mems.map((m) => m.memoryId).sort()).toEqual(['mem-1', 'mem-2']);
    expect(
      g
        .getSkillsForMemory('mem-2')
        .map((s) => s.skillId)
        .sort()
    ).toEqual(['code-review', 'debugging']);
    expect(g.getSkills()).toContain('code-review');
    expect(g.getMemories()).toContain('mem-1');
  });

  test('同一对重复 addLink 覆盖（不产生重复）', () => {
    const g = new SkillMemoryGraph();
    g.addLink('skill-a', 'mem-x', 1);
    g.addLink('skill-a', 'mem-x', 5, 'tag');
    const mems = g.getMemoriesForSkill('skill-a');
    expect(mems.length).toBe(1);
    expect(mems[0].strength).toBe(5);
    expect(mems[0].source).toBe('tag');
  });

  test('buildFromMemories：tags 匹配技能名自动构建', () => {
    const g = new SkillMemoryGraph();
    const added = g.buildFromMemories(
      [
        { id: 'mem-1', tags: ['code-review', 'typescript'] },
        { id: 'mem-2', tags: ['debugging'] },
        { id: 'mem-3', tags: ['writing'] },
      ],
      ['Code-Review', 'Debugging', 'Planning']
    );
    expect(added).toBe(2); // code-review↔mem-1 + debugging↔mem-2（tags 匹配技能名）
    expect(g.getMemoriesForSkill('Code-Review').map((m) => m.memoryId)).toEqual(
      ['mem-1']
    );
    expect(g.getMemoriesForSkill('Debugging').map((m) => m.memoryId)).toEqual([
      'mem-2',
    ]);
    // Planning 无匹配记忆
    expect(g.getMemoriesForSkill('Planning').length).toBe(0);
    // tag 来源标记
    expect(g.getMemoriesForSkill('Code-Review')[0].source).toBe('tag');
  });

  test('removeLink + stats', () => {
    const g = new SkillMemoryGraph();
    g.addLink('s1', 'm1');
    g.addLink('s1', 'm2');
    g.addLink('s2', 'm1');
    const st = g.stats();
    expect(st.skillCount).toBe(2);
    expect(st.memoryCount).toBe(2);
    expect(st.linkCount).toBe(3);
    expect(st.avgMemoriesPerSkill).toBe(1.5);

    g.removeLink('s1', 'm2');
    expect(g.getMemoriesForSkill('s1').map((m) => m.memoryId)).toEqual(['m1']);
    expect(g.getSkillsForMemory('m2').length).toBe(0);
  });
});
