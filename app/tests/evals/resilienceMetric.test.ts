/**
 * 评测行为指标 · ④ 空转重复次数（2026-11-01）。
 *
 * 背景：`dev_docs/20261031/deepseek建议.md` 建议把"卡死"做成可判定失败态。本指标只做**观测**：
 * 统计"相邻两次调用工具名 + 归一化参数完全相同"的次数，与循环守卫 `maxRepeatedRounds: 3` 同口径。
 *
 * 同时钉住归一化口径本身（`utils/toolCallKey`）：键序不影响 key、超长参数截断、循环引用退化为空串。
 */
import { describe, expect, it } from 'bun:test';
import {
  computeBehaviorMetrics,
  countStalledRepeats,
} from '../../src/evals/behaviorMetrics';
import { toolCallArgsKey } from '@openliri/infra/utils/toolCallKey';

describe('④ 空转重复次数', () => {
  it('相邻同工具同参数 ⇒ 计数；分页/换工具 ⇒ 不计', () => {
    const calls = [
      { name: 'file_read', args: { path: 'a.md' } },
      { name: 'file_read', args: { path: 'a.md' } }, // 重复 1
      { name: 'file_read', args: { path: 'a.md' } }, // 重复 2
      { name: 'file_read', args: { path: 'a.md', offset: 200 } }, // 参数不同
      { name: 'grep', args: { path: 'a.md' } }, // 换工具
      { name: 'grep', args: { path: 'a.md' } }, // 重复 3
    ];
    expect(countStalledRepeats(calls)).toBe(3);
  });

  it('键序不同的同一参数视为重复（归一化生效）', () => {
    const calls = [
      { name: 'grep', args: { pattern: 'x', path: 'a.md' } },
      { name: 'grep', args: { path: 'a.md', pattern: 'x' } },
    ];
    expect(countStalledRepeats(calls)).toBe(1);
  });

  it('无参数调用：同工具连续也计为重复', () => {
    expect(
      countStalledRepeats([{ name: 'agents_list' }, { name: 'agents_list' }])
    ).toBe(1);
  });

  it('computeBehaviorMetrics 带上 ④（其余三项口径不变）', () => {
    const metrics = computeBehaviorMetrics(
      [
        { name: 'file_read', args: { path: 'a.md' } },
        { name: 'file_read', args: { path: 'a.md' } },
      ],
      '正文'
    );
    expect(metrics.stalledRepeatCount).toBe(1);
    expect(metrics.explorationCount).toBe(2);
    expect(metrics.selfVerificationCount).toBe(0);
    expect(metrics.draftingRatio).toBe(1);
  });
});

describe('toolCallArgsKey 归一化口径', () => {
  it('键序不影响结果；超长参数截断到 200', () => {
    expect(toolCallArgsKey({ a: 1, b: 2 })).toBe(
      toolCallArgsKey({ b: 2, a: 1 })
    );
    expect(toolCallArgsKey({ big: 'x'.repeat(1000) }).length).toBe(200);
  });

  it('循环引用 ⇒ 空串（不参与区分）', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(toolCallArgsKey(cyclic)).toBe('');
  });

  it('undefined 参数 ⇒ 空串', () => {
    expect(toolCallArgsKey(undefined)).toBe('');
  });
});
