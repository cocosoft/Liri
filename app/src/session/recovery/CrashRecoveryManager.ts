/**
 * CrashRecoveryManager — 会话崩溃恢复管理器
 *
 * 在应用启动时检测上次异常中断的会话（Status=RUNNING/ACTIVE），
 * 根据会话状态和存活时间决定恢复策略：
 * - 存活较短的会话 → 标记为 PAUSED（可恢复）
 * - 存活较久的会话 → 标记为 FAILED（不可恢复）
 *
 * 参考：
 * - Hermes-Agent gateway/session.py::suspend_recently_active()
 * - OpenClaw main-session-restart-recovery.ts
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { SessionStatus } from '../types/Session';
import type { UnifiedSession } from '../types/Session';
import type { UnifiedSessionStorage } from '../storage/UnifiedStorage';

const logger = new Logger({ level: LogLevel.INFO });

export const DEFAULT_STALE_THRESHOLD_MS = 30 * 60 * 1000;
export const DEFAULT_RECOVERY_DELAY_MS = 5_000;
export const MAX_RECOVERY_RETRIES = 3;

export type CrashRecoveryAction = 'recovered' | 'failed' | 'skipped' | 'paused';

export interface CrashRecoveryDetail {
  sessionId: string;
  action: CrashRecoveryAction;
  reason?: string;
  duration?: number;
}

export interface CrashRecoveryResult {
  totalChecked: number;
  recoveredSessions: number;
  failedSessions: number;
  pausedSessions: number;
  skippedSessions: number;
  details: CrashRecoveryDetail[];
}

export interface CrashRecoveryConfig {
  storage: UnifiedSessionStorage;
  staleThresholdMs?: number;
  recoveryDelayMs?: number;
  maxRetries?: number;
}

export class CrashRecoveryManager {
  private storage: UnifiedSessionStorage;
  private staleThresholdMs: number;
  private recoveryDelayMs: number;
  private maxRetries: number;
  private initialized = false;

  constructor(config: CrashRecoveryConfig) {
    this.storage = config.storage;
    this.staleThresholdMs =
      config.staleThresholdMs ?? DEFAULT_STALE_THRESHOLD_MS;
    this.recoveryDelayMs = config.recoveryDelayMs ?? DEFAULT_RECOVERY_DELAY_MS;
    this.maxRetries = config.maxRetries ?? MAX_RECOVERY_RETRIES;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
  }

  async recoverAfterCrash(): Promise<CrashRecoveryResult> {
    const result: CrashRecoveryResult = {
      totalChecked: 0,
      recoveredSessions: 0,
      failedSessions: 0,
      pausedSessions: 0,
      skippedSessions: 0,
      details: [],
    };

    const sessions = await this.storage.listSessions();
    const now = Date.now();

    for (const session of sessions) {
      if (!this.isInterruptibleSession(session)) continue;

      result.totalChecked++;
      const detail = await this.processSession(session, now);
      result.details.push(detail);

      switch (detail.action) {
        case 'recovered':
          result.recoveredSessions++;
          break;
        case 'failed':
          result.failedSessions++;
          break;
        case 'paused':
          result.pausedSessions++;
          break;
        case 'skipped':
          result.skippedSessions++;
          break;
      }
    }

    if (result.totalChecked > 0) {
      logger.info('崩溃恢复完成', {
        totalChecked: result.totalChecked,
        recovered: result.recoveredSessions,
        paused: result.pausedSessions,
        failed: result.failedSessions,
        skipped: result.skippedSessions,
      });
    }

    return result;
  }

  async recoverSingleSession(
    sessionId: string
  ): Promise<CrashRecoveryDetail | null> {
    const session = await this.storage.getSession(sessionId);
    if (!session) return null;

    if (!this.isInterruptibleSession(session)) {
      return {
        sessionId,
        action: 'skipped',
        reason: `Session status is ${session.status}, not interruptible`,
      };
    }

    return this.processSession(session, Date.now());
  }

  private isInterruptibleSession(session: UnifiedSession): boolean {
    return (
      session.status === SessionStatus.RUNNING ||
      session.status === SessionStatus.ACTIVE
    );
  }

  private async processSession(
    session: UnifiedSession,
    now: number
  ): Promise<CrashRecoveryDetail> {
    const duration = now - session.lastActivityAt;
    const stale = duration > this.staleThresholdMs;

    if (stale) {
      session.status = SessionStatus.ERROR;
      session.metadata = {
        ...session.metadata,
        crashRecovery: 'failed_stale',
        crashedAt: String(now),
        lastActivityBeforeCrash: String(session.lastActivityAt),
      };
      await this.storage.updateSession(session);

      return {
        sessionId: session.id,
        action: 'failed',
        reason: `Session idle for ${Math.round(duration / 1000)}s, exceeded stale threshold`,
        duration,
      };
    }

    session.status = SessionStatus.PAUSED;
    session.metadata = {
      ...session.metadata,
      crashRecovery: 'recovered_paused',
      crashedAt: String(now),
      lastActivityBeforeCrash: String(session.lastActivityAt),
    };
    await this.storage.updateSession(session);

    logger.info('会话已暂停（崩溃恢复）', {
      sessionId: session.id,
      idleMs: duration,
    });

    return {
      sessionId: session.id,
      action: 'paused',
      reason: `Session paused after crash, idle for ${Math.round(duration / 1000)}s`,
      duration,
    };
  }

  async resumeSession(sessionId: string): Promise<UnifiedSession | null> {
    const session = await this.storage.getSession(sessionId);
    if (!session) return null;

    if (session.status !== SessionStatus.PAUSED) return session;

    session.status = SessionStatus.ACTIVE;
    session.lastActivityAt = Date.now();
    session.metadata = {
      ...session.metadata,
      crashRecovery: 'resumed',
      resumedAt: String(Date.now()),
    };
    await this.storage.updateSession(session);

    logger.info('会话已恢复', { sessionId });
    return session;
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}
