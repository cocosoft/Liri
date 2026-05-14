/**
 * SessionReaper 会话收割器
 * 对标 OpenClaw chronos/reaper/，清理过期和闲置的会话
 */
import { EventEmitter } from 'node:events';

/**
 * 收割策略
 */
export interface ReaperConfig {
  intervalMs: number;
  maxSessionAgeMs: number;
  maxIdleTimeMs: number;
  maxSessionsPerChannel: number;
  enabled: boolean;
}

/**
 * 收割结果
 */
export interface ReapResult {
  reaped: number;
  preserved: number;
  details: ReapDetail[];
  durationMs: number;
}

/**
 * 收割详情
 */
export interface ReapDetail {
  sessionId: string;
  reason: 'expired' | 'idle' | 'over_limit';
  age: number;
}

/**
 * 可收割的会话接口
 */
export interface ReapableSession {
  id: string;
  channelId?: string;
  createdAt: number;
  lastActivityAt: number;
  status: string;
}

/**
 * 会话收割事件
 */
export interface ReapEvent {
  type: 'reap:before' | 'reap:after' | 'reap:session';
  timestamp: number;
  data?: Record<string, unknown>;
}

/**
 * 会话收割器
 */
export class SessionReaper extends EventEmitter {
  private config: ReaperConfig;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(config?: Partial<ReaperConfig>) {
    super();

    this.config = {
      intervalMs: 60 * 60 * 1000,
      maxSessionAgeMs: 7 * 24 * 60 * 60 * 1000,
      maxIdleTimeMs: 30 * 60 * 1000,
      maxSessionsPerChannel: 1000,
      enabled: false,
      ...config,
    };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<ReaperConfig>): void {
    this.config = { ...this.config, ...config };

    if (this.timer && this.config.enabled) {
      this.stop();
      this.start();
    }
  }

  /**
   * 启动收割循环
   */
  start(): void {
    if (this.timer) {
      return;
    }

    this.config.enabled = true;

    this.timer = setInterval(() => {
      this.reap([]).catch(() => {});
    }, this.config.intervalMs);

    this.timer.unref();
  }

  /**
   * 停止收割循环
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.config.enabled = false;
  }

  /**
   * 执行一次收割
   */
  async reap(sessions: ReapableSession[]): Promise<ReapResult> {
    const startTime = Date.now();

    const beforeEvent: ReapEvent = {
      type: 'reap:before',
      timestamp: startTime,
    };

    this.emit('reap:before', beforeEvent);

    const details: ReapDetail[] = [];
    const now = Date.now();

    const toReap: ReapableSession[] = [];
    const toPreserve: ReapableSession[] = [];

    for (const session of sessions) {
      const age = now - session.createdAt;
      let shouldReap = false;
      let reason: ReapDetail['reason'] = 'expired';

      if (age > this.config.maxSessionAgeMs) {
        shouldReap = true;
        reason = 'expired';
      } else if (session.status !== 'closed' && (now - session.lastActivityAt) > this.config.maxIdleTimeMs) {
        shouldReap = true;
        reason = 'idle';
      }

      if (shouldReap) {
        toReap.push(session);
        details.push({ sessionId: session.id, reason, age });

        const reapEvent: ReapEvent = {
          type: 'reap:session',
          timestamp: now,
          data: { sessionId: session.id, reason, age },
        };

        this.emit('reap:session', reapEvent);
      } else {
        toPreserve.push(session);
      }
    }

    // 按渠道超量收割
    const channelSessions = new Map<string, ReapableSession[]>();

    for (const session of toPreserve) {
      const channelId = session.channelId || 'default';
      const list = channelSessions.get(channelId) || [];

      list.push(session);
      channelSessions.set(channelId, list);
    }

    for (const [channelId, sessions] of channelSessions.entries()) {
      if (sessions.length > this.config.maxSessionsPerChannel) {
        sessions.sort((a, b) => a.lastActivityAt - b.lastActivityAt);

        const excess = sessions.slice(0, sessions.length - this.config.maxSessionsPerChannel);

        for (const session of excess) {
          toReap.push(session);
          details.push({ sessionId: session.id, reason: 'over_limit', age: now - session.createdAt });
          toPreserve.splice(toPreserve.indexOf(session), 1);
        }
      }
    }

    const afterEvent: ReapEvent = {
      type: 'reap:after',
      timestamp: Date.now(),
      data: { reaped: toReap.length, preserved: toPreserve.length },
    };

    this.emit('reap:after', afterEvent);

    return {
      reaped: toReap.length,
      preserved: toPreserve.length,
      details,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * 判断会话是否需要收割
   */
  shouldReap(session: ReapableSession): boolean {
    const now = Date.now();
    const age = now - session.createdAt;

    if (age > this.config.maxSessionAgeMs) {
      return true;
    }

    if (session.status !== 'closed' && (now - session.lastActivityAt) > this.config.maxIdleTimeMs) {
      return true;
    }

    return false;
  }

  /**
   * 获取配置
   */
  getConfig(): ReaperConfig {
    return { ...this.config };
  }

  /**
   * 获取运行状态
   */
  isRunning(): boolean {
    return this.timer !== null;
  }
}

export const sessionReaper = new SessionReaper();
