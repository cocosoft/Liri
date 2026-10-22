/**
 * 统计引擎
 *
 * 按模型的实时内存统计。
 * 支持调用次数、Token用量、延迟分位数、错误数等。
 *
 * 参考：claude-tap 的 TraceWriter 统计 (Python 实现)
 */

import type { TraceRecord, StatsSnapshot } from '../types';

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

/** 单个身份的统计桶（本地身份 / 无归属记录统一落在 `''` 桶） */
interface StatsBucket {
  modelStats: Map<string, ModelStats>;
  allDurations: number[];
  totalCalls: number;
  totalErrors: number;
}

/**
 * 统计引擎
 *
 * **按身份分桶**（多租户 P3）：`/v1/trace/stats` 此前是进程级合计，任一身份都能看到
 * 所有人的 token 消耗。桶键取记录的 `ownerKey`（本地身份 / 无归属 ⇒ `''`），
 * 读侧只回**当前身份**的桶 ⇒ 桌面/CLI 仍只读 `''` 桶，数值与改造前逐字一致。
 */
export class StatsEngine {
  private buckets: Map<string, StatsBucket> = new Map();

  /** 取（必要时创建）指定归属的统计桶 */
  private bucketOf(ownerKey: string): StatsBucket {
    let bucket = this.buckets.get(ownerKey);
    if (!bucket) {
      bucket = {
        modelStats: new Map(),
        allDurations: [],
        totalCalls: 0,
        totalErrors: 0,
      };
      this.buckets.set(ownerKey, bucket);
    }
    return bucket;
  }

  /**
   * 记录一次调用统计
   * @param record 录制记录
   */
  record(record: TraceRecord): void {
    // v5 方案 3.4：pending 记录不计入统计（调用数/延迟/token），
    // 否则 pending+completed 各计一次导致 totalCalls/分位数翻倍。
    if (record.phase === 'pending') {
      return;
    }
    const bucket = this.bucketOf(record.ownerKey ?? '');
    bucket.totalCalls++;
    bucket.allDurations.push(record.durationMs);

    const model = this.extractModel(record);
    let stats = bucket.modelStats.get(model);
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
      bucket.modelStats.set(model, stats);
    }

    stats.callCount++;
    stats.totalDurationMs += record.durationMs;
    stats.durations.push(record.durationMs);

    if (record.error || record.response.status >= 400) {
      stats.errorCount++;
      bucket.totalErrors++;
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
        inputTokens:
          (usage.input_tokens as number) ||
          (usage.prompt_tokens as number) ||
          0,
        outputTokens:
          (usage.output_tokens as number) ||
          (usage.completion_tokens as number) ||
          0,
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
   * @param ownerKey 归属身份键（本地身份 / 无归属 ⇒ 省略即 `''` 桶）
   */
  getSnapshot(ownerKey = ''): StatsSnapshot {
    const bucket = this.buckets.get(ownerKey);
    return this.computeSnapshot(bucket ? [bucket] : []);
  }

  /**
   * 获取**全量**聚合快照（跨身份合计）。
   *
   * 只给宿主侧诊断用（`LiveViewServer` 的 `/stats` 展示的是进程内全部流量），
   * **不要**用于任何按身份返回的 HTTP 面 —— 那里必须走 `getSnapshot(ownerKey)`。
   */
  getAggregateSnapshot(): StatsSnapshot {
    return this.computeSnapshot([...this.buckets.values()]);
  }

  /**
   * 删除租户后丢弃该归属的统计桶（多租户 P5）。
   *
   * 不丢的后果：同名新租户的 `/v1/trace/stats` 一上来就带上"上一世"的调用数、错误数与
   * token 消耗。本地桶键恒 `''`、其他租户前缀不同 ⇒ 零影响。
   *
   * 只管**进程内累计**：落盘的 trace 文件与 `TraceStore` 索引不在本方法内。
   *
   * @returns 丢弃的桶数
   */
  forgetForTenant(tenantId: string): number {
    const prefix = `${tenantId}:`;
    let dropped = 0;
    for (const key of [...this.buckets.keys()]) {
      if (!key.startsWith(prefix)) continue;
      this.buckets.delete(key);
      dropped += 1;
    }
    return dropped;
  }

  /** 把若干桶合并成一份快照（`getSnapshot` / `getAggregateSnapshot` 的共用实现） */
  private computeSnapshot(buckets: StatsBucket[]): StatsSnapshot {
    const callsByModel: Record<string, number> = {};
    const errorsByModel: Record<string, number> = {};
    const totalDurationByModel: Record<string, number> = {};
    const durations: number[] = [];

    let totalCalls = 0;
    let totalErrors = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheReadTokens = 0;
    let totalCacheCreateTokens = 0;

    for (const bucket of buckets) {
      totalCalls += bucket.totalCalls;
      totalErrors += bucket.totalErrors;
      durations.push(...bucket.allDurations);
      for (const [model, stats] of bucket.modelStats) {
        callsByModel[model] = (callsByModel[model] ?? 0) + stats.callCount;
        errorsByModel[model] = (errorsByModel[model] ?? 0) + stats.errorCount;
        totalDurationByModel[model] =
          (totalDurationByModel[model] ?? 0) + stats.totalDurationMs;
        totalInputTokens += stats.inputTokens;
        totalOutputTokens += stats.outputTokens;
        totalCacheReadTokens += stats.cacheReadTokens;
        totalCacheCreateTokens += stats.cacheCreateTokens;
      }
    }

    const avgLatencyByModel: Record<string, number> = {};
    for (const [model, total] of Object.entries(totalDurationByModel)) {
      const calls = callsByModel[model] ?? 0;
      avgLatencyByModel[model] = calls > 0 ? Math.round(total / calls) : 0;
    }

    const sorted = durations.sort((a, b) => a - b);
    return {
      totalCalls,
      totalErrors,
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
   * 重置统计（清空**所有身份**的桶）
   */
  reset(): void {
    this.buckets.clear();
  }
}
