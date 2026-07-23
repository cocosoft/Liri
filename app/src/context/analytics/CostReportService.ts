/**
 * CostReportService — 成本报告生成器（Phase 6 轻量版 + P2 修复）
 * 对标 cc-switch UsageDashboard，纯文本版
 *
 * 替代方案：独立前端 Dashboard 项目（完整 Hero + TrendChart + RequestLog + PricingPanel）
 * 当前：增强 `/cost` 命令文本报告 + 结构化 API 端点
 *
 * v2.1: buildTierStats 修复 — 从 CompactionHistoryEntry 计算真实的 tokens/cost 节省量
 */
import { Logger, LogLevel } from '@modules/monitoring';
import {
  compactionMetricsTracker,
  type CompactionHistoryEntry,
} from '../compaction/CompactionMetrics';

const logger = new Logger({
  module: 'context:cost:report',
  level: LogLevel.INFO,
});

/** 估算每 token 成本（$/token），用于计算节省金额 */
const AVG_COST_PER_INPUT_TOKEN = 0.000001; // ~$1/M input tokens
const AVG_COST_PER_OUTPUT_TOKEN = 0.000003; // ~$3/M output tokens

export interface TierStats {
  tier: 1 | 2 | 3;
  count: number;
  totalSavedTokens: number;
  totalCostSaved: number;
}

export interface ModelCostSnapshot {
  modelId: string;
  calls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  estimatedCost: number;
  lastUsed: string;
}

export interface CostReport {
  timestamp: string;
  totals: {
    sessions: number;
    modelCalls: number;
    estimatedCost: number;
    estimatedInputTokens: number;
    estimatedOutputTokens: number;
  };
  compactionStats: TierStats[];
  byModel: ModelCostSnapshot[];
  trend: string;
}

/**
 * 生成分级压缩统计（v2.1: 使用真实的 tokens 节省数据）
 */
function buildTierStats(): TierStats[] {
  const history = compactionMetricsTracker.getHistory(50);

  const byTier: Map<number, { count: number; savedTokens: number }> = new Map();
  for (const entry of history) {
    const existing = byTier.get(entry.tier) ?? { count: 0, savedTokens: 0 };
    existing.count++;
    existing.savedTokens += entry.beforeTokens - entry.afterTokens;
    byTier.set(entry.tier, existing);
  }

  const result: TierStats[] = [];
  for (const [tier, data] of byTier) {
    // 保守估算：saved tokens 按 70% input + 30% output 折算成本
    const costSaved =
      data.savedTokens * 0.7 * AVG_COST_PER_INPUT_TOKEN +
      data.savedTokens * 0.3 * AVG_COST_PER_OUTPUT_TOKEN;
    result.push({
      tier: tier as 1 | 2 | 3,
      count: data.count,
      totalSavedTokens: data.savedTokens,
      totalCostSaved: costSaved,
    });
  }

  return result.sort((a, b) => a.tier - b.tier);
}

/**
 * 生成文本成本报告（/cost 命令格式）
 */
export function formatCostReport(report: CostReport): string {
  const lines = [
    `## Cost Report (${report.timestamp.slice(0, 10)})`,
    '',
    '### Totals',
    `- Sessions: ${report.totals.sessions}`,
    `- Model calls: ${report.totals.modelCalls}`,
    `- Estimated cost: $${report.totals.estimatedCost.toFixed(4)}`,
    `- Input tokens: ${report.totals.estimatedInputTokens.toLocaleString()}`,
    `- Output tokens: ${report.totals.estimatedOutputTokens.toLocaleString()}`,
    '',
  ];

  if (report.compactionStats.length > 0) {
    lines.push('### Compaction Savings');
    lines.push('| Tier | Count | Tokens Saved | Cost Saved |');
    lines.push('|------|-------|-------------|------------|');
    for (const t of report.compactionStats) {
      lines.push(
        `| T${t.tier} | ${t.count} | ${t.totalSavedTokens.toLocaleString()} | $${t.totalCostSaved.toFixed(4)} |`
      );
    }
    lines.push('');
  }

  if (report.byModel.length > 0) {
    lines.push('### By Model');
    lines.push('| Model | Calls | Input Tokens | Output Tokens | Est. Cost |');
    lines.push('|-------|-------|-------------|---------------|-----------|');
    for (const m of report.byModel.slice(0, 10)) {
      lines.push(
        `| ${m.modelId} | ${m.calls} | ${m.totalInputTokens.toLocaleString()} | ${m.totalOutputTokens.toLocaleString()} | $${m.estimatedCost.toFixed(4)} |`
      );
    }
    lines.push('');
  }

  lines.push(`_Trend: ${report.trend}_`);

  return lines.join('\n');
}

/**
 * 压缩节省率趋势计算
 */
export function analyzeTrend(
  history: Array<{ savingPercent: number }>
): string {
  if (history.length < 3) return 'insufficient data';

  const recent = history.slice(-5);
  const avg = recent.reduce((s, e) => s + e.savingPercent, 0) / recent.length;

  if (avg > 50) return 'Excellent (avg >50% savings)';
  if (avg > 25) return 'Good (avg >25% savings)';
  if (avg > 10) return 'Moderate (avg >10% savings)';
  return 'Low (avg <10% savings, review compaction strategy)';
}
