/**
 * 任务生命周期标准接口
 *
 * 定义 create → start → progress → finalize 四个核心阶段。
 * 所有 BaseTask 子类应遵循此契约。
 */

import { TaskStatus } from './types';

/** 生命周期阶段 */
export type LifecyclePhase =
  | 'created' // 任务已注册，等待启动
  | 'started' // 任务已开始执行
  | 'progress' // 任务执行中（可多次）
  | 'finalized'; // 任务已终止（成功/失败/取消）

/** 生命周期事件 */
export interface LifecycleEvent {
  phase: LifecyclePhase;
  status: TaskStatus;
  timestamp: number;
  detail?: string;
}

/** 任务需实现的生命周期方法 */
export interface ILifecycleTask {
  /** 创建/注册任务（已通过 TaskRegistry.register 完成） */
  created?(): Promise<void>;

  /** 启动任务执行 */
  start(): Promise<void>;

  /** 获取当前生命周期事件历史 */
  getLifecycleHistory(): LifecycleEvent[];

  /** 获取当前阶段 */
  getCurrentPhase(): LifecyclePhase;
}

/**
 * 生命周期事件记录器
 *
 * 用于追踪任务从创建到终结的完整过程。
 */
export class LifecycleTracker {
  private events: LifecycleEvent[] = [];
  private currentPhase: LifecyclePhase = 'created';

  record(phase: LifecyclePhase, status: TaskStatus, detail?: string): void {
    this.events.push({ phase, status, timestamp: Date.now(), detail });
    this.currentPhase = phase;
  }

  getHistory(): LifecycleEvent[] {
    return [...this.events];
  }

  getCurrentPhase(): LifecyclePhase {
    return this.currentPhase;
  }

  /** 计算总耗时（从 created 到 finalized） */
  getTotalDurationMs(): number | null {
    const first = this.events[0];
    const last = this.events[this.events.length - 1];
    if (!first || !last) return null;
    return last.timestamp - first.timestamp;
  }

  /** 计算各阶段耗时 */
  getPhaseDurations(): Partial<Record<LifecyclePhase, number>> {
    const result: Partial<Record<LifecyclePhase, number>> = {};
    for (let i = 1; i < this.events.length; i++) {
      const prev = this.events[i - 1]!;
      const curr = this.events[i]!;
      if (prev.phase !== curr.phase) {
        result[prev.phase] =
          (result[prev.phase] ?? 0) + (curr.timestamp - prev.timestamp);
      }
    }
    return result;
  }
}
