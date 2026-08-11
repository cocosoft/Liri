/**
 * 会话管理器
 * 负责创建、管理和销毁会话，追踪会话活动与状态
 */

import type {
  SessionHandle,
  SessionSpawner,
  SessionDoneStatus,
  SessionActivity,
} from '../types/index.js';
import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@modules/error';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('bridge:managers:SessionManager');

/**
 * 会话信息
 */
interface SessionInfo {
  /** 会话句柄 */
  handle: SessionHandle;
  /** 会话 ID */
  sessionId: string;
  /** SDK URL */
  sdkUrl: string;
  /** 会话开始时间 */
  startTime: number;
  /** 最后活动时间 */
  lastActivityTime: number;
  /** 工作 ID */
  workId: string;
  /** 会话令牌 */
  ingressToken: string;
  /** 是否超时 */
  timedOut: boolean;
  /** 会话目录 */
  dir: string;
}

/**
 * 会话统计信息
 */
export interface SessionStats {
  totalCreated: number;
  totalCompleted: number;
  totalFailed: number;
  totalInterrupted: number;
  activeCount: number;
  averageLifetimeMs: number;
}

/**
 * 会话管理器选项
 */
export interface SessionManagerOptions {
  /** 会话生成器 */
  spawner: SessionSpawner;
  /** 最大会话数 */
  maxSessions: number;
  /** 会话超时时间（毫秒） */
  sessionTimeoutMs: number;
  /** 空闲超时时间（毫秒，可选） */
  idleTimeoutMs?: number;
  /** 会话完成回调 */
  onSessionDone: (sessionId: string, status: SessionDoneStatus) => void;
}

/**
 * 会话管理器
 * 管理会话的完整生命周期：创建、活动追踪、超时、清理
 */
export class SessionManager {
  private readonly spawner: SessionSpawner;
  private readonly maxSessions: number;
  private readonly sessionTimeoutMs: number;
  private readonly idleTimeoutMs: number;
  private readonly onSessionDone: (
    sessionId: string,
    status: SessionDoneStatus
  ) => void;

  private sessions: Map<string, SessionInfo> = new Map();
  private sessionTimers: Map<string, NodeJS.Timeout> = new Map();
  private idleTimers: Map<string, NodeJS.Timeout> = new Map();

  private totalCreated = 0;
  private totalCompleted = 0;
  private totalFailed = 0;
  private totalInterrupted = 0;
  private lifetimeTotalMs = 0;

  constructor(options: SessionManagerOptions) {
    this.spawner = options.spawner;
    this.maxSessions = options.maxSessions;
    this.sessionTimeoutMs = options.sessionTimeoutMs;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 10 * 60 * 1000;
    this.onSessionDone = options.onSessionDone;
  }

  /**
   * 创建会话
   */
  createSession(
    sessionId: string,
    sdkUrl: string,
    accessToken: string,
    workId: string,
    dir: string
  ): SessionHandle {
    if (this.sessions.size >= this.maxSessions) {
      throw new AppError(
        `已达到最大会话数限制 (${this.maxSessions})`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const handle = this.spawner.spawn({ sdkUrl, accessToken }, dir);

    const sessionInfo: SessionInfo = {
      handle,
      sessionId,
      sdkUrl,
      startTime: Date.now(),
      lastActivityTime: Date.now(),
      workId,
      ingressToken: accessToken,
      timedOut: false,
      dir,
    };

    this.sessions.set(sessionId, sessionInfo);
    this.totalCreated++;

    this.setSessionTimeout(sessionId);

    logger.debug('会话创建', {
      sessionId,
      workId,
      dir,
      activeCount: this.sessions.size,
      totalCreated: this.totalCreated,
      timeoutMs: this.sessionTimeoutMs,
    });

    return handle;
  }

  /**
   * 获取会话
   */
  getSession(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * 获取会话句柄
   */
  getSessionHandle(sessionId: string): SessionHandle | undefined {
    return this.sessions.get(sessionId)?.handle;
  }

  /**
   * 检查会话是否存在
   */
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * 获取所有会话
   */
  getAllSessions(): Map<string, SessionInfo> {
    return new Map(this.sessions);
  }

  /**
   * 获取所有会话 ID 列表
   */
  getSessionIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * 获取活跃会话数量
   */
  getActiveSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * 是否已达到容量上限
   */
  isAtCapacity(): boolean {
    return this.sessions.size >= this.maxSessions;
  }

  /**
   * 可用容量
   */
  availableCapacity(): number {
    return this.maxSessions - this.sessions.size;
  }

  /**
   * 获取会话统计
   */
  getStats(): SessionStats {
    const completedTotal =
      this.totalCompleted + this.totalFailed + this.totalInterrupted;
    return {
      totalCreated: this.totalCreated,
      totalCompleted: this.totalCompleted,
      totalFailed: this.totalFailed,
      totalInterrupted: this.totalInterrupted,
      activeCount: this.sessions.size,
      averageLifetimeMs:
        completedTotal > 0
          ? Math.round(this.lifetimeTotalMs / completedTotal)
          : 0,
    };
  }

  /**
   * 更新会话活动
   * 记录会话的活动信息并刷新空闲超时
   */
  updateSessionActivity(sessionId: string, activity: SessionActivity): void {
    const sessionInfo = this.sessions.get(sessionId);
    if (!sessionInfo) return;

    const oldLastActivityTime = sessionInfo.lastActivityTime;
    sessionInfo.lastActivityTime = Date.now();
    sessionInfo.handle.activities.push(activity);
    sessionInfo.handle.currentActivity = activity;

    this.resetIdleTimer(sessionId);

    logger.debug('会话活动刷新', {
      sessionId,
      activityType: activity.type,
      idleTimeoutMs: this.idleTimeoutMs,
      idleTimeMs: Date.now() - oldLastActivityTime,
    });
  }

  /**
   * 更新会话访问令牌
   */
  updateSessionToken(sessionId: string, newToken: string): void {
    const sessionInfo = this.sessions.get(sessionId);
    if (!sessionInfo) return;

    sessionInfo.ingressToken = newToken;
    sessionInfo.handle.updateAccessToken(newToken);

    logger.debug('会话令牌更新', {
      sessionId,
      tokenLength: newToken.length,
    });
  }

  /**
   * 停止会话
   */
  async stopSession(sessionId: string): Promise<string | undefined> {
    const sessionInfo = this.sessions.get(sessionId);
    if (!sessionInfo) return undefined;

    const lifetimeMs = Date.now() - sessionInfo.startTime;

    this.clearSessionTimeout(sessionId);
    this.clearIdleTimer(sessionId);

    let stopErrorCode: string | undefined;
    try {
      await sessionInfo.handle.stop();
    } catch (err) {
      // 忽略停止时的错误，仅透出错误码供调用方排查
      stopErrorCode = err instanceof AppError ? err.code : 'UNKNOWN_STOP_ERROR';
      handleError(err, {
        module: 'bridge:managers:SessionManager',
        action: 'ignoreStopError',
      });
    }

    this.sessions.delete(sessionId);

    logger.debug('会话停止', {
      sessionId,
      workId: sessionInfo.workId,
      lifetimeMs,
      timedOut: sessionInfo.timedOut,
      activeCount: this.sessions.size,
      stopErrorCode,
    });

    return stopErrorCode;
  }

  /**
   * 标记会话完成
   */
  markSessionDone(sessionId: string, status: SessionDoneStatus): void {
    const sessionInfo = this.sessions.get(sessionId);
    if (!sessionInfo) return;

    this.clearSessionTimeout(sessionId);
    this.clearIdleTimer(sessionId);

    const lifetimeMs = Date.now() - sessionInfo.startTime;
    this.lifetimeTotalMs += lifetimeMs;
    this.sessions.delete(sessionId);

    switch (status) {
      case 'completed':
        this.totalCompleted++;
        break;
      case 'failed':
        this.totalFailed++;
        break;
      case 'interrupted':
        this.totalInterrupted++;
        break;
    }

    logger.debug('会话状态切换完成', {
      sessionId,
      workId: sessionInfo.workId,
      status,
      lifetimeMs,
      activeCount: this.sessions.size,
      totalCompleted: this.totalCompleted,
      totalFailed: this.totalFailed,
      totalInterrupted: this.totalInterrupted,
    });

    this.onSessionDone(sessionId, status);
  }

  /**
   * 中断所有会话
   */
  async interruptAllSessions(): Promise<void> {
    const ids = Array.from(this.sessions.keys());
    await Promise.all(ids.map((id) => this.stopSession(id)));
  }

  /**
   * 清除所有会话
   */
  async clearAllSessions(): Promise<void> {
    const ids = Array.from(this.sessions.keys());

    for (const timer of this.sessionTimers.values()) {
      clearTimeout(timer);
    }
    this.sessionTimers.clear();

    for (const timer of this.idleTimers.values()) {
      clearTimeout(timer);
    }
    this.idleTimers.clear();

    await Promise.all(ids.map((id) => this.stopSession(id)));
  }

  /**
   * 获取会话的存活时间
   */
  getSessionLifetime(sessionId: string): number | null {
    const info = this.sessions.get(sessionId);
    return info ? Date.now() - info.startTime : null;
  }

  /**
   * 获取会话的空闲时间
   */
  getSessionIdleTime(sessionId: string): number | null {
    const info = this.sessions.get(sessionId);
    return info ? Date.now() - info.lastActivityTime : null;
  }

  /**
   * 设置会话超时定时器
   */
  private setSessionTimeout(sessionId: string): void {
    this.clearSessionTimeout(sessionId);

    const timer = setTimeout(() => {
      this.handleSessionTimeout(sessionId);
    }, this.sessionTimeoutMs);

    this.sessionTimers.set(sessionId, timer);
  }

  /**
   * 清除会话超时定时器
   */
  private clearSessionTimeout(sessionId: string): void {
    const timer = this.sessionTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.sessionTimers.delete(sessionId);
    }
  }

  /**
   * 重置空闲超时定时器
   */
  private resetIdleTimer(sessionId: string): void {
    this.clearIdleTimer(sessionId);

    const timer = setTimeout(() => {
      this.handleIdleTimeout(sessionId);
    }, this.idleTimeoutMs);

    this.idleTimers.set(sessionId, timer);
  }

  /**
   * 清除空闲超时定时器
   */
  private clearIdleTimer(sessionId: string): void {
    const timer = this.idleTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.idleTimers.delete(sessionId);
    }
  }

  /**
   * 处理会话超时
   */
  private async handleSessionTimeout(sessionId: string): Promise<void> {
    const sessionInfo = this.sessions.get(sessionId);
    if (!sessionInfo) return;

    sessionInfo.timedOut = true;
    logger.warn('会话超时，触发停止', {
      sessionId,
      workId: sessionInfo.workId,
      sessionTimeoutMs: this.sessionTimeoutMs,
      lifetimeMs: Date.now() - sessionInfo.startTime,
    });
    const errorCode = await this.stopSession(sessionId);
    if (errorCode) {
      logger.warn('会话超时停止失败，错误码排查', {
        sessionId,
        workId: sessionInfo.workId,
        errorCode,
      });
    }
    this.totalFailed++;
    this.onSessionDone(sessionId, 'failed');
  }

  /**
   * 处理空闲超时
   */
  private async handleIdleTimeout(sessionId: string): Promise<void> {
    const sessionInfo = this.sessions.get(sessionId);
    if (!sessionInfo) return;

    const idleTime = Date.now() - sessionInfo.lastActivityTime;
    if (idleTime >= this.idleTimeoutMs) {
      sessionInfo.timedOut = true;
      logger.warn('会话空闲超时，触发中断', {
        sessionId,
        workId: sessionInfo.workId,
        idleTimeMs: idleTime,
        idleTimeoutMs: this.idleTimeoutMs,
        lifetimeMs: Date.now() - sessionInfo.startTime,
      });
      await this.stopSession(sessionId);
      this.totalInterrupted++;
      this.onSessionDone(sessionId, 'interrupted');
    }
  }
}

/**
 * 创建会话管理器
 */
export function createSessionManager(
  options: SessionManagerOptions
): SessionManager {
  return new SessionManager(options);
}
