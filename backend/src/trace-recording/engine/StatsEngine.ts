/**
 * 统计引擎
 *
 * 按模型的实时内存统计。
 * 支持调用次数、Token用量、延迟分位数、错误数等。
 *
 * 参考：claude-tap 的 TraceWriter 统计 (Python 实现)
 */

import type { TraceRecord } from '../types';

/** 按模型统计 */
interface ModelStats {
  callCount: number;
  errorCount: number;
  totalDurationMs: number;
  durations: number[];
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
}

/**
 * 统计引擎
 */
export class StatsEngine {
  private modelStats: Map<string, ModelStats> = new Map();
  private allDurations: number[] = [];
  private totalCalls = 0;
  private totalErrors = 0;

  /**
   * 记录一次调用统计
   * @param record 录制记录
   */
  record(record: TraceRecord): void {
    this.totalCalls++;
    this.allDurations.push(record.durationMs);

    const model = this.extractModel(record);
    let stats = this.modelStats.get(model);
    if (!stats) {
      stats = {
        callCount: 0,
        errorCount: 0,
        totalDurationMs: 0,
        durations: [],
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
      };
      this.modelStats.set(model, stats);
    }

    stats.callCount++;
    stats.totalDurationMs += record.durationMs;
    stats.durations.push(record.durationMs);

    if (record.error || record.response.status >= 400) {
      stats.errorCount++;
      this.totalErrors++;
    }

    // 尝试从记录中提取 token 用量
    const usage = this.extractUsage(record);
    if (usage) {
      stats.inputTokens += usage.inputTokens || 0;
      stats.outputTokens += usage.outputTokens || 0;
      stats.cacheReadTokens += usage.cacheReadTokens || 0;
      stats.cacheCreateTokens += usage.cacheCreateTokens || 0;
    }
  }

  /**
   * 从记录中提取模型名
   */
  private extractModel(record: TraceRecord): string {
    const body = record.request.body;
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      const m = (body as Record<string, unknown>).model;
      if (typeof m === 'string') {
        return m;
      }
    }
    return 'unknown';
  }

  /**
   * 从记录中提取 Token 用量
   */
  private extractUsage(record: TraceRecord): {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreateTokens: number;
  } | null {
    const body = record.response.body;
    if (!body || typeof body !== 'object') {
      return null;
    }

    const resp = body as Record<string, unknown>;

    // 兼容 Anthropic (input_tokens) 与 OpenAI (prompt_tokens) 两种命名
    const usage = resp.usage as Record<string, unknown> | undefined;
    if (usage) {
      return {
        inputTokens: (usage.input_tokens as number) || (usage.prompt_tokens as number) || 0,
        outputTokens: (usage.output_tokens as number) || (usage.completion_tokens as number) || 0,
        cacheReadTokens: (usage.cache_read_input_tokens as number) || 0,
        cacheCreateTokens: (usage.cache_creation_input_tokens as number) || 0,
      };
    }

    // 从 choices 中提取
    const choices = resp.choices as unknown[] | undefined;
    if (choices && choices.length > 0) {
      const first = choices[0] as Record<string, unknown> | undefined;
      if (first?.usage) {
        const u = first.usage as Record<string, unknown>;
        return {
          inputTokens: (u.prompt_tokens as number) || 0,
          outputTokens: (u.completion_tokens as number) || 0,
          cacheReadTokens: 0,
          cacheCreateTokens: 0,
        };
      }
    }

    return null;
  }

  /**
   * 计算百分位数
   */
  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) {
      return 0;
    }
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
  }

  /**
   * 获取当前统计快照
   */
  getSnapshot(): {
    totalCalls: number;
    totalErrors: number;
    callsByModel: Record<string, number>;
    errorsByModel: Record<string, number>;
    avgLatencyByModel: Record<string, number>;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheReadTokens: number;
    totalCacheCreateTokens: number;
    latencyP50: number;
    latencyP99: number;
  } {
    const sorted = [...this.allDurations].sort((a, b) => a - b);
    const callsByModel: Record<string, number> = {};
    const errorsByModel: Record<string, number> = {};
    const avgLatencyByModel: Record<string, number> = {};

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheReadTokens = 0;
    let totalCacheCreateTokens = 0;

    for (const [model, stats] of this.modelStats) {
      callsByModel[model] = stats.callCount;
      errorsByModel[model] = stats.errorCount;
      avgLatencyByModel[model] = stats.callCount > 0
        ? Math.round(stats.totalDurationMs / stats.callCount)
        : 0;
    }

    for (const [, stats] of this.modelStats) {
      totalInputTokens += stats.inputTokens;
      totalOutputTokens += stats.outputTokens;
      totalCacheReadTokens += stats.cacheReadTokens;
      totalCacheCreateTokens += stats.cacheCreateTokens;
    }

    return {
      totalCalls: this.totalCalls,
      totalErrors: this.totalErrors,
      callsByModel,
      errorsByModel,
      avgLatencyByModel,
      totalInputTokens,
      totalOutputTokens,
      totalCacheReadTokens,
      totalCacheCreateTokens,
      latencyP50: this.percentile(sorted, 50),
      latencyP99: this.percentile(sorted, 99),
    };
  }

  /**
   * 重置统计
   */
  reset(): void {
    this.modelStats.clear();
    this.allDurations = [];
    this.totalCalls = 0;
    this.totalErrors = 0;
  }
}
