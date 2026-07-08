/**
 * SessionResetPolicy 会话重置策略
 * 对标 Hermes gateway/session.py，支持 3 种重置策略：
 * 按时间（N 分钟无活动）、按轮次（N 轮对话）、手动
 */

import { EventEmitter } from 'events';
import type {
  ChannelSession,
  ChannelSessionStatus,
} from './ChannelSessionManager';

/**
 * 重置策略类型
 */
export type ResetPolicyType = 'time_based' | 'turn_based' | 'manual';

/**
 * 重置策略配置
 */
export interface ResetPolicyConfig {
  /** 策略类型 */
  type: ResetPolicyType;

  /** 按时间策略：无活动 N 分钟后重置（单位：毫秒），默认 30 分钟 */
  idleTimeoutMs?: number;

  /** 按轮次策略：每 N 轮对话后重置，默认 50 轮 */
  maxTurns?: number;

  /** 重置后是否保留配置元数据 */
  preserveMetadata?: boolean;
}

/**
 * 重置评估结果
 */
export interface ResetEvaluation {
  /** 是否需要重置 */
  shouldReset: boolean;

  /** 触发重置的策略类型 */
  policyType: ResetPolicyType;

  /** 触发原因 */
  reason: string;

  /** 当前会话状态快照 */
  sessionSnapshot: {
    id: string;
    status: ChannelSessionStatus;
    lastActivityAt: number;
    messageCount: number;
  };
}

/**
 * 重置事件
 */
export interface ResetEvent {
  sessionId: string;
  policyType: ResetPolicyType;
  reason: string;
  timestamp: number;
  preservedMetadata?: Record<string, unknown>;
}

/**
 * 会话重置策略管理器
 * 支持 3 种策略：
 * - time_based: 按时间（N 分钟无活动自动重置）
 * - turn_based: 按轮次（N 轮对话后自动重置）
 * - manual: 手动重置（仅由外部触发）
 */
export class SessionResetPolicy extends EventEmitter {
  /** 策略配置 */
  private config: ResetPolicyConfig;

  /** 轮次计数器（按渠道+对话ID 分组） */
  private turnCounters: Map<string, number> = new Map();

  /** 上次重置时间（按会话ID） */
  private lastResetTimes: Map<string, number> = new Map();

  /** 定时检查定时器 */
  private checkTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * @param config 重置策略配置
   */
  constructor(config: ResetPolicyConfig) {
    super();

    this.config = {
      type: config.type,
      idleTimeoutMs: config.idleTimeoutMs ?? 30 * 60 * 1000,
      maxTurns: config.maxTurns ?? 50,
      preserveMetadata: config.preserveMetadata ?? true,
    };
  }

  /**
   * 获取当前策略配置（返回副本）
   */
  getConfig(): ResetPolicyConfig {
    return { ...this.config };
  }

  /**
   * 更新策略配置
   */
  updateConfig(partial: Partial<ResetPolicyConfig>): void {
    if (partial.type !== undefined) {
      this.config.type = partial.type;
    }
    if (partial.idleTimeoutMs !== undefined) {
      this.config.idleTimeoutMs = partial.idleTimeoutMs;
    }
    if (partial.maxTurns !== undefined) {
      this.config.maxTurns = partial.maxTurns;
    }
    if (partial.preserveMetadata !== undefined) {
      this.config.preserveMetadata = partial.preserveMetadata;
    }
  }

  /**
   * 评估会话是否需要重置
   *
   * @param session 当前会话
   * @returns 评估结果
   */
  evaluate(session: ChannelSession): ResetEvaluation {
    switch (this.config.type) {
      case 'time_based':
        return this.evaluateTimeBased(session);
      case 'turn_based':
        return this.evaluateTurnBased(session);
      case 'manual':
        return {
          shouldReset: false,
          policyType: 'manual',
          reason: '手动策略，等待外部触发',
          sessionSnapshot: this.takeSnapshot(session),
        };
    }
  }

  /**
   * 执行重置
   * 重置轮次计数器并记录重置时间
   *
   * @param sessionId 会话ID
   * @param conversationKey 会话的渠道+对话标识（用于重置轮次计数）
   * @returns 重置事件
   */
  reset(sessionId: string, conversationKey: string): ResetEvent {
    this.lastResetTimes.set(sessionId, Date.now());
    this.turnCounters.set(conversationKey, 0);

    const event: ResetEvent = {
      sessionId,
      policyType: this.config.type,
      reason: this.getResetReason(),
      timestamp: Date.now(),
    };

    if (this.config.preserveMetadata) {
      event.preservedMetadata = {};
    }

    this.emit('session:reset', event);

    return event;
  }

  /**
   * 记录一轮对话
   * 按轮次策略时使用，累计轮次计数
   *
   * @param conversationKey 渠道+对话标识
   */
  recordTurn(conversationKey: string): void {
    const current = this.turnCounters.get(conversationKey) ?? 0;
    this.turnCounters.set(conversationKey, current + 1);
  }

  /**
   * 获取指定对话的当前轮次
   */
  getTurnCount(conversationKey: string): number {
    return this.turnCounters.get(conversationKey) ?? 0;
  }

  /**
   * 重置指定对话的轮次计数
   */
  resetTurnCount(conversationKey: string): void {
    this.turnCounters.set(conversationKey, 0);
  }

  /**
   * 启动定时检查（仅 time_based 策略有效）
   * 按指定间隔检查所有会话是否超时
   *
   * @param checkIntervalMs 检查间隔（毫秒），默认 60 秒
   * @param sessionProvider 提供当前活跃会话列表的回调函数
   */
  startAutoCheck(
    checkIntervalMs: number = 60 * 1000,
    sessionProvider: () => ChannelSession[]
  ): void {
    if (this.checkTimer) {
      return;
    }

    this.checkTimer = setInterval(() => {
      const sessions = sessionProvider();
      for (const session of sessions) {
        const evaluation = this.evaluate(session);
        if (evaluation.shouldReset) {
          const conversationKey = `${session.channelId}:${session.conversationId}`;
          const event = this.reset(session.id, conversationKey);
          this.emit('session:auto_reset', event);
        }
      }
    }, checkIntervalMs);

    this.emit('policy:auto_check_started', {
      intervalMs: checkIntervalMs,
      policyType: this.config.type,
    });
  }

  /**
   * 停止定时检查
   */
  stopAutoCheck(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;

      this.emit('policy:auto_check_stopped', { timestamp: Date.now() });
    }
  }

  /**
   * 获取上次重置时间
   */
  getLastResetTime(sessionId: string): number | undefined {
    return this.lastResetTimes.get(sessionId);
  }

  /**
   * 获取所有会话的上次重置时间
   */
  getAllResetTimes(): Map<string, number> {
    return new Map(this.lastResetTimes);
  }

  /**
   * 移除会话的重置记录
   */
  removeResetRecord(sessionId: string): boolean {
    return this.lastResetTimes.delete(sessionId);
  }

  /**
   * 清理所有状态
   */
  dispose(): void {
    this.stopAutoCheck();
    this.turnCounters.clear();
    this.lastResetTimes.clear();
    this.removeAllListeners();
  }

  /**
   * 基于时间评估是否需要重置
   */
  private evaluateTimeBased(session: ChannelSession): ResetEvaluation {
    const now = Date.now();
    const inactiveDuration = now - session.lastActivityAt;
    const idleTimeout = this.config.idleTimeoutMs!;

    if (session.status === 'closed') {
      return {
        shouldReset: false,
        policyType: 'time_based',
        reason: '会话已关闭，无需重置',
        sessionSnapshot: this.takeSnapshot(session),
      };
    }

    if (inactiveDuration >= idleTimeout) {
      return {
        shouldReset: true,
        policyType: 'time_based',
        reason: `会话无活动超过 ${Math.round(idleTimeout / 1000 / 60)} 分钟`,
        sessionSnapshot: this.takeSnapshot(session),
      };
    }

    return {
      shouldReset: false,
      policyType: 'time_based',
      reason: `会话仍活跃（${Math.round(inactiveDuration / 1000)} 秒无活动，阈值 ${Math.round(idleTimeout / 1000 / 60)} 分钟）`,
      sessionSnapshot: this.takeSnapshot(session),
    };
  }

  /**
   * 基于轮次评估是否需要重置
   */
  private evaluateTurnBased(session: ChannelSession): ResetEvaluation {
    const conversationKey = `${session.channelId}:${session.conversationId}`;
    const currentTurns = this.turnCounters.get(conversationKey) ?? 0;
    const maxTurns = this.config.maxTurns!;

    if (currentTurns >= maxTurns) {
      return {
        shouldReset: true,
        policyType: 'turn_based',
        reason: `对话已达 ${currentTurns} 轮（阈值 ${maxTurns} 轮）`,
        sessionSnapshot: this.takeSnapshot(session),
      };
    }

    return {
      shouldReset: false,
      policyType: 'turn_based',
      reason: `当前 ${currentTurns}/${maxTurns} 轮`,
      sessionSnapshot: this.takeSnapshot(session),
    };
  }

  /**
   * 获取重置原因描述
   */
  private getResetReason(): string {
    switch (this.config.type) {
      case 'time_based':
        return `无活动超时重置（阈值 ${Math.round(this.config.idleTimeoutMs! / 1000 / 60)} 分钟）`;
      case 'turn_based':
        return `轮次上限重置（阈值 ${this.config.maxTurns!} 轮）`;
      case 'manual':
        return '手动触发重置';
    }
  }

  /**
   * 拍摄会话快照
   */
  private takeSnapshot(
    session: ChannelSession
  ): ResetEvaluation['sessionSnapshot'] {
    return {
      id: session.id,
      status: session.status,
      lastActivityAt: session.lastActivityAt,
      messageCount: session.messageCount,
    };
  }
}
