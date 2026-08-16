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
  // P0 路径穿越双保险：resolve 后必须仍位于 basePath 内，拒绝 ../ 越界目录
  const base = path.resolve(basePath);
  const dir = path.resolve(base, sessionId);
  if (dir === base || !dir.startsWith(base + path.sep)) {
    throw new Error(`非法 sessionId（路径越界）: ${sessionId}`);
  }
  return dir;
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
 * APPEND_REWRITE_INTERVAL 次（或累计体积达阈值）执行一次全量重写（compact）
 * 回收重复行。
 * 第 6/7 条改造：compact 已异步化（fire-and-forget 入写队列），阈值可配置
 * （StorageConfig.appendRewriteInterval / appendRewriteBytes）。
 */
const DEFAULT_APPEND_REWRITE_INTERVAL = 100;
const DEFAULT_APPEND_REWRITE_BYTES = 2 * 1024 * 1024;

export class FileSystemUnifiedStorage implements UnifiedSessionStorage {
  private sessions: Map<string, UnifiedSession> = new Map();
  private messages: Map<string, UnifiedMessage[]> = new Map();
  private config: StorageConfig;
  private basePath: string;
  private writer: AtomicWriter;
  private initialized = false;
  /**
   * per-session 写队列（P0-1/P2-17 修复）：append 与 compact 是分离的 await，
   * 并发调用时同会话的追加与全量重写会在 OS 层竞争（整行丢失/重复）。
   * 同一 session 的全部落盘操作串行化，消除跨 syscall 竞态。
   */
  private writeQueues: Map<string, Promise<void>> = new Map();
  /** 增量追加计数（per-session）：达阈值后触发该会话 compact */
  private appendCounts: Map<string, number> = new Map();
  /** 累计追加行字节估算（per-session，第 7 条）：长消息会话按体积触发 compact */
  private appendBytes: Map<string, number> = new Map();

  constructor(config: StorageConfig) {
    this.config = config;
    this.basePath = config.basePath ?? resolveSessionsDir();
    this.writer = new AtomicWriter();
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.basePath, { recursive: true });
    await this.purgeExpiredTrash();
    await this.loadAllSessions();
    this.initialized = true;
  }

  async close(): Promise<void> {
    this.sessions.clear();
    this.messages.clear();
    this.messageAccessOrder = [];
    this.appendCounts.clear();
    this.appendBytes.clear();
    this.initialized = false;
  }

  /** .trash 软删除保留时长（P1 修复：TTL 自动清理，防止回收站无限膨胀） */
  private static readonly TRASH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  /** 清理过期 .trash 项（mtime 超过 TTL 的软删除目录物理删除） */
  private async purgeExpiredTrash(): Promise<void> {
    const trashRoot = path.join(this.basePath, '.trash');
    let entries: Dirent[];
    try {
      entries = await fs.readdir(trashRoot, { withFileTypes: true });
    } catch {
      return; // .trash 不存在或不可读，无需清理
    }
    const now = Date.now();
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const fullPath = path.join(trashRoot, entry.name);
      try {
        const stat = await fs.stat(fullPath);
        if (now - stat.mtimeMs > FileSystemUnifiedStorage.TRASH_TTL_MS) {
          await fs.rm(fullPath, { recursive: true, force: true });
          logger.info('清理过期 .trash 项', {
            path: fullPath,
            ageDays: Number(((now - stat.mtimeMs) / 86400000).toFixed(1)),
          });
        }
      } catch (err) {
        logger.warn('清理 .trash 项失败，跳过', {
          path: fullPath,
          error: String(err),
        });
      }
    }
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
      } catch (err) {
        // P2-16 修复：损坏的 session.json（断电半写/手动编辑出错）此前静默跳过，
        // 用户以为会话丢失。改为隔离到 <root>/.corrupt/{id}/（连同 messages）并告警，
        // 保留恢复路径而非无声消失。
        logger.warn('会话文件损坏，隔离到 .corrupt/', {
          sessionId,
          filePath,
          error: String(err),
        });
        try {
          const corruptDir = path.join(this.basePath, '.corrupt', sessionId);
          await fs.rename(sessionDir(this.basePath, sessionId), corruptDir);
        } catch (renameErr) {
          logger.warn('隔离损坏会话目录失败', {
            sessionId,
            error: String(renameErr),
          });
        }
        continue;
      }

      // P1-3 修复：initialize 不再预载全部会话消息（懒加载，见 ensureMessagesLoaded）
    }
  }

  /**
   * P1-3 修复：消息按需加载 + 缓存上限逐出。
   * 原实现 initialize 时把全部会话消息读入内存（无上限）；现改为：
   * - 首次访问某会话消息时才读盘（懒加载）
   * - messages Map 超 MESSAGE_CACHE_MAX 个会话时逐出最久未访问者
   * loadMessages 反向去重幂等，逐出后再次访问重新加载安全。
   */
  private static readonly MESSAGE_CACHE_MAX = 50;
  private messageAccessOrder: string[] = [];

  private async ensureMessagesLoaded(sessionId: string): Promise<void> {
    if (this.messages.has(sessionId)) {
      this.touchMessageAccess(sessionId);
      return;
    }
    await this.loadMessages(sessionId);
    this.touchMessageAccess(sessionId);
    this.evictMessageCacheIfNeeded();
  }

  private touchMessageAccess(sessionId: string): void {
    const idx = this.messageAccessOrder.indexOf(sessionId);
    if (idx !== -1) this.messageAccessOrder.splice(idx, 1);
    this.messageAccessOrder.push(sessionId);
  }

  private evictMessageCacheIfNeeded(): void {
    while (
      this.messageAccessOrder.length >
      FileSystemUnifiedStorage.MESSAGE_CACHE_MAX
    ) {
      const oldest = this.messageAccessOrder.shift();
      if (!oldest) break;
      this.messages.delete(oldest);
      this.appendCounts.delete(oldest);
      this.appendBytes.delete(oldest);
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

  /**
   * 将写操作按会话串行化执行：前一个操作完成（无论成败）后才执行下一个，
   * 保证同一会话的 append/compact 不跨 syscall 竞争。队列尾部自动清理。
   */
  private enqueueWrite(
    sessionId: string,
    op: () => Promise<void>
  ): Promise<void> {
    const prev = this.writeQueues.get(sessionId) ?? Promise.resolve();
    const next = prev.then(op, op);
    this.writeQueues.set(sessionId, next);
    next
      .finally(() => {
        if (this.writeQueues.get(sessionId) === next) {
          this.writeQueues.delete(sessionId);
        }
      })
      .catch(() => {
        // 错误由调用方处理，队列清理不抛
      });
    return next;
  }

  /**
   * 定期 compact 异步化（第 6 条）：把"全量重写 + 读回校验"作为一个 op 排入
   * per-session 写队列，fire-and-forget——调用方不等 compact 完成，消除
   * updateMessage 主流程的同步阻塞。队列串行保证与 append 不跨 syscall 竞争
   * （P0-1 语义保留）；op 执行时读取当前内存快照（触发后到执行间的更新一并
   * 落盘，不丢数据）。enqueueWrite 内部已挂 catch，无需担心 unhandledRejection。
   */
  private enqueueCompact(sessionId: string): void {
    void this.enqueueWrite(sessionId, async () => {
      const msgs = this.messages.get(sessionId);
      if (!msgs) return;
      logger.debug('compact:新链 FileSystemUnifiedStorage 异步 compact 执行', {
        sessionId,
      });
      logger.info('compact 异步执行开始', {
        sessionId,
        memoryMessageCount: msgs.length,
      });
      const compactStart = Date.now();
      await this.persistMessagesRewrite(sessionId, msgs);
      const compactElapsedMs = Date.now() - compactStart;
      // 读回磁盘行数校验一致性——增量追加期间同 id 可能多行，compact 全量
      // 重写后应回到"每消息一行"（行数 == 内存唯一消息数）。差异定位同
      // updateMessage 原逻辑（diffDiskVsMemory）。
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
        logger.warn('compact 异步完成但一致性校验失败', {
          sessionId,
          compactElapsedMs,
          memoryMessageCount: msgs.length,
          diskLineCount,
          ...consistencyDiff,
          impact:
            '仅 duplicatedIds 时可安全忽略（读取不受影响）；含 missingIds/orphanIds 需人工排查',
        });
      } else {
        logger.info('compact 异步完成', {
          sessionId,
          compactElapsedMs,
          memoryMessageCount: msgs.length,
          diskLineCount,
          consistent: diskLineCount === msgs.length,
        });
      }
    });
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
    logger.debug('deleteSession:新链 FileSystemUnifiedStorage 软删除', {
      sessionId,
    });
    this.sessions.delete(sessionId);
    this.messages.delete(sessionId);

    const dir = sessionDir(this.basePath, sessionId);
    try {
      // P1 第10条：软删除——rename 到 .trash/（带时间戳避免同名冲突），
      // 误删可恢复，不再直接 fs.rm 物理删除（与 SessionPruner/Supervisor 的
      // "不物理删除"策略对齐）。TTL 自动清理 .trash 留待后续。
      const trashDir = path.join(
        this.basePath,
        '.trash',
        `${sessionId}_${Date.now()}`
      );
      await fs.mkdir(path.dirname(trashDir), { recursive: true });
      await fs.rename(dir, trashDir);
    } catch (err) {
      // 目标不存在（会话目录可能已物理删除/损坏隔离）时忽略
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
    // P1-3：按需加载（保证内存中有该会话消息数组）
    await this.ensureMessagesLoaded(sessionId);
    return this.enqueueWrite(sessionId, async () => {
      const msgs = this.messages.get(sessionId) ?? [];
      msgs.push({ ...message });
      this.messages.set(sessionId, msgs);
      await this.persistMessageAppend(sessionId, message);
    });
  }

  async getMessages(
    sessionId: string,
    options?: UnifiedMessageQueryOptions
  ): Promise<UnifiedMessage[]> {
    // P1-3：按需加载（懒加载会话消息）
    await this.ensureMessagesLoaded(sessionId);
    const msgs = this.messages.get(sessionId) ?? [];
    let result = msgs.map((m) => ({ ...m }));
    // P1-13 修复：此前仅处理 limit，startDate/endDate/offset/types/roles/parentUuid 被静默吞掉
    if (options?.startDate !== undefined) {
      result = result.filter((m) => m.timestamp >= options.startDate!);
    }
    if (options?.endDate !== undefined) {
      result = result.filter((m) => m.timestamp <= options.endDate!);
    }
    if (options?.types?.length) {
      const typeSet = new Set(options.types);
      result = result.filter((m) => typeSet.has(m.type));
    }
    if (options?.roles?.length) {
      const roleSet = new Set(options.roles);
      result = result.filter(
        (m) => m.role !== undefined && roleSet.has(m.role)
      );
    }
    if (options?.parentUuid !== undefined) {
      result = result.filter((m) => m.parentUuid === options.parentUuid);
    }
    // 分页语义（P1 修复）：offset 表示从最新一条往前跳过 N 条（聊天历史分页），
    // limit 表示取最近 N 条。二者组合：先按 offset 往前跳，再取末尾 limit 条。
    if (options?.offset) {
      result = result.slice(0, Math.max(0, result.length - options.offset));
    }
    // 保持原语义：limit 取最近 N 条（slice 负索引）
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
    // P1-3：按需加载
    await this.ensureMessagesLoaded(sessionId);
    return this.enqueueWrite(sessionId, async () => {
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
        // 定期 compact（第 6/7 条改造）：追加次数或累计体积达阈值即触发，异步化——
        // fire-and-forget 入写队列后台重写（enqueueCompact），不再阻塞 updateMessage。
        // P0-1：计数为 per-session（原全局计数会让活跃会话触发所有会话的 compact）。
        const appendCount = (this.appendCounts.get(sessionId) ?? 0) + 1;
        const appendBytes =
          (this.appendBytes.get(sessionId) ?? 0) +
          Buffer.byteLength(JSON.stringify(msgs[idx]), 'utf-8');
        const interval =
          this.config.appendRewriteInterval ?? DEFAULT_APPEND_REWRITE_INTERVAL;
        const bytesThreshold =
          this.config.appendRewriteBytes ?? DEFAULT_APPEND_REWRITE_BYTES;
        if (appendCount >= interval || appendBytes >= bytesThreshold) {
          this.appendCounts.set(sessionId, 0);
          this.appendBytes.set(sessionId, 0);
          logger.info('updateMessage: compact 触发（异步入队）', {
            sessionId,
            reason: 'append_count_or_bytes_reached',
            appendCount,
            appendBytes,
            interval,
            bytesThreshold,
            hitPath:
              msgs[idx].id === messageId ? 'direct' : 'fallback_by_message_id',
            updatedMessageId: message.id,
          });
          this.enqueueCompact(sessionId);
        } else {
          this.appendCounts.set(sessionId, appendCount);
          this.appendBytes.set(sessionId, appendBytes);
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
    });
  }

  async deleteMessage(sessionId: string, messageId: string): Promise<void> {
    // P1-3：按需加载
    await this.ensureMessagesLoaded(sessionId);
    return this.enqueueWrite(sessionId, async () => {
      const msgs = this.messages.get(sessionId);
      if (!msgs) return;
      const filtered = msgs.filter((m) => m.id !== messageId);
      this.messages.set(sessionId, filtered);
      await this.persistMessagesRewrite(sessionId, filtered);
    });
  }

  async searchMessages(
    sessionId: string,
    query: string
  ): Promise<UnifiedMessage[]> {
    // P1-3：按需加载
    await this.ensureMessagesLoaded(sessionId);
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
    // P1-3：按需加载
    await this.ensureMessagesLoaded(sessionId);
    return this.enqueueWrite(sessionId, async () => {
      const msgs = this.messages.get(sessionId) ?? [];
      for (const m of messages) {
        msgs.push({ ...m });
      }
      this.messages.set(sessionId, msgs);

      const data = messages.map((m) => JSON.stringify(m)).join('\n') + '\n';
      const dir = sessionDir(this.basePath, sessionId);
      await fs.mkdir(dir, { recursive: true });
      await this.writer.append(
        messagesFilePath(this.basePath, sessionId),
        data
      );
    });
  }

  async deleteMessages(sessionId: string, messageIds: string[]): Promise<void> {
    // P1-3：按需加载
    await this.ensureMessagesLoaded(sessionId);
    return this.enqueueWrite(sessionId, async () => {
      const msgs = this.messages.get(sessionId);
      if (!msgs) return;
      const idSet = new Set(messageIds);
      const filtered = msgs.filter((m) => !idSet.has(m.id));
      this.messages.set(sessionId, filtered);
      await this.persistMessagesRewrite(sessionId, filtered);
    });
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
      // P1-3：按需加载，保证消息数真实
      await this.ensureMessagesLoaded(sessionId);
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
    // P1-3：按需加载（逐出后再次访问需重新读盘）
    await this.ensureMessagesLoaded(sessionId);
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
