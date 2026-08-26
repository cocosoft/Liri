/**
 * code_run 轮次计数（CM-1：代码内容无状态 + 轮次计数有状态且持久化）
 *
 * 设计（六轮评审 P1-5/P2-7）：
 *   - 代码内容无状态：每次调用全量提交，round 仅日志标记
 *   - 轮次计数有状态：sessionId 维度计数器，超限拒绝 code_run 并提示降级
 *   - 持久化：计数器随事件落盘（code_run 事件载荷含 round 序号），
 *     恢复时从事件流重建——首版提供 setBaseline 接口，由 CM-5 接线后从事件流重建。
 */

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools:CodeRunner:rounds');

/** 默认轮次上限（hard limit；soft limit 由调用方 prompt 约束） */
const DEFAULT_MAX_ROUNDS = 3;

export class RoundTracker {
  private readonly counts = new Map<string, number>();
  private readonly maxRounds: number;

  constructor(maxRounds: number = DEFAULT_MAX_ROUNDS) {
    this.maxRounds = maxRounds;
  }

  /** 当前已用轮次 */
  current(sessionId: string): number {
    return this.counts.get(sessionId) ?? 0;
  }

  /** 是否已有记录（用于惰性重建：仅首次调用时从事件流重建基线） */
  has(sessionId: string): boolean {
    return this.counts.has(sessionId);
  }

  /** 是否已超限 */
  isExceeded(sessionId: string): boolean {
    return this.current(sessionId) >= this.maxRounds;
  }

  /** 消耗一轮（调用 code_run 时递增） */
  consume(sessionId: string): number {
    const next = this.current(sessionId) + 1;
    this.counts.set(sessionId, next);
    logger.info('code_run round consumed', {
      sessionId,
      round: next,
      maxRounds: this.maxRounds,
    });
    return next;
  }

  /** 重置（会话结束/手动重置） */
  reset(sessionId: string): void {
    this.counts.delete(sessionId);
  }

  /** 从事件流重建基线（CM-5 接线：code_run 事件载荷含 round 序号） */
  setBaseline(sessionId: string, usedRounds: number): void {
    this.counts.set(sessionId, Math.max(0, usedRounds));
  }
}

/** 全局单例（CodeRunnerTool 使用） */
export const roundTracker = new RoundTracker();
