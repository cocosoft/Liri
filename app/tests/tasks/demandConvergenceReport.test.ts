// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * B9（2026-11-09，设计稿 §4 指标 4）：收敛率取数的聚合口径。
 *
 * 覆盖：分组（demand / interactive）、终态分布、收敛率分母（排除 abort 与进行中）、
 * 解析失败单列、少样本显式不作结论（CS06：不拿 0 样本编结论）。
 */

import { describe, expect, it } from 'bun:test';
import {
  MIN_SAMPLES,
  formatSummary,
  summarizeCheckpoints,
} from '../../scripts/lib/demandConvergence';

const row = (data: Record<string, unknown>): { raw: string } => ({
  raw: JSON.stringify(data),
});

describe('B9：检查点聚合口径', () => {
  it('按 demand 身份分组，并统计终态分布', () => {
    const summary = summarizeCheckpoints([
      row({ demand: true, phase: 'completed' }),
      row({ demand: true, phase: 'failed' }),
      row({ demand: true, phase: 'abort' }),
      row({ demand: true, phase: 'execute' }),
      row({ phase: 'completed' }),
      row({ phase: 'failed' }),
    ]);

    expect(summary.demand.samples).toBe(4);
    expect(summary.demand.completed).toBe(1);
    expect(summary.demand.failed).toBe(1);
    expect(summary.demand.aborted).toBe(1);
    expect(summary.demand.inProgress).toBe(1);
    expect(summary.interactive.samples).toBe(2);
    expect(summary.total).toBe(6);
  });

  it('收敛率分母排除中止与进行中', () => {
    const summary = summarizeCheckpoints([
      row({ demand: true, phase: 'completed' }),
      row({ demand: true, phase: 'completed' }),
      row({ demand: true, phase: 'failed' }),
      row({ demand: true, phase: 'abort' }),
    ]);
    // 2 / (2 + 1) —— abort 不进分母
    expect(summary.demand.concluded).toBe(3);
    expect(summary.demand.convergedRate).toBeCloseTo(2 / 3, 5);
  });

  it('无已结论样本 ⇒ 收敛率为 null（不输出 0%）', () => {
    const summary = summarizeCheckpoints([
      row({ demand: true, phase: 'execute' }),
      row({ demand: true, phase: 'abort' }),
    ]);
    expect(summary.demand.convergedRate).toBeNull();
  });

  it('解析失败单独计数（不猜分组）', () => {
    const summary = summarizeCheckpoints([
      { raw: '{not-json' },
      { raw: 'null' },
      row({ phase: 'completed' }),
    ]);
    expect(summary.unparsable).toBe(2);
    expect(summary.demand.samples).toBe(0);
    expect(summary.interactive.samples).toBe(1);
  });
});

describe('B9：报告文案', () => {
  it('少样本 ⇒ 显式提示不作结论', () => {
    const summary = summarizeCheckpoints([
      row({ demand: true, phase: 'completed' }),
    ]);
    const text = formatSummary(summary, { dbPath: 'x.db' });
    expect(text).toContain('样本不足');
    expect(text).toContain('不作结论');
    expect(summary.demand.samples).toBeLessThan(MIN_SAMPLES);
  });

  it('两组样本充足 ⇒ 输出差值（pp）', () => {
    const rows = [
      ...Array.from({ length: MIN_SAMPLES }, () =>
        row({ demand: true, phase: 'completed' })
      ),
      ...Array.from({ length: MIN_SAMPLES }, () => row({ phase: 'failed' })),
    ];
    const text = formatSummary(summarizeCheckpoints(rows), { dbPath: 'x.db' });
    expect(text).toContain('差值 demand - interactive = +100.0pp');
    expect(text).not.toContain('样本不足');
  });

  it('零样本 ⇒ 如实报 0 条（不编占比）', () => {
    const text = formatSummary(summarizeCheckpoints([]), { dbPath: 'x.db' });
    expect(text).toContain('检查点: 0 条');
    expect(text).not.toContain('0.0%');
  });
});
