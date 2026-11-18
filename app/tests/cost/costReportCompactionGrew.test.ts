// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * G2 D5（2026-11-18，`token-accounting-unification.md`）：压缩"变大"样本的报表口径。
 *
 * 事实来源（真机 `session_mwkthat73b80a6724f`）：
 * `compaction:applied {beforeTokens:169331, afterTokens:196778, savingPercent:-16.2}` ——
 * 压缩后体积反而 +27447 tokens。旧实现用 `savedTokens += before - after` 直接抵扣，
 * 会把"变大"悄悄从节省里减掉（甚至把总节省算成负数），既不显式也不可归因。
 *
 * 现口径（D5）：正向增量计入 `totalSavedTokens`；负增量只计入 `grewCount/grewTokens`，
 * **不抵扣**；零增量两边都不计。
 */
import { describe, expect, it } from 'bun:test';

import {
  buildTierStats,
  formatCostReport,
  type CostReport,
} from '../../src/context/analytics/CostReportService';
import type { CompactionHistoryEntry } from '../../src/context/compaction/CompactionMetrics';

function entry(
  tier: 1 | 2 | 3,
  beforeTokens: number,
  afterTokens: number
): CompactionHistoryEntry {
  return {
    timestamp: '2026-11-18T00:00:00.000Z',
    tier,
    trigger: 'test',
    beforeTokens,
    afterTokens,
    savingPercent:
      beforeTokens > 0
        ? ((beforeTokens - afterTokens) / beforeTokens) * 100
        : 0,
    durationMs: 1,
    decisions: [],
  };
}

describe('buildTierStats：变大样本单独计数（G2 D5）', () => {
  it('正向累计；负增量只计数不抵扣；零增量两边都不计', () => {
    const stats = buildTierStats([
      entry(3, 1000, 400), // 节省 600
      entry(3, 1000, 1400), // 变大 400（真机同型 169331 → 196778）
      entry(3, 500, 500), // 无变化
      entry(2, 800, 300), // 节省 500
    ]);

    const t3 = stats.find((s) => s.tier === 3);
    expect(t3?.count).toBe(3);
    // 关键：600 不被 400 抵扣（旧实现会得到 200）
    expect(t3?.totalSavedTokens).toBe(600);
    expect(t3?.grewCount).toBe(1);
    expect(t3?.grewTokens).toBe(400);

    const t2 = stats.find((s) => s.tier === 2);
    expect(t2?.totalSavedTokens).toBe(500);
    expect(t2?.grewCount).toBe(0);
    expect(t2?.grewTokens).toBe(0);
  });

  it('全部变大 ⇒ 节省为 0（不为负），增大如实记账', () => {
    const stats = buildTierStats([entry(3, 1000, 1400), entry(3, 200, 900)]);
    const t3 = stats[0];
    expect(t3?.totalSavedTokens).toBe(0);
    expect(t3?.totalCostSaved).toBe(0);
    expect(t3?.grewCount).toBe(2);
    expect(t3?.grewTokens).toBe(1100);
  });
});

describe('formatCostReport：变大样本必须可见', () => {
  it('文本报告列出"变大次数 + 增幅"，并声明未计入节省', () => {
    const report: CostReport = {
      timestamp: '2026-11-18T00:00:00.000Z',
      totals: {
        sessions: 1,
        modelCalls: 1,
        estimatedCost: 0,
        estimatedInputTokens: 0,
        estimatedOutputTokens: 0,
      },
      compactionStats: buildTierStats([entry(3, 1000, 1400)]),
      byModel: [],
      trend: 'n/a',
    };
    const text = formatCostReport(report);
    expect(text).toContain('1 次压缩后体积变大');
    expect(text).toContain('+400');
    expect(text).toContain('未计入节省');
    // 有变大时不得把它算进节省列
    expect(text).toContain('| T3 | 1 | 0 |');
  });

  it('无变大样本 ⇒ 不产生该提示（不造噪声）', () => {
    const report: CostReport = {
      timestamp: '2026-11-18T00:00:00.000Z',
      totals: {
        sessions: 1,
        modelCalls: 1,
        estimatedCost: 0,
        estimatedInputTokens: 0,
        estimatedOutputTokens: 0,
      },
      compactionStats: buildTierStats([entry(2, 1000, 400)]),
      byModel: [],
      trend: 'n/a',
    };
    expect(formatCostReport(report)).not.toContain('体积变大');
  });
});
