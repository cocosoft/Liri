export enum SessionMode {
  DEDICATED = 'dedicated',
  SHARED = 'shared',
  POOLED = 'pooled',
}

export enum SessionStatus {
  CREATING = 'creating',
  ACTIVE = 'active',
  IDLE = 'idle',
  CLOSING = 'closing',
  CLOSED = 'closed',
}

export interface SessionConfig {
  id: string;
  mode: SessionMode;
  maxClients?: number;
  timeoutMs?: number;
  tags?: string[];
}

export interface BridgeSession {
  config: SessionConfig;
  status: SessionStatus;
  clientCount: number;
  createdAt: number;
  lastActivity: number;
  metadata: Record<string, unknown>;
}

export interface SessionStats {
  totalCreated: number;
  totalClosed: number;
  activeCount: number;
  idleCount: number;
  averageLifetime: number;
}

export interface IMultiSessionManager {
  createSession(config: SessionConfig): Promise<BridgeSession>;
  getSession(sessionId: string): BridgeSession | undefined;
  listSessions(filter?: {
    mode?: SessionMode;
    status?: SessionStatus;
  }): BridgeSession[];
  updateSessionStatus(sessionId: string, status: SessionStatus): boolean;
  closeSession(sessionId: string): Promise<boolean>;
  getStats(): SessionStats;
}

export class MultiSessionManager implements IMultiSessionManager {
  private sessions: Map<string, BridgeSession> = new Map();
  private totalCreated = 0;
  private totalClosed = 0;
  private lifetimeSum = 0;

  async createSession(config: SessionConfig): Promise<BridgeSession> {
    const now = Date.now();
    const session: BridgeSession = {
      config: { ...config, timeoutMs: config.timeoutMs ?? 300000 },
      status: SessionStatus.CREATING,
      clientCount: 0,
      createdAt: now,
      lastActivity: now,
      metadata: {},
    };
    this.sessions.set(config.id, session);
    this.totalCreated++;
    session.status = SessionStatus.ACTIVE;
    return session;
  }

  getSession(sessionId: string): BridgeSession | undefined {
    return this.sessions.get(sessionId);
  }

  listSessions(filter?: {
    mode?: SessionMode;
    status?: SessionStatus;
  }): BridgeSession[] {
    const all = Array.from(this.sessions.values());
    if (!filter) return all;
    return all.filter((s) => {
      if (filter.mode && s.config.mode !== filter.mode) return false;
      if (filter.status && s.status !== filter.status) return false;
      return true;
    });
  }

  updateSessionStatus(sessionId: string, status: SessionStatus): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.status = status;
    session.lastActivity = Date.now();
    return true;
  }

  async closeSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.status = SessionStatus.CLOSED;
    session.lastActivity = Date.now();
    this.lifetimeSum += session.lastActivity - session.createdAt;
    this.totalClosed++;
    return true;
  }

  getStats(): SessionStats {
    const activeCount = Array.from(this.sessions.values()).filter(
      (s) =>
        s.status === SessionStatus.ACTIVE || s.status === SessionStatus.CREATING
    ).length;
    const idleCount = Array.from(this.sessions.values()).filter(
      (s) => s.status === SessionStatus.IDLE
    ).length;
    const averageLifetime =
      this.totalClosed > 0
        ? Math.round(this.lifetimeSum / this.totalClosed)
        : 0;
    return {
      totalCreated: this.totalCreated,
      totalClosed: this.totalClosed,
      activeCount,
      idleCount,
      averageLifetime,
    };
  }
}

import type {
  SessionSpawner,
  SessionHandle,
  SessionSpawnOpts,
} from '../types/index.js';

/**
 * 创建虚拟会话生成器（用于模拟模式）
 */
export function createDummySpawner(): SessionSpawner {
  return {
    spawn(_opts: SessionSpawnOpts, _dir: string): SessionHandle {
      const activities: import('../types/index.js').SessionActivity[] = [];
      return {
        currentActivity: null,
        activities,
        lastStderr: [],
        updateAccessToken(_token: string): void {
          // 模拟模式下无需操作
        },
        async stop(): Promise<void> {
          // 模拟模式下无需操作
        },
      };
    },
  };
}
