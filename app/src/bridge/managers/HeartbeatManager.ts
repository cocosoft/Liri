/**
 * 心跳管理器
 * 负责定期发送心跳保持会话活跃，追踪各会话健康状态
 */

import type { BridgeApiClient } from '../types/index.js';
import { bridgeStateStore } from '../state/BridgeStateStore.js';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'bridge:managers:HeartbeatManager', level: LogLevel.INFO });

/**
 * 心跳状态
 */
export type HeartbeatState = 'idle' | 'running' | 'paused';

/**
 * 会话心跳信息
 */
interface SessionHeartbeat {
  /** 工作 ID */
  workId: string;
  /** 会话令牌 */
  sessionToken: string;
  /** 最后心跳时间 */
  lastHeartbeatTime: number;
  /** 连续心跳成功次数 */
  consecutiveSuccesses: number;
  /** 连续心跳失败次数 */
  consecutiveFailures: number;
  /** 租约是否已延长 */
  leaseExtended: boolean;
  /** 服务器端会话状态 */
  serverState: string;
}

/**
 * 心跳统计信息
 */
export interface HeartbeatStats {
  state: HeartbeatState;
  monitoredSessions: number;
  totalHeartbeatsSent: number;
  successfulHeartbeats: number;
  failedHeartbeats: number;
  lastHeartbeatTime: number | null;
}

/**
 * 心跳管理器选项
 */
export interface HeartbeatManagerOptions {
  /** Bridge API 客户端 */
  api: BridgeApiClient;
  /** 环境 ID */
  environmentId: string;
  /** 心跳间隔（毫秒） */
  heartbeatIntervalMs: number;
  /** 错误回调 */
  onError: (error: Error) => void;
  /** 会话过期回调：连续失败超过阈值时触发 */
  onSessionExpired?: (sessionId: string, workId: string) => void;
  /** 中止信号 */
  signal?: AbortSignal;
  /** 连续失败次数阈值（超过此数值视为会话过期） */
  maxConsecutiveFailures?: number;
}

/**
 * 默认连续失败阈值
 */
const DEFAULT_MAX_CONSECUTIVE_FAILURES = 3;

/**
 * 心跳管理器
 * 管理多个会话的心跳发送，自动检测并清理失效会话
 */
export class HeartbeatManager {
  private readonly api: BridgeApiClient;
  private readonly environmentId: string;
  private readonly heartbeatIntervalMs: number;
  private readonly onError: (error: Error) => void;
  private readonly onSessionExpired?: (
    sessionId: string,
    workId: string
  ) => void;
  private readonly signal?: AbortSignal;
  private readonly maxConsecutiveFailures: number;

  private state: HeartbeatState = 'idle';
  private sessions: Map<string, SessionHeartbeat> = new Map();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  private totalHeartbeatsSent = 0;
  private successfulHeartbeats = 0;
  private failedHeartbeats = 0;

  constructor(options: HeartbeatManagerOptions) {
    this.api = options.api;
    this.environmentId = options.environmentId;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs;
    this.onError = options.onError;
    this.onSessionExpired = options.onSessionExpired;
    this.signal = options.signal;
    this.maxConsecutiveFailures =
      options.maxConsecutiveFailures ?? DEFAULT_MAX_CONSECUTIVE_FAILURES;
  }

  /**
   * 获取心跳管理器状态
   */
  getState(): HeartbeatState {
    return this.state;
  }

  /**
   * 获取心跳统计信息
   */
  getStats(): HeartbeatStats {
    return {
      state: this.state,
      monitoredSessions: this.sessions.size,
      totalHeartbeatsSent: this.totalHeartbeatsSent,
      successfulHeartbeats: this.successfulHeartbeats,
      failedHeartbeats: this.failedHeartbeats,
      lastHeartbeatTime: this.getLastHeartbeatTime(),
    };
  }

  /**
   * 开始心跳
   */
  start(): void {
    if (this.state === 'running') return;

    this.state = 'running';
    this.startHeartbeatTimer();
  }

  /**
   * 停止心跳
   */
  stop(): void {
    this.state = 'idle';
    this.clearHeartbeatTimer();
  }

  /**
   * 暂停心跳（可恢复）
   */
  pause(): void {
    if (this.state !== 'running') return;
    this.state = 'paused';
    this.clearHeartbeatTimer();
  }

  /**
   * 恢复心跳
   */
  resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'running';
    this.startHeartbeatTimer();
  }

  /**
   * 添加会话到心跳监控
   */
  addSession(sessionId: string, workId: string, sessionToken: string): void {
    this.sessions.set(sessionId, {
      workId,
      sessionToken,
      lastHeartbeatTime: Date.now(),
      consecutiveSuccesses: 0,
      consecutiveFailures: 0,
      leaseExtended: true,
      serverState: 'active',
    });
  }

  /**
   * 从心跳监控中移除会话
   */
  removeSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /**
   * 更新会话令牌
   */
  updateSessionToken(sessionId: string, newToken: string): void {
    const info = this.sessions.get(sessionId);
    if (info) {
      info.sessionToken = newToken;
    }
  }

  /**
   * 检查会话是否在心跳监控中
   */
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * 获取受监控的会话数量
   */
  getMonitoredSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * 获取会话的最后心跳时间
   */
  getSessionLastHeartbeat(sessionId: string): number | undefined {
    return this.sessions.get(sessionId)?.lastHeartbeatTime;
  }

  /**
   * 获取会话的心跳健康状态
   */
  getSessionHealth(sessionId: string): 'healthy' | 'unhealthy' | 'unknown' {
    const info = this.sessions.get(sessionId);
    if (!info) return 'unknown';
    if (info.consecutiveFailures >= this.maxConsecutiveFailures)
      return 'unhealthy';
    if (info.consecutiveSuccesses > 0) return 'healthy';
    return 'unknown';
  }

  /**
   * 启动心跳定时器
   */
  private startHeartbeatTimer(): void {
    this.clearHeartbeatTimer();

    this.heartbeatTimer = setInterval(async () => {
      await this.sendHeartbeats();
    }, this.heartbeatIntervalMs);

    if (this.signal) {
      this.signal.addEventListener(
        'abort',
        () => {
          this.clearHeartbeatTimer();
          this.state = 'idle';
        },
        { once: true }
      );
    }
  }

  /**
   * 清除心跳定时器
   */
  private clearHeartbeatTimer(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * 发送所有会话的心跳
   */
  private async sendHeartbeats(): Promise<void> {
    if (this.state !== 'running' || this.signal?.aborted) return;

    const sessionIds = Array.from(this.sessions.keys());

    await Promise.all(
      sessionIds.map(async (sessionId) => {
        const info = this.sessions.get(sessionId);
        if (!info) return;

        try {
          const result = await this.api.heartbeatWork(
            this.environmentId,
            info.workId,
            info.sessionToken
          );

          this.totalHeartbeatsSent++;
          this.successfulHeartbeats++;
          info.lastHeartbeatTime = Date.now();
          info.consecutiveSuccesses++;
          info.consecutiveFailures = 0;
          info.leaseExtended = result.lease_extended;
          info.serverState = result.state;

          // 更新状态存储
          bridgeStateStore.setState((prev) => ({
            ...prev,
            bridgeState: 'connected',
          }));
        } catch (error) {
          this.totalHeartbeatsSent++;
          this.failedHeartbeats++;
          info.consecutiveFailures++;
          info.consecutiveSuccesses = 0;

          this.onError(
            error instanceof Error ? error : new Error(String(error))
          );

          if (info.consecutiveFailures >= this.maxConsecutiveFailures) {
            this.onSessionExpired?.(sessionId, info.workId);
            this.sessions.delete(sessionId);
          }
        }
      })
    );
  }

  /**
   * 获取最后心跳时间
   */
  private getLastHeartbeatTime(): number | null {
    let latest: number | null = null;
    for (const info of this.sessions.values()) {
      if (latest === null || info.lastHeartbeatTime > latest) {
        latest = info.lastHeartbeatTime;
      }
    }
    return latest;
  }
}

/**
 * 创建心跳管理器
 */
export function createHeartbeatManager(
  options: HeartbeatManagerOptions
): HeartbeatManager {
  return new HeartbeatManager(options);
}
