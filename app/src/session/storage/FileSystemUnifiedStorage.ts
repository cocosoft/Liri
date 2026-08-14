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
import { handleError } from '@modules/error';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('session:storage:FileSystemUnifiedStorage');

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

/**
 * 增量写入方案（2026-08-14）：updateMessage 改为 O(1) 追加后，同 id 在
 * messages.jsonl 中可能出现多行（旧行 + 新行）。loadMessages 反向去重
 * （后写覆盖先写）保证取最新值；但文件会随更新次数增长，故每追加
 * APPEND_REWRITE_INTERVAL 次执行一次全量重写（compact）回收重复行。
 */
const APPEND_REWRITE_INTERVAL = 100;

export class FileSystemUnifiedStorage implements UnifiedSessionStorage {
  private sessions: Map<string, UnifiedSession> = new Map();
  private messages: Map<string, UnifiedMessage[]> = new Map();
  private config: StorageConfig;
  private basePath: string;
  private writer: AtomicWriter;
  private initialized = false;
  /** 增量追加计数：达 APPEND_REWRITE_INTERVAL 后触发 compact（全量重写） */
  private _appendCount = 0;

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
      // 增量写入方案（2026-08-14）：updateMessage 改为追加后同 id 可能多行，
      // 反向去重——后写覆盖先写（Map.set 天然覆盖），兼容旧全量重写格式
      // （旧格式无重复 id，行为不变）。注意与 updateMessage 的追加必须同步落地。
      const msgMap = new Map<string, UnifiedMessage>();
      for (const line of lines) {
        const msg: UnifiedMessage = JSON.parse(line);
        msgMap.set(msg.id, msg);
      }
      this.messages.set(sessionId, [...msgMap.values()]);
    } catch {
      this.messages.set(sessionId, []);
    }
  }

  /**
   * compact 后一致性校验定位（2026-08-14）：
   * 磁盘行数 != 内存消息数时，按消息 id 对比两侧，定位三类差异：
   * - duplicatedIds：磁盘中同 id 出现多次（增量追加旧行未被回收，或并发写入竞争）
   * - missingIds：内存有但磁盘无（compact 重写时丢失）
   * - orphanIds：磁盘有但内存无（孤儿行，如其他进程/旧格式残留）
   * @returns 差异明细；两侧完全一致时返回空数组
   */
  private diffDiskVsMemory(
    _sessionId: string,
    diskLines: string[],
    memoryMsgs: UnifiedMessage[]
  ): {
    duplicatedIds: Array<{ id: string; count: number }>;
    missingIds: string[];
    orphanIds: string[];
  } {
    const diskCount = new Map<string, number>();
    for (const line of diskLines) {
      try {
        const msg = JSON.parse(line) as UnifiedMessage;
        diskCount.set(msg.id, (diskCount.get(msg.id) ?? 0) + 1);
      } catch {
        // 坏行不计入（解析失败，非本方案可定位范围）
      }
    }
    const memoryIds = new Set(memoryMsgs.map((m) => m.id));
    return {
      duplicatedIds: [...diskCount.entries()]
        .filter(([, count]) => count > 1)
        .map(([id, count]) => ({ id, count })),
      missingIds: [...memoryIds].filter((id) => !diskCount.has(id)),
      orphanIds: [...diskCount.keys()].filter((id) => !memoryIds.has(id)),
    };
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

      handleError(err, {
        module: 'session:storage',
        action: 'deleteSession',
      });
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
    let idx = msgs.findIndex((m) => m.id === messageId);
    // P1 加固（2026-08-14）：调用方可能传错 id（如前端 UUID vs 后端 msg-xxx），
    // 原实现找不到时静默 return 导致 blocks 永不落盘。降级按消息自身 id 再查一次。
    if (idx === -1 && message.id && message.id !== messageId) {
      idx = msgs.findIndex((m) => m.id === message.id);
    }
    if (idx !== -1) {
      msgs[idx] = { ...message };
      // 增量写入方案（2026-08-14）：O(1) 追加替代全量重写 O(n)——
      // 长会话下每轮 blocks 保存不再重写整个 messages.jsonl。
      // loadMessages 已反向去重（后写覆盖），同 id 多行读取安全。
      const writeStart = Date.now();
      await this.persistMessageAppend(sessionId, msgs[idx]);
      const writeElapsedMs = Date.now() - writeStart;
      // 定期 compact：追加次数达阈值后全量重写一次，回收重复行防文件无限增长
      this._appendCount++;
      if (this._appendCount >= APPEND_REWRITE_INTERVAL) {
        this._appendCount = 0;
        const compactStart = Date.now();
        // 触发前：记录内存唯一消息数（compact 后磁盘行数应与之相等，供一致性核对）
        logger.debug('updateMessage: compact 触发', {
          sessionId,
          reason: 'append_count_reached',
          threshold: APPEND_REWRITE_INTERVAL,
          memoryMessageCount: msgs.length,
          updatedMessageId: message.id,
        });
        await this.persistMessagesRewrite(sessionId, msgs);
        const compactElapsedMs = Date.now() - compactStart;
        // 触发后：读回磁盘行数校验一致性——增量追加期间同 id 可能多行，
        // compact 全量重写后应回到"每消息一行"（行数 == 内存唯一消息数）。
        // 行数不一致时自动定位重复/丢失/孤儿的具体消息 id。
        let diskLineCount = -1;
        let consistencyDiff: {
          duplicatedIds: Array<{ id: string; count: number }>;
          missingIds: string[];
          orphanIds: string[];
        } | null = null;
        try {
          const diskData = await fs.readFile(
            messagesFilePath(this.basePath, sessionId),
            'utf-8'
          );
          const diskLines = diskData
            .split('\n')
            .filter((l) => l.trim().length > 0);
          diskLineCount = diskLines.length;
          if (diskLineCount !== msgs.length) {
            consistencyDiff = this.diffDiskVsMemory(sessionId, diskLines, msgs);
          }
        } catch {
          // 读取失败不影响主流程（-1 表示校验未执行）
        }
        if (consistencyDiff) {
          logger.warn('updateMessage: compact 一致性校验失败', {
            sessionId,
            compactElapsedMs,
            memoryMessageCount: msgs.length,
            diskLineCount,
            ...consistencyDiff,
            // 差异解读（供排查，不做自动修复——修复动作会掩盖并发/写路径根因，
            // orphan 删除可能销毁仍被其他逻辑使用的数据）：
            // duplicatedIds → 不影响读取（loadMessages 取最后值），文件冗余，下次 compact 回收；
            //                   持续出现提示并发写入（append 与 compact 竞争）
            // missingIds   → 疑似重写丢失/并发修改，需人工核对写入路径，自动重写可能再次丢失
            // orphanIds    → 疑似未知写入源/旧数据残留，勿自动删除，需人工排查写入来源
            impact:
              '仅 duplicatedIds 时可安全忽略（读取不受影响）；含 missingIds/orphanIds 需人工排查',
          });
        } else {
          logger.debug('updateMessage: compact 完成', {
            sessionId,
            compactElapsedMs,
            memoryMessageCount: msgs.length,
            diskLineCount,
            consistent: diskLineCount === msgs.length,
          });
        }
      }
      // 排查日志：storage 层增量落盘（直接命中 vs 降级按 message.id 命中）
      logger.debug('updateMessage: blocks 增量落盘', {
        sessionId,
        hitPath:
          msgs[idx].id === messageId ? 'direct' : 'fallback_by_message_id',
        storedId: msgs[idx].id,
        requestedId: messageId,
        writeElapsedMs,
        storedCount: msgs.length,
      });
    } else {
      // 仍找不到：记录日志避免静默丢失（消息可能尚未在 storage 中创建）
      logger.warn('updateMessage: 未找到目标消息，更新被丢弃', {
        sessionId,
        messageId,
        fallbackId: message.id,
        storedCount: msgs.length,
      });
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
