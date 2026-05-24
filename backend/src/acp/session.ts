import type { SessionId, AcpSession } from './types.js';
import { generateSessionId } from './conversation-id.js';

export interface AcpSessionStore {
  create(params: { sessionKey: string; cwd?: string }): Promise<AcpSession>;
  get(sessionId: SessionId): Promise<AcpSession | null>;
  findBySessionKey(sessionKey: string): Promise<AcpSession | null>;
  touch(sessionId: SessionId): Promise<void>;
  delete(sessionId: SessionId): Promise<boolean>;
  list(): Promise<AcpSession[]>;
  clear(): Promise<void>;
  size(): Promise<number>;
}

const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

export function createInMemorySessionStore(options?: { idleTimeoutMs?: number }): AcpSessionStore {
  const sessions = new Map<SessionId, AcpSession>();
  const idleTimeoutMs = options?.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;

  const clearIdleSessions = (): void => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - session.lastTouchedAt > idleTimeoutMs) {
        sessions.delete(id);
      }
    }
  };

  setInterval(clearIdleSessions, idleTimeoutMs / 2);

  return {
    async create(params) {
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
  defaultSessionStore = null;
}
