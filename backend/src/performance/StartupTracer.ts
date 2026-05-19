/**
 * 轻量级性能追踪公共 API
 * 提供统一的 start/stop/report 接口
 * 不依赖环境变量，可在生产环境和测试中使用
 */

export interface TracePoint {
  phase: string;
  startTime: number;
  endTime: number | null;
  duration: number | null;
}

export interface TraceReport {
  totalDuration: number;
  points: TracePoint[];
  phaseSummary: Array<{
    phase: string;
    duration: number;
    ratio: number;
  }>;
}

export class StartupTracer {
  private points: Map<string, TracePoint>;
  private startOrder: string[];
  private globalStart: number;

  constructor() {
    this.points = new Map();
    this.startOrder = [];
    this.globalStart = performance.now();
  }

  /** 标记阶段开始 */
  traceStart(phase: string): void {
    if (this.points.has(phase)) {
      // 如果已有同名阶段且未结束，先结束它
      const existing = this.points.get(phase)!;
      if (existing.endTime === null) {
        existing.endTime = performance.now();
        existing.duration = existing.endTime - existing.startTime;
      }
    }

    this.points.set(phase, {
      phase,
      startTime: performance.now(),
      endTime: null,
      duration: null,
    });

    if (!this.startOrder.includes(phase)) {
      this.startOrder.push(phase);
    }
  }

  /** 标记阶段结束，返回该阶段耗时（毫秒） */
  traceEnd(phase: string): number {
    const point = this.points.get(phase);
    if (!point) {
      return -1;
    }

    point.endTime = performance.now();
    point.duration = point.endTime - point.startTime;
    return point.duration;
  }

  /** 获取阶段耗时 */
  getPhaseDuration(phase: string): number | null {
    const point = this.points.get(phase);
    if (!point || point.duration === null) {
      return null;
    }
    return point.duration;
  }

  /** 获取所有追踪点 */
  getTracePoints(): TracePoint[] {
    return this.startOrder
      .map((name) => this.points.get(name)!)
      .filter(Boolean);
  }

  /** 生成性能报告 */
  getReport(): TraceReport {
    const points = this.getTracePoints();
    const completedPoints = points.filter((p) => p.duration !== null);
    const totalDuration = Math.max(
      ...completedPoints.map((p) => p.duration!),
      0
    );

    const phaseSummary = completedPoints
      .filter((p) => p.duration! > 0)
      .map((p) => ({
        phase: p.phase,
        duration: p.duration!,
        ratio: totalDuration > 0 ? p.duration! / totalDuration : 0,
      }))
      .sort((a, b) => b.duration - a.duration);

    return { totalDuration, points, phaseSummary };
  }

  /** 重置所有追踪数据 */
  reset(): void {
    this.points.clear();
    this.startOrder = [];
    this.globalStart = performance.now();
  }
}

/** 默认全局单例 */
export const startupTracer = new StartupTracer();
