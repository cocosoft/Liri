// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * DrainManager — 统一优雅排空协议（P3-3，对标 Hermes drain_control write_drain_request / drain_requested）
 *
 * 集中管理"排空状态"：系统关闭/停机时请求排空 → 停止接收新任务、
 * 等待进行中任务完成；各方通过 isDraining() 查询统一状态（不再各自为政）。
 *
 * 语义（对标 Hermes）：
 *   - requestDrain(reason)：请求排空（停止启动新任务，进行中任务继续完成）
 *   - cancelDrain()：取消排空（恢复接收新任务）
 *   - isDraining() / getState()：查询排空状态
 *   - 事件：'drain-requested' / 'drain-cancelled'（监听方可优雅收尾）
 */

import { EventEmitter } from 'events';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('tasks:drainManager');

/** 排空状态 */
export interface DrainState {
  draining: boolean;
  /** 排空原因（关闭/升级/维护…） */
  reason?: string;
  /** 排空请求时间戳 */
  requestedAt?: number;
}

/** 排空事件 */
export type DrainEventType = 'drain-requested' | 'drain-cancelled';

/**
 * 统一排空管理器（单例；无状态存储，进程内协议）
 */
export class DrainManager extends EventEmitter {
  private static _instance: DrainManager | null = null;

  /** 获取全局单例 */
  static getInstance(): DrainManager {
    if (!DrainManager._instance) {
      DrainManager._instance = new DrainManager();
    }
    return DrainManager._instance;
  }

  private state: DrainState = { draining: false };

  /** 请求排空（幂等：已排空中再次请求仅更新原因） */
  requestDrain(reason: string): void {
    const wasDraining = this.state.draining;
    this.state = { draining: true, reason, requestedAt: Date.now() };
    if (!wasDraining) {
      logger.warn('系统排空请求', { reason });
      this.emit('drain-requested' as DrainEventType, this.state);
    }
  }

  /** 取消排空（幂等） */
  cancelDrain(): void {
    if (!this.state.draining) return;
    this.state = { draining: false };
    logger.info('系统排空已取消');
    this.emit('drain-cancelled' as DrainEventType, this.state);
  }

  /** 是否处于排空中 */
  isDraining(): boolean {
    return this.state.draining;
  }

  /** 当前排空状态快照 */
  getState(): DrainState {
    return { ...this.state };
  }

  /** 排空原因（未排空返回 undefined） */
  getReason(): string | undefined {
    return this.state.draining ? this.state.reason : undefined;
  }
}

/** 全局单例（与 taskOrchestrator 等单例同构） */
export const drainManager = DrainManager.getInstance();
