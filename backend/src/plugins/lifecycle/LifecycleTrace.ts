/**
 * LifecycleTrace 生命周期追踪器
 * 对标 OpenClaw 的 trace/，记录和追踪插件的生命周期变化
 */
import { EventEmitter } from 'node:events';

/**
 * 追踪事件级别
 */
export type TraceLevel = 'info' | 'warn' | 'error' | 'debug';

/**
 * 追踪事件
 */
export interface TraceEvent {
  id: string;
  pluginName: string;
  level: TraceLevel;
  message: string;
  fromState?: string;
  toState?: string;
  timestamp: number;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

/**
 * 追踪过滤器
 */
export interface TraceFilter {
  pluginName?: string;
  level?: TraceLevel;
  fromState?: string;
  toState?: string;
  since?: number;
  until?: number;
}

/**
 * 追踪报告
 */
export interface TraceReport {
  pluginName: string;
  totalEvents: number;
  errorCount: number;
  warnCount: number;
  avgDurationMs: number;
  transitions: Array<{ from: string; to: string; count: number }>;
  firstEvent: number;
  lastEvent: number;
}

/**
 * 生命周期追踪器
 */
export class LifecycleTrace extends EventEmitter {
  private events: TraceEvent[] = [];
  private maxEvents: number = 1000;
  private counter: number = 0;

  /**
   * 记录追踪事件
   */
  record(event: Omit<TraceEvent, 'id' | 'timestamp'>): TraceEvent {
    const traceEvent: TraceEvent = {
      id: `trace_${++this.counter}`,
      timestamp: Date.now(),
      ...event,
    };

    this.events.push(traceEvent);

    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }

    this.emit('trace:event', traceEvent);

    return traceEvent;
  }

  /**
   * 记录状态转换
   */
  recordTransition(pluginName: string, fromState: string, toState: string, durationMs?: number): TraceEvent {
    return this.record({
      pluginName,
      level: 'info',
      message: `${fromState} -> ${toState}`,
      fromState,
      toState,
      durationMs,
    });
  }

  /**
   * 记录错误
   */
  recordError(pluginName: string, message: string, metadata?: Record<string, unknown>): TraceEvent {
    return this.record({
      pluginName,
      level: 'error',
      message,
      metadata,
    });
  }

  /**
   * 记录警告
   */
  recordWarn(pluginName: string, message: string, metadata?: Record<string, unknown>): TraceEvent {
    return this.record({
      pluginName,
      level: 'warn',
      message,
      metadata,
    });
  }

  /**
   * 查询追踪事件
   */
  query(filter?: TraceFilter): TraceEvent[] {
    let results = [...this.events];

    if (filter) {
      if (filter.pluginName) {
        results = results.filter((e) => e.pluginName === filter.pluginName);
      }

      if (filter.level) {
        results = results.filter((e) => e.level === filter.level);
      }

      if (filter.fromState) {
        results = results.filter((e) => e.fromState === filter.fromState);
      }

      if (filter.toState) {
        results = results.filter((e) => e.toState === filter.toState);
      }

      if (filter.since) {
        results = results.filter((e) => e.timestamp >= filter.since!);
      }

      if (filter.until) {
        results = results.filter((e) => e.timestamp <= filter.until!);
      }
    }

    return results;
  }

  /**
   * 生成报告
   */
  generateReport(pluginName: string): TraceReport {
    const pluginEvents = this.events.filter((e) => e.pluginName === pluginName);

    const transitionMap = new Map<string, number>();

    for (const event of pluginEvents) {
      if (event.fromState && event.toState) {
        const key = `${event.fromState}:${event.toState}`;

        transitionMap.set(key, (transitionMap.get(key) || 0) + 1);
      }
    }

    const transitions = Array.from(transitionMap.entries()).map(([key, count]) => {
      const [from, to] = key.split(':');

      return { from, to, count };
    });

    const durations = pluginEvents.filter((e) => e.durationMs !== undefined).map((e) => e.durationMs!);

    const avgDurationMs = durations.length > 0
      ? durations.reduce((sum, d) => sum + d, 0) / durations.length
      : 0;

    return {
      pluginName,
      totalEvents: pluginEvents.length,
      errorCount: pluginEvents.filter((e) => e.level === 'error').length,
      warnCount: pluginEvents.filter((e) => e.level === 'warn').length,
      avgDurationMs,
      transitions,
      firstEvent: pluginEvents.length > 0 ? pluginEvents[0].timestamp : 0,
      lastEvent: pluginEvents.length > 0 ? pluginEvents[pluginEvents.length - 1].timestamp : 0,
    };
  }

  /**
   * 获取指定插件的追踪
   */
  getByPlugin(pluginName: string): TraceEvent[] {
    return this.events.filter((e) => e.pluginName === pluginName);
  }

  /**
   * 获取错误事件
   */
  getErrors(): TraceEvent[] {
    return this.events.filter((e) => e.level === 'error');
  }

  /**
   * 设置最大事件数
   */
  setMaxEvents(max: number): void {
    this.maxEvents = max;

    if (this.events.length > max) {
      this.events = this.events.slice(-max);
    }
  }

  /**
   * 清除追踪
   */
  clear(): void {
    this.events = [];
  }

  /**
   * 获取统计
   */
  getStats(): { total: number; errors: number; warnings: number; uniquePlugins: number } {
    const pluginSet = new Set(this.events.map((e) => e.pluginName));

    return {
      total: this.events.length,
      errors: this.events.filter((e) => e.level === 'error').length,
      warnings: this.events.filter((e) => e.level === 'warn').length,
      uniquePlugins: pluginSet.size,
    };
  }
}

export const lifecycleTrace = new LifecycleTrace();
