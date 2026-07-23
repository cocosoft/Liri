/**
 * ContextStatsService — 上下文实时统计（Phase 6 轻量版）
 * /context stats 命令支持
 */
import type { ChatMessage } from '../../ai/models/types';
import { estimateMessagesTokens } from '../../ai/tokenizer/TokenEstimator';
import { compactionMetricsTracker } from '../compaction/CompactionMetrics';
import {
  resolveContextWindow,
  getEffectiveContextWindow,
} from '../window/ContextWindowResolver';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({
  module: 'context:analytics:stats',
  level: LogLevel.INFO,
});

export interface ContextStats {
  sessionId: string;
  messageCount: number;
  estimatedTokens: number;
  effectiveMaxTokens: number;
  budgetRemaining: number;
  compressionTier: number;
  compactionSummary: {
    total: number;
    byTier: Record<number, number>;
    averageSavings: number;
  };
  memoryUsage: string;
  model: string;
}

/**
 * 收集当前会话的上下文统计
 */
export function collectContextStats(
  messages: ChatMessage[],
  sessionId: string,
  model: string
): ContextStats {
  const estimatedTokens = estimateMessagesTokens(messages);
  const effectiveMax = getEffectiveContextWindow(model);
  const summary = compactionMetricsTracker.getSummary();

  return {
    sessionId,
    messageCount: messages.length,
    estimatedTokens,
    effectiveMaxTokens: effectiveMax,
    budgetRemaining: Math.max(effectiveMax - estimatedTokens, 0),
    compressionTier: summary.total > 0 ? 3 : 0,
    compactionSummary: summary,
    memoryUsage:
      `${(process.memoryUsage?.()?.heapUsed ?? 0) / 1024 / 1024}`.slice(0, 6) +
      'MB',
    model,
  };
}

/**
 * 格式化统计输出（/context stats 命令）
 */
export function formatContextStats(stats: ContextStats): string {
  const usagePercent =
    stats.effectiveMaxTokens > 0
      ? ((stats.estimatedTokens / stats.effectiveMaxTokens) * 100).toFixed(1)
      : '0';

  return [
    `## Context Stats`,
    '',
    `**Session**: ${stats.sessionId.slice(0, 8)}...`,
    `**Model**: ${stats.model}`,
    '',
    '### Token Budget',
    `\`\`\``,
    `Used:    ${stats.estimatedTokens.toLocaleString().padStart(8)} tokens (${usagePercent}%)`,
    `Remaining: ${stats.budgetRemaining.toLocaleString().padStart(8)} tokens`,
    `Window:    ${stats.effectiveMaxTokens.toLocaleString().padStart(8)} tokens`,
    `\`\`\``,
    '',
    '### Messages',
    `- Count: ${stats.messageCount}`,
    `- Compression tier: ${stats.compressionTier}`,
    '',
    '### Compaction History',
    `- Total: ${stats.compactionSummary.total} (T1: ${stats.compactionSummary.byTier[1]}, T2: ${stats.compactionSummary.byTier[2]}, T3: ${stats.compactionSummary.byTier[3]})`,
    `- Avg savings: ${stats.compactionSummary.averageSavings}%`,
    '',
    `_Memory: ${stats.memoryUsage}_`,
  ].join('\n');
}
