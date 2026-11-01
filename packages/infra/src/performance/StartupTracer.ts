/**
 * 轻量级启动性能追踪器
 * traceStart/traceEnd 委托给 StartupProfiler，使 PerformanceMonitor 的 getOnDemandLoadStats()
 * 能通过 getPhaseTimes() 读取到追踪的 on_demand 阶段耗时
 */

import {
  profilePhaseStart,
  profilePhaseEnd,
  getPhaseTimes,
} from './StartupProfiler';

/**
 * 追踪点数据结构
 */
export interface TracePoint {
  phase: string;
  startTime: number;
  endTime: number | null;
  duration: number | null;
}

/**
 * 启动性能追踪器
 */
export class StartupTracer {
  private points: TracePoint[] = [];
  private ongoing: Map<string, number> = new Map();

  /**
   * 记录阶段开始。若同一阶段已开始，将重新开始计时
   */
  traceStart(phase: string): void {
    if (this.ongoing.has(phase)) {
      const idx = this.points.findIndex(
        (p) => p.phase === phase && p.endTime === null
      );
      if (idx !== -1) {
        this.points.splice(idx, 1);
      }
      this.ongoing.delete(phase);
    }
    profilePhaseStart(phase);
    const startTime = performance.now();
    this.ongoing.set(phase, startTime);
    this.points.push({ phase, startTime, endTime: null, duration: null });
  }

  /**
   * 记录阶段结束
   */
  traceEnd(phase: string): number {
    if (!this.ongoing.has(phase)) {
      return -1;
    }
    profilePhaseEnd(phase);
    const endTime = performance.now();
    const startTime = this.ongoing.get(phase)!;
    const duration = endTime - startTime;

    const point = this.points.find(
      (p) => p.phase === phase && p.endTime === null
    );
    if (point) {
      point.endTime = endTime;
      point.duration = duration;
    }
    this.ongoing.delete(phase);
    return duration;
  }

  /**
   * 获取所有追踪点（按开始顺序）
   */
  getTracePoints(): TracePoint[] {
    return [...this.points];
  }

  /**
   * 获取指定阶段的耗时
   */
  getPhaseDuration(phase: string): number | null {
    const point = this.points.find((p) => p.phase === phase);
    if (!point) return null;
    return point.duration ?? null;
  }

  /**
   * 获取性能报告
   */
  getReport(): {
    points: TracePoint[];
    totalDuration: number;
    phaseSummary: Array<{ phase: string; duration: number }>;
  } {
    const completed = this.points.filter((p) => p.duration !== null);
    const totalDuration = completed.reduce(
      (sum, p) => sum + (p.duration ?? 0),
      0
    );
    const phaseSummary = [...completed]
      .map((p) => ({ phase: p.phase, duration: p.duration! }))
      .sort((a, b) => b.duration - a.duration);
    return {
      points: [...this.points],
      totalDuration,
      phaseSummary,
    };
  }

  /**
   * 清除所有追踪数据
   */
  reset(): void {
    this.points = [];
    this.ongoing.clear();
  }
}

/**
 * 全局单例
 */
export const startupTracer = new StartupTracer();
