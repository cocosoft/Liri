import { randomUUID } from 'crypto';
import { registerStorage } from './StorageFactory';
import { StorageType } from './UnifiedStorage';
import type {
  UnifiedSessionStorage,
  StorageConfig,
  Transaction,
  UnifiedMessageQueryOptions,
} from './UnifiedStorage';
import type {
  UnifiedSession,
  SessionFilter,
  SessionStats,
} from '../types/Session';
import type { UnifiedMessage } from '../types/Message';

function matchesFilter(
  session: UnifiedSession,
  filter: SessionFilter
): boolean {
  if (filter.type && session.type !== filter.type) return false;
  if (filter.status && session.status !== filter.status) return false;
  if (filter.agentId && session.agentId !== filter.agentId) return false;
  if (filter.startDate && session.createdAt < filter.startDate) return false;
  if (filter.endDate && session.createdAt > filter.endDate) return false;
  return true;
}

export class MemoryUnifiedStorage implements UnifiedSessionStorage {
  private sessions: Map<string, UnifiedSession> = new Map();
  private messages: Map<string, UnifiedMessage[]> = new Map();
  private config: StorageConfig;

  constructor(config: StorageConfig) {
    this.config = config;
  }

  async createSession(session: UnifiedSession): Promise<string> {
    this.sessions.set(session.id, { ...session });
    this.messages.set(session.id, []);
    return session.id;
  }

  async getSession(sessionId: string): Promise<UnifiedSession | null> {
    const session = this.sessions.get(sessionId);
    return session ? { ...session } : null;
  }

  async updateSession(session: UnifiedSession): Promise<void> {
    this.sessions.set(session.id, { ...session });
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
    this.messages.delete(sessionId);
  }

  async listSessions(filter?: SessionFilter): Promise<UnifiedSession[]> {
    let result = Array.from(this.sessions.values());

    if (filter) {
      result = result.filter((s) => matchesFilter(s, filter));
    }

    return result.map((s) => ({ ...s }));
  }

  async searchSessions(query: string): Promise<UnifiedSession[]> {
    const q = query.toLowerCase();
    return Array.from(this.sessions.values())
      .filter(
        (s) =>
          (s.title && s.title.toLowerCase().includes(q)) ||
          s.id.toLowerCase().includes(q)
      )
      .map((s) => ({ ...s }));
  }

  async addMessage(sessionId: string, message: UnifiedMessage): Promise<void> {
    const msgs = this.messages.get(sessionId) ?? [];
    msgs.push({ ...message });
    this.messages.set(sessionId, msgs);
  }

  async getMessages(
    sessionId: string,
    options?: UnifiedMessageQueryOptions
  ): Promise<UnifiedMessage[]> {
    const msgs = this.messages.get(sessionId) ?? [];
    let result = msgs.map((m) => ({ ...m }));

    if (options) {
      if (options.limit) {
        result = result.slice(-options.limit);
      }
    }

    return result;
  }

  async updateMessage(
    sessionId: string,
    messageId: string,
    message: UnifiedMessage
  ): Promise<void> {
    const msgs = this.messages.get(sessionId);
    if (!msgs) return;
    const idx = msgs.findIndex((m) => m.id === messageId);
    if (idx !== -1) {
      msgs[idx] = { ...message };
    }
  }

  async deleteMessage(sessionId: string, messageId: string): Promise<void> {
    const msgs = this.messages.get(sessionId);
    if (!msgs) return;
    this.messages.set(
      sessionId,
      msgs.filter((m) => m.id !== messageId)
    );
  }

  async searchMessages(
    sessionId: string,
    query: string
  ): Promise<UnifiedMessage[]> {
    const q = query.toLowerCase();
    const msgs = this.messages.get(sessionId) ?? [];
    return msgs
      .filter(
        (m) =>
          (typeof m.content === 'string' &&
            m.content.toLowerCase().includes(q)) ||
          m.id.toLowerCase().includes(q)
      )
      .map((m) => ({ ...m }));
  }

  async addMessages(
    sessionId: string,
    messages: UnifiedMessage[]
  ): Promise<void> {
    const msgs = this.messages.get(sessionId) ?? [];
    for (const m of messages) {
      msgs.push({ ...m });
    }
    this.messages.set(sessionId, msgs);
  }

  async deleteMessages(sessionId: string, messageIds: string[]): Promise<void> {
    const msgs = this.messages.get(sessionId);
    if (!msgs) return;
    const idSet = new Set(messageIds);
    this.messages.set(
      sessionId,
      msgs.filter((m) => !idSet.has(m.id))
    );
  }

  async getSessionStats(sessionId?: string): Promise<SessionStats> {
    if (sessionId) {
      const session = this.sessions.get(sessionId);
      if (!session) {
        return {
          totalSessions: 0,
          activeSessions: 0,
          archivedSessions: 0,
          averageSessionDuration: 0,
          totalMessages: 0,
          sessions: [],
        };
      }
      const msgs = this.messages.get(sessionId) ?? [];
      return {
        totalSessions: 1,
        activeSessions: 1,
        archivedSessions: 0,
        averageSessionDuration: 0,
        totalMessages: msgs.length,
        sessions: [session.id],
      };
    }

    let totalMessages = 0;
    for (const msgs of this.messages.values()) {
      totalMessages += msgs.length;
    }

    return {
      totalSessions: this.sessions.size,
      activeSessions: this.sessions.size,
      archivedSessions: 0,
      averageSessionDuration: 0,
      totalMessages,
      sessions: Array.from(this.sessions.keys()),
    };
  }

  async getSessionMessageCount(sessionId: string): Promise<number> {
    return (this.messages.get(sessionId) ?? []).length;
  }

  async beginTransaction(): Promise<Transaction> {
    return {
      commit: async () => {},
      rollback: async () => {},
    };
  }

  async initialize(): Promise<void> {}

  async close(): Promise<void> {
    this.sessions.clear();
    this.messages.clear();
  }

  sessionIdExists(sessionId: string): Promise<boolean> {
    return Promise.resolve(this.sessions.has(sessionId));
  }

  getStorageInfo(): StorageConfig {
    return { ...this.config };
  }
}

registerStorage(StorageType.MEMORY, MemoryUnifiedStorage);
