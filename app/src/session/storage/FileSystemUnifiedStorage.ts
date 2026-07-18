import fs from 'fs/promises';
import { Dirent } from 'fs';
import path from 'path';

import { registerStorage } from './StorageFactory.js';
import { StorageType } from './UnifiedStorage.js';
import type {
  UnifiedSessionStorage,
  StorageConfig,
  Transaction,
  UnifiedMessageQueryOptions,
} from './UnifiedStorage.js';
import { resolveSessionsDir } from '@modules/core';
import type {
  UnifiedSession,
  SessionFilter,
  SessionStats,
} from '../types/Session.js';
import type { UnifiedMessage } from '../types/Message.js';
import { AtomicWriter } from '../persistence/AtomicWriter.js';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'session:storage:FileSystemUnifiedStorage', level: LogLevel.INFO });

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

function sessionDir(basePath: string, sessionId: string): string {
  return path.join(basePath, sessionId);
}

function sessionFilePath(basePath: string, sessionId: string): string {
  return path.join(sessionDir(basePath, sessionId), 'session.json');
}

function messagesFilePath(basePath: string, sessionId: string): string {
  return path.join(sessionDir(basePath, sessionId), 'messages.jsonl');
}

export class FileSystemUnifiedStorage implements UnifiedSessionStorage {
  private sessions: Map<string, UnifiedSession> = new Map();
  private messages: Map<string, UnifiedMessage[]> = new Map();
  private config: StorageConfig;
  private basePath: string;
  private writer: AtomicWriter;
  private initialized = false;

  constructor(config: StorageConfig) {
    this.config = config;
    this.basePath = config.basePath ?? resolveSessionsDir();
    this.writer = new AtomicWriter();
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.basePath, { recursive: true });
    await this.loadAllSessions();
    this.initialized = true;
  }

  async close(): Promise<void> {
    this.sessions.clear();
    this.messages.clear();
    this.initialized = false;
  }

  private async loadAllSessions(): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(this.basePath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const sessionId = entry.name;
      const filePath = sessionFilePath(this.basePath, sessionId);
      try {
        const data = await fs.readFile(filePath, 'utf-8');
        const session: UnifiedSession = JSON.parse(data);
        this.sessions.set(sessionId, session);
      } catch {
        continue;
      }

      await this.loadMessages(sessionId);
    }
  }

  private async loadMessages(sessionId: string): Promise<void> {
    const filePath = messagesFilePath(this.basePath, sessionId);
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      const lines = data.split('\n').filter((l) => l.trim().length > 0);
      const msgs: UnifiedMessage[] = [];
      const seenIds = new Set<string>();
      for (const line of lines) {
        const msg: UnifiedMessage = JSON.parse(line);
        if (!seenIds.has(msg.id)) {
          seenIds.add(msg.id);
          msgs.push(msg);
        }
      }
      this.messages.set(sessionId, msgs);
    } catch {
      this.messages.set(sessionId, []);
    }
  }

  private async persistSession(session: UnifiedSession): Promise<void> {
    const dir = sessionDir(this.basePath, session.id);
    await fs.mkdir(dir, { recursive: true });
    await this.writer.writeJSON(
      sessionFilePath(this.basePath, session.id),
      session
    );
  }

  private async persistMessageAppend(
    sessionId: string,
    message: UnifiedMessage
  ): Promise<void> {
    const dir = sessionDir(this.basePath, sessionId);
    await fs.mkdir(dir, { recursive: true });
    const line = JSON.stringify(message) + '\n';
    await this.writer.append(messagesFilePath(this.basePath, sessionId), line);
  }

  private async persistMessagesRewrite(
    sessionId: string,
    messages: UnifiedMessage[]
  ): Promise<void> {
    const dir = sessionDir(this.basePath, sessionId);
    await fs.mkdir(dir, { recursive: true });
    const data = messages.map((m) => JSON.stringify(m)).join('\n') + '\n';
    await this.writer.write(messagesFilePath(this.basePath, sessionId), data);
  }

  async createSession(session: UnifiedSession): Promise<string> {
    this.sessions.set(session.id, { ...session });
    this.messages.set(session.id, []);
    await this.persistSession(session);
    return session.id;
  }

  async getSession(sessionId: string): Promise<UnifiedSession | null> {
    const session = this.sessions.get(sessionId);
    return session ? { ...session } : null;
  }

  async updateSession(session: UnifiedSession): Promise<void> {
    this.sessions.set(session.id, { ...session });
    await this.persistSession(session);
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
    this.messages.delete(sessionId);

    const dir = sessionDir(this.basePath, sessionId);
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch (err) {

      // ignore cleanup errors

      logger.debug("Operation skipped", { context: "ignore cleanup errors", error: err instanceof Error ? err.message : String(err) });

    }
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
    await this.persistMessageAppend(sessionId, message);
  }

  async getMessages(
    sessionId: string,
    options?: UnifiedMessageQueryOptions
  ): Promise<UnifiedMessage[]> {
    const msgs = this.messages.get(sessionId) ?? [];
    let result = msgs.map((m) => ({ ...m }));
    if (options?.limit) {
      result = result.slice(-options.limit);
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
      await this.persistMessagesRewrite(sessionId, msgs);
    }
  }

  async deleteMessage(sessionId: string, messageId: string): Promise<void> {
    const msgs = this.messages.get(sessionId);
    if (!msgs) return;
    const filtered = msgs.filter((m) => m.id !== messageId);
    this.messages.set(sessionId, filtered);
    await this.persistMessagesRewrite(sessionId, filtered);
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

    const data = messages.map((m) => JSON.stringify(m)).join('\n') + '\n';
    const dir = sessionDir(this.basePath, sessionId);
    await fs.mkdir(dir, { recursive: true });
    await this.writer.append(messagesFilePath(this.basePath, sessionId), data);
  }

  async deleteMessages(sessionId: string, messageIds: string[]): Promise<void> {
    const msgs = this.messages.get(sessionId);
    if (!msgs) return;
    const idSet = new Set(messageIds);
    const filtered = msgs.filter((m) => !idSet.has(m.id));
    this.messages.set(sessionId, filtered);
    await this.persistMessagesRewrite(sessionId, filtered);
  }

  async getSessionStats(sessionId?: string): Promise<SessionStats> {
    if (sessionId) {
      const session = this.sessions.get(sessionId);
      if (!session) {
        return {
          totalSessions: 0,
          totalMessages: 0,
          sessions: [],
        } as unknown as SessionStats;
      }
      const msgs = this.messages.get(sessionId) ?? [];
      return {
        totalSessions: 1,
        totalMessages: msgs.length,
        sessions: [session.id],
      } as unknown as SessionStats;
    }

    let totalMessages = 0;
    for (const msgs of this.messages.values()) {
      totalMessages += msgs.length;
    }

    return {
      totalSessions: this.sessions.size,
      totalMessages,
      sessions: Array.from(this.sessions.keys()),
    } as unknown as SessionStats;
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

  sessionIdExists(sessionId: string): Promise<boolean> {
    return Promise.resolve(this.sessions.has(sessionId));
  }

  getStorageInfo(): StorageConfig {
    return { ...this.config };
  }
}

registerStorage(StorageType.FILESYSTEM, FileSystemUnifiedStorage);
