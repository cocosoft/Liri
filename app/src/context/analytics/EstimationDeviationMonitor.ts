/**
 * EstimationDeviationMonitor — 估算 vs 实际偏差监控（Phase 6）
 * 对标 PilotDeck estimateTokens() vs tiktoken 真值对比
 *
 * 监控模式：
 *   正常：偏差 < 15% → 静默
 *   警告：偏差 15-30% → warn 日志
 *   告警：偏差 > 30% → alert 日志 + /cost 命令中标注
 */
import { getLogger } from '@modules/monitoring';
const logger = getLogger('context:cost:deviation');

export interface DeviationRecord {
  timestamp: string;
  modelId: string;
  estimatedInput: number;
  actualInput: number;
  estimatedOutput: number;
  actualOutput: number;
  deviationPercent: number;
}

export type DeviationLevel = 'normal' | 'warn' | 'alert';

export class EstimationDeviationMonitor {
  private records: DeviationRecord[] = [];
  private maxRecords = 100;

  /**
   * 记录一次估算 vs 实际对比
   * @returns 偏差级别
   */
  record(
    modelId: string,
    estimatedTokens: number,
    actualTokens: number
  ): DeviationLevel {
    const deviation =
      actualTokens > 0
        ? (Math.abs(estimatedTokens - actualTokens) / actualTokens) * 100
        : 0;

    const record: DeviationRecord = {
      timestamp: new Date().toISOString(),
      modelId,
      estimatedInput: estimatedTokens,
      actualInput: actualTokens,
      estimatedOutput: 0,
      actualOutput: 0,
      deviationPercent: Math.round(deviation * 100) / 100,
    };

    this.records.push(record);
    if (this.records.length > this.maxRecords) {
      this.records.shift();
    }

    const level = this.classify(deviation);

    switch (level) {
      case 'warn':
        logger.warn('estimation:deviation', {
          modelId,
          deviationPercent: record.deviationPercent,
          estimated: estimatedTokens,
          actual: actualTokens,
        });
        break;
      case 'alert':
        logger.error('estimation:deviation_critical', {
          modelId,
          deviationPercent: record.deviationPercent,
          estimated: estimatedTokens,
          actual: actualTokens,
        });
        break;
    }

    return level;
  }

  private classify(deviation: number): DeviationLevel {
    if (deviation > 30) return 'alert';
    if (deviation > 15) return 'warn';
    return 'normal';
  }

  /**
   * 获取平均偏差
   */
  getAverageDeviation(): number {
    if (this.records.length === 0) return 0;
    return (
      this.records.reduce((s, r) => s + r.deviationPercent, 0) /
      this.records.length
    );
  }

  /**
   * 偏差趋势（升/降/稳）
   */
  getTrend(): 'improving' | 'degrading' | 'stable' {
    if (this.records.length < 5) return 'stable';

    const recent = this.records.slice(-5);
    const older = this.records.slice(-10, -5);
    if (older.length === 0) return 'stable';

    const recentAvg =
      recent.reduce((s, r) => s + r.deviationPercent, 0) / recent.length;
    const olderAvg =
      older.reduce((s, r) => s + r.deviationPercent, 0) / older.length;
    const diff = recentAvg - olderAvg;

    if (diff > 5) return 'degrading';
    if (diff < -5) return 'improving';
    return 'stable';
  }
}

export const deviationMonitor = new EstimationDeviationMonitor();
