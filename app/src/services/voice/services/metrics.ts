/**
 * TTS 性能可观测性（方案 21）
 *
 * 提供 TTS 合成、播放等关键路径的性能指标采集，
 * 用法：在生命周期关键点调用 startHook / endHook，
 * 采集器自动计算耗时并输出 P50/P95 结构化日志。
 *
 * 埋点位置由 MetricsHook 枚举定义，统一管理。
 */

import { Logger, getOTelMetrics } from '@modules/monitoring';

const logger = new Logger({ module: 'voice:metrics' });

/** OTel 直方图：记录各埋点耗时分布 */
const otelMetrics = getOTelMetrics();

/** 埋点 Hook 枚举（统一管理所有埋点位置） */
export enum MetricsHook {
  /** TTS 合成开始 / 结束 */
  TTS_SYNTHESIS = 'tts_synthesis',
  /** PCM 播放开始 / 结束 */
  PCM_PLAYBACK = 'pcm_playback',
  /** 文本预处理 */
  TEXT_PREPROCESS = 'text_preprocess',
  /** 队列处理 */
  QUEUE_PROCESS = 'queue_process',
  /** 缓存查询 */
  CACHE_LOOKUP = 'cache_lookup',
  /** Provider 故障转移 */
  FAILOVER = 'failover',
  /** 熔断器状态变更 */
  CIRCUIT_BREAKER = 'circuit_breaker',
}

/** 指标收集项 */
interface MetricsEntry {
  hook: MetricsHook;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

/** 性能快照（供监控面板展示） */
export interface TTSMetricsSnapshot {
  /** Provider 健康评分（0-100） */
  providerHealth: Record<string, number>;
  /** 各埋点平均耗时（ms） */
  avgLatencies: Partial<Record<MetricsHook, number>>;
  /** 各埋点 P95 耗时（ms） */
  p95Latencies: Partial<Record<MetricsHook, number>>;
  /** 采集时间戳 */
  timestamp: number;
}

/**
 * TTSMetricsCollector — TTS 性能指标采集器（方案 21）
 *
 * 使用方法：
 * ```ts
 * const collector = new TTSMetricsCollector();
 * collector.startHook(MetricsHook.TTS_SYNTHESIS, { voice: 'zh-CN' });
 * // ... 执行 TTS 合成 ...
 * collector.endHook(MetricsHook.TTS_SYNTHESIS);
 * // 自动输出结构化日志
 * ```
 */
export class TTSMetricsCollector {
  /** 当前活跃的指标条目（支持嵌套） */
  private activeEntries = new Map<string, MetricsEntry>();
  /** 历史耗时记录（用于计算 P50/P95） */
  private latencies = new Map<MetricsHook, number[]>();
  /** 最大保留记录数 */
  private readonly maxRecords = 1000;
  /** Provider 健康评分 */
  private healthScores = new Map<
    string,
    { success: number; failure: number }
  >();

  /**
   * startHook — 开始记录某埋点的耗时
   *
   * @param hook 埋点枚举
   * @param metadata 元数据（如 voice, textLength 等）
   */
  startHook(hook: MetricsHook, metadata?: Record<string, unknown>): void {
    const key = `${hook}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.activeEntries.set(key, {
      hook,
      startTime: performance.now(),
      metadata,
    });
  }

  /**
   * endHook — 结束记录某埋点的耗时
   *
   * 自动计算耗时并追加到历史记录，输出结构化日志。
   *
   * @param hook 埋点枚举
   */
  endHook(hook: MetricsHook): void {
    const now = performance.now();

    // 查找该埋点最晚开始的活跃条目
    let targetKey: string | undefined;
    let targetEntry: MetricsEntry | undefined;

    for (const [key, entry] of this.activeEntries) {
      if (entry.hook === hook && !entry.endTime) {
        if (!targetEntry || entry.startTime > targetEntry.startTime) {
          targetKey = key;
          targetEntry = entry;
        }
      }
    }

    if (!targetKey || !targetEntry) {
      logger.warn('TTSMetrics · 未找到匹配的埋点开始记录', { hook });
      return;
    }

    targetEntry.endTime = now;
    targetEntry.durationMs = now - targetEntry.startTime;
    this.activeEntries.delete(targetKey);

    // 记录耗时
    const hookLatencies = this.latencies.get(hook) || [];
    hookLatencies.push(targetEntry.durationMs);
    if (hookLatencies.length > this.maxRecords) {
      hookLatencies.shift();
    }
    this.latencies.set(hook, hookLatencies);

    // 输出结构化日志
    logger.info('TTSMetrics', {
      hook,
      durationMs: Math.round(targetEntry.durationMs * 100) / 100,
      metadata: targetEntry.metadata,
    });

    // 上报 OTel 直方图
    otelMetrics.recordHistogram(
      'voice.tts.duration_ms',
      targetEntry.durationMs,
      {
        hook,
      }
    );
  }

  /**
   * recordProviderResult — 记录 Provider 调用结果（方案 21）
   *
   * @param provider Provider 名
   * @param success 是否成功
   */
  recordProviderResult(provider: string, success: boolean): void {
    const record = this.healthScores.get(provider) ?? {
      success: 0,
      failure: 0,
    };
    if (success) {
      record.success++;
    } else {
      record.failure++;
    }
    this.healthScores.set(provider, record);

    // 上报 OTel 计数器
    otelMetrics.incrementCounter('voice.tts.provider.result', 1, {
      provider,
      result: success ? 'success' : 'failure',
    });
  }

  /**
   * calculateHealthScore — 计算指定 Provider 的健康评分（方案 21）
   *
   * 基于成功率计算 0-100 的评分。
   * 最近 100 次调用中成功率 >= 95% 为 100 分，
   * 成功率 0% 为 0 分。
   *
   * @param provider Provider 名
   * @returns 健康评分（0-100）
   */
  calculateHealthScore(provider: string): number {
    const record = this.healthScores.get(provider);
    if (!record || record.success + record.failure === 0) {
      return 100; // 无数据视为健康
    }

    const total = record.success + record.failure;
    const rate = record.success / total;
    return Math.round(rate * 100);
  }

  /**
   * getPercentile — 计算指定百分位数（方案 21）
   *
   * @param hook 埋点枚举
   * @param percentile 百分位（如 50 = P50, 95 = P95）
   * @returns 百分位耗时（ms），无数据返回 0
   */
  getPercentile(hook: MetricsHook, percentile: number): number {
    const hookLatencies = this.latencies.get(hook);
    if (!hookLatencies || hookLatencies.length === 0) return 0;

    const sorted = [...hookLatencies].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  /**
   * getSnapshot — 获取当前性能快照（方案 21 / 方案 18 监控面板）
   *
   * @returns 性能快照
   */
  getSnapshot(): TTSMetricsSnapshot {
    const providerHealth: Record<string, number> = {};
    for (const provider of this.healthScores.keys()) {
      providerHealth[provider] = this.calculateHealthScore(provider);
    }

    const avgLatencies: Partial<Record<MetricsHook, number>> = {};
    const p95Latencies: Partial<Record<MetricsHook, number>> = {};

    for (const [hook, values] of this.latencies) {
      if (values.length > 0) {
        avgLatencies[hook] =
          Math.round(
            (values.reduce((a, b) => a + b, 0) / values.length) * 100
          ) / 100;
        p95Latencies[hook] =
          Math.round(this.getPercentile(hook, 95) * 100) / 100;
      }
    }

    return {
      providerHealth,
      avgLatencies,
      p95Latencies,
      timestamp: Date.now(),
    };
  }

  /**
   * reset — 清空所有数据
   */
  reset(): void {
    this.activeEntries.clear();
    this.latencies.clear();
    this.healthScores.clear();
  }
}
