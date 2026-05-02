/**
 * 存储适配器
 * 将旧的SessionStorage接口适配到新的UnifiedSessionStorage接口
 */

import type { Session } from './models/Session.js';
import type { SessionMessage } from './models/SessionMessage.js';
import type { SessionMetadata } from './models/SessionMetadata.js';
import type { SessionStorage } from './SessionStorage.js';
import type {
  UnifiedSession,
  UnifiedMessage,
  SessionFilter,
  SessionStats,
  SessionType,
  SessionStatus,
} from './types/Session.js';
import type {
  MessageType,
  MessageRole,
  ContentBlock,
} from './types/Message.js';
import type {
  UnifiedSessionStorage,
  UnifiedMessageQueryOptions,
  Transaction,
  StorageConfig,
} from './storage/UnifiedStorage.js';

/**
 * 旧版消息转换为统一消息
 */
function convertToUnifiedMessage(
  sessionMessage: SessionMessage
): UnifiedMessage {
  return {
    id: sessionMessage.id,
    sessionId: sessionMessage.sessionId,
    type: (sessionMessage.type as MessageType) || MessageType.USER,
    role: (sessionMessage.role as MessageRole) || MessageRole.USER,
    content: sessionMessage.content || '',
    parentUuid: sessionMessage.parentId,
    timestamp: sessionMessage.createdAt?.getTime() || Date.now(),
    metadata: sessionMessage.toolResult
      ? {
          toolCallId: sessionMessage.id,
          toolName: 'unknown',
        }
      : undefined,
  };
}

/**
 * 旧版Session转换为统一Session
 */
function convertToUnifiedSession(session: Session): UnifiedSession {
  return {
    id: session.id,
    type: SessionType.LOCAL,
    title: session.metadata?.title,
    createdAt: session.createdAt?.getTime() || Date.now(),
    updatedAt: session.updatedAt?.getTime() || Date.now(),
    lastActivityAt: session.updatedAt?.getTime() || Date.now(),
    status:
      (session.state?.currentState as SessionStatus) || SessionStatus.ACTIVE,
    metadata: {
      title: session.metadata?.title,
      tags: session.metadata?.tags,
      mode: session.metadata?.mode,
      worktreeState: session.metadata?.worktreeState,
      prLink: session.metadata?.prLink,
    },
  };
}

/**
 * 会话过滤条件转换
 */
function convertFilter(
  filter?: SessionFilter
): { tags?: string[]; mode?: string } | undefined {
  if (!filter) return undefined;
  return {
    tags: filter.tags,
    mode: filter.mode,
  };
}

/**
 * 存储适配器类
 * 将旧的SessionStorage适配到新的UnifiedSessionStorage接口
 */
export class StorageAdapter implements UnifiedSessionStorage {
  private sessionStorage: SessionStorage;
  private sessions: Map<string, UnifiedSession> = new Map();
  private messages: Map<string, UnifiedMessage[]> = new Map();

  constructor(sessionStorage: SessionStorage) {
    this.sessionStorage = sessionStorage;
  }

  async initialize(): Promise<void> {
    // 无需初始化
  }

  async close(): Promise<void> {
    // 无需关闭
  }

  async createSession(session: UnifiedSession): Promise<string> {
    this.sessions.set(session.id, session);
    this.messages.set(session.id, []);
    return session.id;
  }

  async getSession(sessionId: string): Promise<UnifiedSession | null> {
    return this.sessions.get(sessionId) || null;
  }

  async updateSession(session: UnifiedSession): Promise<void> {
    this.sessions.set(session.id, session);
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
    this.messages.delete(sessionId);
  }

  async listSessions(filter?: SessionFilter): Promise<UnifiedSession[]> {
    const sessions = Array.from(this.sessions.values());

    if (!filter) {
      return sessions;
    }

    return sessions.filter((session) => {
      if (filter.type && session.type !== filter.type) return false;
      if (filter.status && session.status !== filter.status) return false;
      if (filter.tags && filter.tags.length > 0) {
        const sessionTags = session.metadata?.tags || [];
        if (!filter.tags.some((tag) => sessionTags.includes(tag))) return false;
      }
      return true;
    });
  }

  async searchSessions(query: string): Promise<UnifiedSession[]> {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.sessions.values()).filter((session) => {
      if (session.title?.toLowerCase().includes(lowerQuery)) return true;
      if (session.metadata?.title?.toLowerCase().includes(lowerQuery))
        return true;
      return false;
    });
  }

  async addMessage(sessionId: string, message: UnifiedMessage): Promise<void> {
    const messages = this.messages.get(sessionId) || [];
    messages.push(message);
    this.messages.set(sessionId, messages);
  }

  async getMessages(
    sessionId: string,
    options?: UnifiedMessageQueryOptions
  ): Promise<UnifiedMessage[]> {
    const messages = this.messages.get(sessionId) || [];

    let result = [...messages];

    if (options?.startDate) {
      result = result.filter((m) => m.timestamp >= options.startDate!);
    }

    if (options?.endDate) {
      result = result.filter((m) => m.timestamp <= options.endDate!);
    }

    if (options?.types && options.types.length > 0) {
      result = result.filter((m) => options.types!.includes(m.type));
    }

    if (options?.offset) {
      result = result.slice(options.offset);
    }

    if (options?.limit) {
      result = result.slice(0, options.limit);
    }

    return result;
  }

  async updateMessage(
    sessionId: string,
    messageId: string,
    message: UnifiedMessage
  ): Promise<void> {
    const messages = this.messages.get(sessionId) || [];
    const index = messages.findIndex((m) => m.id === messageId);
    if (index >= 0) {
      messages[index] = message;
      this.messages.set(sessionId, messages);
    }
  }

  async deleteMessage(sessionId: string, messageId: string): Promise<void> {
    const messages = this.messages.get(sessionId) || [];
    const filtered = messages.filter((m) => m.id !== messageId);
    this.messages.set(sessionId, filtered);
  }

  async searchMessages(
    sessionId: string,
    query: string
  ): Promise<UnifiedMessage[]> {
    const messages = this.messages.get(sessionId) || [];
    const lowerQuery = query.toLowerCase();

    return messages.filter((m) => {
      const content =
        typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      return content.toLowerCase().includes(lowerQuery);
    });
  }

  async addMessages(
    sessionId: string,
    messages: UnifiedMessage[]
  ): Promise<void> {
    const existing = this.messages.get(sessionId) || [];
    this.messages.set(sessionId, [...existing, ...messages]);
  }

  async deleteMessages(sessionId: string, messageIds: string[]): Promise<void> {
    const messages = this.messages.get(sessionId) || [];
    const filtered = messages.filter((m) => !messageIds.includes(m.id));
    this.messages.set(sessionId, filtered);
  }

  async getSessionStats(sessionId?: string): Promise<SessionStats> {
    if (sessionId) {
      const session = await this.getSession(sessionId);
      const messages = await this.getMessages(sessionId);

      return {
        totalSessions: 1,
        activeSessions: session?.status === SessionStatus.ACTIVE ? 1 : 0,
        archivedSessions: session?.status === SessionStatus.ARCHIVED ? 1 : 0,
        averageSessionDuration: session
          ? session.updatedAt - session.createdAt
          : 0,
        totalMessages: messages.length,
        lastActivityAt: session?.lastActivityAt,
      };
    }

    const sessions = await this.listSessions();
    let totalMessages = 0;
    let totalDuration = 0;

    for (const session of sessions) {
      const messages = await this.getMessages(session.id);
      totalMessages += messages.length;
      totalDuration += session.updatedAt - session.createdAt;
    }

    return {
      totalSessions: sessions.length,
      activeSessions: sessions.filter((s) => s.status === SessionStatus.ACTIVE)
        .length,
      archivedSessions: sessions.filter(
        (s) => s.status === SessionStatus.ARCHIVED
      ).length,
      averageSessionDuration:
        sessions.length > 0 ? totalDuration / sessions.length : 0,
      totalMessages,
    };
  }

  async getSessionMessageCount(sessionId: string): Promise<number> {
    const messages = this.messages.get(sessionId) || [];
    return messages.length;
  }

  async beginTransaction(): Promise<Transaction> {
    return {
      async commit(): Promise<void> {},
      async rollback(): Promise<void> {},
    };
  }

  sessionIdExists(sessionId: string): Promise<boolean> {
    return Promise.resolve(this.sessions.has(sessionId));
  }

  getStorageInfo(): StorageConfig {
    return {
      type: 'memory',
    };
  }
}

/**
 * 创建存储适配器
 */
export function createStorageAdapter(
  sessionStorage: SessionStorage
): UnifiedSessionStorage {
  return new StorageAdapter(sessionStorage);
}
