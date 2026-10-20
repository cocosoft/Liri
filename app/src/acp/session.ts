import type { SessionId, AcpSession } from './types.js';
import { generateSessionId } from './runtime/session-identity.js';

export interface AcpSessionStore {
  create(params: { sessionKey: string; cwd?: string }): Promise<AcpSession>;
  get(sessionId: SessionId): Promise<AcpSession | null>;
  findBySessionKey(sessionKey: string): Promise<AcpSession | null>;
  touch(sessionId: SessionId): Promise<void>;
  delete(sessionId: SessionId): Promise<boolean>;
  list(): Promise<AcpSession[]>;
  clear(): Promise<void>;
  size(): Promise<number>;
  /**
   * 停止内部空闲清理定时器（幂等）。
   *
   * 定时器为惰性启动（首次 `create()`），且启动时已 `unref()`，
   * 因此即便调用方不显式 dispose 也不会阻塞进程退出；
   * 该入口用于测试隔离与长驻容器的确定性收尾。
   * dispose 后 store 仍可正常读写，仅不再自动回收空闲会话。
   */
  dispose(): void;
}

const ACP_SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

export function createInMemorySessionStore(options?: {
  idleTimeoutMs?: number;
}): AcpSessionStore {
  const sessions = new Map<SessionId, AcpSession>();
  const idleTimeoutMs = options?.idleTimeoutMs ?? ACP_SESSION_IDLE_TIMEOUT_MS;
  let cleanupTimer: ReturnType<typeof setInterval> | null = null;

  const clearIdleSessions = (): void => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - session.lastTouchedAt > idleTimeoutMs) {
        sessions.delete(id);
      }
    }
  };

  /** 惰性启动空闲清理定时器（首次 create）；unref 避免阻塞进程退出 */
  const startCleanup = (): void => {
    if (cleanupTimer) return;
    cleanupTimer = setInterval(clearIdleSessions, idleTimeoutMs / 2);
    cleanupTimer.unref?.();
  };

  return {
    async create(params) {
      startCleanup();
      clearIdleSessions();
      const session: AcpSession = {
        sessionId: generateSessionId(),
        sessionKey: params.sessionKey,
        cwd: params.cwd || process.cwd(),
        createdAt: Date.now(),
        lastTouchedAt: Date.now(),
        abortController: null,
        activeRunId: null,
      };
      sessions.set(session.sessionId, session);
      return session;
    },

    async get(sessionId) {
      clearIdleSessions();
      return sessions.get(sessionId) ?? null;
    },

    async findBySessionKey(sessionKey) {
      clearIdleSessions();
      for (const session of sessions.values()) {
        if (session.sessionKey === sessionKey) {
          return session;
        }
      }
      return null;
    },

    async touch(sessionId) {
      const session = sessions.get(sessionId);
      if (session) {
        session.lastTouchedAt = Date.now();
      }
    },

    async delete(sessionId) {
      clearIdleSessions();
      return sessions.delete(sessionId);
    },

    async list() {
      clearIdleSessions();
      return Array.from(sessions.values());
    },

    async clear() {
      sessions.clear();
    },

    async size() {
      clearIdleSessions();
      return sessions.size;
    },

    dispose() {
      if (!cleanupTimer) return;
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    },
  };
}

let defaultSessionStore: AcpSessionStore | null = null;

export function getDefaultSessionStore(): AcpSessionStore {
  if (!defaultSessionStore) {
    defaultSessionStore = createInMemorySessionStore();
  }
  return defaultSessionStore;
}

export function resetDefaultSessionStoreForTests(): void {
  // 先释放旧实例的清理定时器，再置空（否则测试复用会叠加定时器）
  defaultSessionStore?.dispose();
  defaultSessionStore = null;
}
