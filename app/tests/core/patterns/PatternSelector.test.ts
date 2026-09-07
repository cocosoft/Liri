import { describe, expect, test } from 'bun:test';
import {
  selectPattern,
  listPatterns,
  getPatternDescriptor,
} from '@modules/core/patterns/index.js';

describe('PatternSelector（Teamwork P2a）', () => {
  test('simple 复杂度 → null（回退现状快速路径，验收 #4 语义）', () => {
    expect(selectPattern({ complexity: 'simple' })).toBeNull();
    expect(selectPattern({ complexity: 'simple', research: true })).toBeNull();
  });

  test('complex + 研究型标志 → competitive_strategy（与 P0-3 门控同信号）', () => {
    const sel = selectPattern({ complexity: 'complex', research: true });
    expect(sel?.name).toBe('competitive_strategy');
  });

  test('complex 非研究 → long_task_pdl（目标驱动主路径）', () => {
    const sel = selectPattern({ complexity: 'complex' });
    expect(sel?.name).toBe('long_task_pdl');
    const sel2 = selectPattern({ complexity: 'complex', taskType: 'write' });
    expect(sel2?.name).toBe('long_task_pdl');
  });
});

describe('PatternRegistry（描述层）', () => {
  test('首批 5 个 pattern 已注册且描述字段齐全', () => {
    const patterns = listPatterns();
    expect(patterns).toHaveLength(5);
    for (const p of patterns) {
      expect(p.name).toBeTruthy();
      expect(p.displayName).toBeTruthy();
      expect(p.when).toBeTruthy();
      expect(p.roles.length).toBeGreaterThan(0);
      expect(p.composedOf).toBeTruthy();
    }
  });

  test('getPatternDescriptor 按名可取、未知名返回 undefined', () => {
    expect(getPatternDescriptor('long_task_pdl')?.displayName).toContain('PDL');
    expect(getPatternDescriptor('competitive_strategy')?.roles).toContain(
      'adversarial-reviewer'
    );
    expect(getPatternDescriptor('not_exist' as never)).toBeUndefined();
  });
});
