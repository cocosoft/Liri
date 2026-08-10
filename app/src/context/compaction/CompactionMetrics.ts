/**
 * FullCompactionDiagnostics — 全量压缩诊断追踪（Phase 5+）
 * 对标 PilotDeck compaction analytics + openclaw compaction hook metrics
 *
 * 追踪每级压缩的历史链，支持诊断命令：
 *   /context history  — 最近 N 次压缩历史
 *   /context snapshot — 当前上下文快照
 *   /context debug    — 压缩决策树打印
 */
import { getLogger } from '@modules/monitoring';
const logger = getLogger('context:compaction:diag');

const MAX_HISTORY_ENTRIES = 50;

export interface CompactionHistoryEntry {
  timestamp: string;
  tier: 1 | 2 | 3;
  trigger: string;
  beforeTokens: number;
  afterTokens: number;
  savingPercent: number;
  durationMs: number;
  sessionId?: string;
  decisions: string[];
}

export interface ContextSnapshot {
  sessionId: string;
  messageCount: number;
  estimatedTokens: number;
  compressionTier: number;
  memoryUsage: string;
  lastActivity: string;
}

/**
 * 压缩历史链追踪器
 */
class CompactionMetricsTracker {
  private history: CompactionHistoryEntry[] = [];
  private totalTier1 = 0;
  private totalTier2 = 0;
  private totalTier3 = 0;

  record(entry: CompactionHistoryEntry): void {
    this.history.push(entry);
    if (this.history.length > MAX_HISTORY_ENTRIES) {
      this.history.shift();
    }

    switch (entry.tier) {
      case 1:
        this.totalTier1++;
        break;
      case 2:
        this.totalTier2++;
        break;
      case 3:
        this.totalTier3++;
        break;
    }

    logger.info('compaction:recorded', {
      tier: entry.tier,
      trigger: entry.trigger,
      savingPercent: entry.savingPercent,
      durationMs: entry.durationMs,
    });
  }

  /** 获取最近 N 条历史 */
  getHistory(n = 10): CompactionHistoryEntry[] {
    return this.history.slice(-n);
  }

  /** 获取压缩统计摘要 */
  getSummary(): {
    total: number;
    byTier: Record<number, number>;
    averageSavings: number;
  } {
    const total = this.totalTier1 + this.totalTier2 + this.totalTier3;
    const avgSavings =
      this.history.length > 0
        ? this.history.reduce((s, e) => s + e.savingPercent, 0) /
          this.history.length
        : 0;

    return {
      total,
      byTier: { 1: this.totalTier1, 2: this.totalTier2, 3: this.totalTier3 },
      averageSavings: Math.round(avgSavings * 100) / 100,
    };
  }

  /** 格式化压缩历史（用于 /context history 命令） */
  formatHistory(n = 10): string {
    const entries = this.getHistory(n);
    if (entries.length === 0) return 'No compaction history';

    const lines = [
      `## Compaction History (last ${entries.length})`,
      '| Time | Tier | Trigger | Before | After | Saved | Duration |',
      '|------|------|---------|--------|-------|-------|----------|',
    ];

    for (const e of entries) {
      lines.push(
        `| ${e.timestamp.slice(11, 19)} | T${e.tier} | ${e.trigger} | ${e.beforeTokens} | ${e.afterTokens} | ${e.savingPercent.toFixed(1)}% | ${e.durationMs}ms |`
      );
    }

    return lines.join('\n');
  }

  /** 格式化当前状态（用于 /context snapshot 命令） */
  formatSnapshot(snapshot: ContextSnapshot): string {
    return [
      `## Context Snapshot`,
      `- Session: ${snapshot.sessionId}`,
      `- Messages: ${snapshot.messageCount}`,
      `- Estimated Tokens: ${snapshot.estimatedTokens.toLocaleString()}`,
      `- Compression Tier: ${snapshot.compressionTier}`,
      `- Memory: ${snapshot.memoryUsage}`,
      `- Last Activity: ${snapshot.lastActivity}`,
    ].join('\n');
  }

  /** 格式化压缩决策树（用于 /context debug 命令） */
  formatDebugTree(): string {
    const summary = this.getSummary();
    return [
      '## Compaction Debug Tree',
      '',
      '### AutoCompactionPolicy',
      `  < 85% → skip`,
      `  85-92% → warn → recommend MicroCompact (Tier 1) or Snip (Tier 2)`,
      `  > 92% → trigger → Full Compaction (Tier 3)`,
      `  Anti-flap: skip if last 2 Tier 3 each saved < 10%`,
      '',
      '### History Summary',
      `  Total: ${summary.total} (T1: ${summary.byTier[1]}, T2: ${summary.byTier[2]}, T3: ${summary.byTier[3]})`,
      `  Avg Savings: ${summary.averageSavings}%`,
    ].join('\n');
  }
}

export const compactionMetricsTracker = new CompactionMetricsTracker();
