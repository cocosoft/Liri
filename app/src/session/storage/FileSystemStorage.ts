import { promises as fs, existsSync } from 'fs';
import { join, dirname, resolve, sep } from 'path';
import { handleError } from '@modules/error';
import { getLogger } from '@modules/monitoring';
import { Session } from '../models/Session';
import { SessionMessage } from '../models/SessionMessage';
import { SessionMetadata } from '../models/SessionMetadata';
import type {
  SessionStorage,
  MessageLoadOptions,
  SessionListOptions,
} from '../SessionStorage';
import { resolveSessionsDir } from '@modules/core';
import { AtomicWriter } from '../persistence/AtomicWriter.js';

const logger = getLogger('session:storage');

/**
 * 文件系统存储实现
 * 用于持久化会话存储，将会话数据存储到文件系统
 */
export class FileSystemStorage implements SessionStorage {
  /**
   * 存储根目录
   */
  private rootDir: string;
  private writer: AtomicWriter;

  /**
   * 构造函数
   * @param rootDir 存储根目录
   */
  constructor(rootDir: string = resolveSessionsDir()) {
    this.rootDir = rootDir;
    this.writer = new AtomicWriter();
  }

  /**
   * 确保目录存在
   * @param dir 目录路径
   */
  private async ensureDir(dir: string): Promise<void> {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      // 目录已存在，忽略错误
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    }
  }

  /**
   * 获取会话目录
   * @param sessionId 会话ID
   * @returns 会话目录路径
   */
  private getSessionDir(sessionId: string): string {
    // P0 路径穿越双保险：resolve 后必须仍位于 rootDir 内，拒绝 ../ 越界目录
    const base = resolve(this.rootDir);
    const dir = resolve(base, sessionId);
    if (dir === base || !dir.startsWith(base + sep)) {
      throw new Error(`非法 sessionId（路径越界）: ${sessionId}`);
    }
    return dir;
  }

  /**
   * 获取会话文件路径
   * @param sessionId 会话ID
   * @returns 会话文件路径
   */
  private getSessionFilePath(sessionId: string): string {
    return join(this.getSessionDir(sessionId), 'session.json');
  }

  /**
   * 获取消息文件路径
   * @param sessionId 会话ID
   * @returns 消息文件路径
   */
  private getMessagesFilePath(sessionId: string): string {
    return join(this.getSessionDir(sessionId), 'messages.jsonl');
  }

  /**
   * 获取元数据文件路径
   * @param sessionId 会话ID
   * @returns 元数据文件路径
   */
  private getMetadataFilePath(sessionId: string): string {
    return join(this.getSessionDir(sessionId), 'metadata.json');
  }

  /**
   * 保存会话
   * @param session 会话对象
   */
  async saveSession(session: Session): Promise<void> {
    const sessionDir = this.getSessionDir(session.id);
    await this.ensureDir(sessionDir);

    const sessionFilePath = this.getSessionFilePath(session.id);
    const sessionData = session.toJSON();
    await fs.writeFile(sessionFilePath, JSON.stringify(sessionData, null, 2));
  }

  /**
   * 加载会话
   * @param sessionId 会话ID
   * @returns 会话对象或null
   */
  async loadSession(sessionId: string): Promise<Session | null> {
    const sessionFilePath = this.getSessionFilePath(sessionId);

    try {
      const content = await fs.readFile(sessionFilePath, 'utf-8');
      const data = JSON.parse(content);
      return Session.fromJSON(data);
    } catch (error) {
      // M3-fix: 对齐新链 .corrupt 隔离 —— ENOENT（会话不存在）正常返回 null，
      // 其余错误（JSON 损坏/断电半写）视为损坏，隔离目录并告警而非静默吞错。
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return null;
      }
      logger.warn('会话文件损坏，隔离到 .corrupt/（旧链）', {
        sessionId,
        filePath: sessionFilePath,
        error: String(error),
      });
      try {
        const corruptDir = join(this.rootDir, '.corrupt', sessionId);
        await fs.rename(this.getSessionDir(sessionId), corruptDir);
      } catch (renameErr) {
        logger.warn('隔离损坏会话目录失败', {
          sessionId,
          error: String(renameErr),
        });
      }
      await handleError(error, {
        module: 'sessions:storage',
        action: `加载会话失败: ${sessionId}`,
      });
      return null;
    }
  }

  /**
   * 保存消息
   * @param sessionId 会话ID
   * @param message 消息对象
   */
  async saveMessage(sessionId: string, message: SessionMessage): Promise<void> {
    const sessionDir = this.getSessionDir(sessionId);
    await this.ensureDir(sessionDir);

    const messagesFilePath = this.getMessagesFilePath(sessionId);
    const messageJson = JSON.stringify(message.toJSON());
    await fs.appendFile(messagesFilePath, messageJson + '\n');
  }

  /**
   * 加载消息
   * @param sessionId 会话ID
   * @param options 加载选项
   * @returns 消息列表
   */
  async loadMessages(
    sessionId: string,
    options?: MessageLoadOptions
  ): Promise<SessionMessage[]> {
    const messagesFilePath = this.getMessagesFilePath(sessionId);

    try {
      const content = await fs.readFile(messagesFilePath, 'utf-8');
      const lines = content.trim().split('\n');

      let badLines = 0;
      let messages = lines
        .map((line) => {
          try {
            const data = JSON.parse(line);
            return SessionMessage.fromJSON(data);
          } catch {
            // KB-FS-LOAD-BADLINE（2026-08-29）：坏行静默跳过 → 数据损坏不可感知
            // （与 compactSession 的 badLines 计数对齐）
            badLines++;
            return null;
          }
        })
        .filter((msg): msg is SessionMessage => msg !== null);
      if (badLines > 0) {
        logger.warn('loadMessages:存在损坏行，已跳过', {
          sessionId,
          badLines,
          totalLines: lines.length,
          messagesFilePath,
        });
      }

      // 应用过滤选项
      if (options) {
        if (options.since) {
          messages = messages.filter((msg) => msg.createdAt >= options.since!);
        }

        if (options.until) {
          messages = messages.filter((msg) => msg.createdAt <= options.until!);
        }

        if (options.types) {
          messages = messages.filter((msg) =>
            options.types!.includes(msg.type)
          );
        }

        // 应用分页选项
        if (options.offset) {
          messages = messages.slice(options.offset);
        }

        if (options.limit) {
          messages = messages.slice(0, options.limit);
        }
      }

      return messages;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // K-6 P2 会话数据自动修复：messages.jsonl ENOENT 但 session.json 存在
      // → 会话磁盘数据不完整（文件被外部清理/磁盘损坏/半写入中断），
      //   自动软删除该会话，避免 DB/sessions 索引残留的"僵尸记录"继续
      //   出现在列表里但切换读不到任何消息。软删除后可在 .trash 找回。
      if (code === 'ENOENT') {
        const sessionMetaPath = this.getSessionFilePath(sessionId);
        try {
          // ⚠️ existsSync 是 `import { existsSync } from 'fs'` 直接 import 的顶层函数，
          // 不是 fs（= fs.promises）对象上的方法（fs.promises 上不存在同步 API）
          if (existsSync(sessionMetaPath)) {
            logger.warn(
              'K-6 loadMessages: messages.jsonl 丢失但 session.json 存在，自动软删除僵尸会话',
              { sessionId, messagesFilePath, sessionMetaPath }
            );
            await this.deleteSession(sessionId);
          }
        } catch (cleanErr) {
          logger.warn('K-6 loadMessages: 自动软删除失败，已吞错避免阻塞上层', {
            sessionId,
            error: String(cleanErr),
          });
        }
        return [];
      }
      // 非 ENOENT 错误（EACCES/EIO 等）原样告警 + 空返回（与历史行为对齐）
      logger.error('loadMessages: 读取异常（非 ENOENT）', {
        sessionId,
        code,
        error: String(error),
      });
      return [];
    }
  }

  /**
   * 保存元数据
   * @param sessionId 会话ID
   * @param metadata 元数据对象
   */
  async saveMetadata(
    sessionId: string,
    metadata: SessionMetadata
  ): Promise<void> {
    const sessionDir = this.getSessionDir(sessionId);
    await this.ensureDir(sessionDir);

    const metadataFilePath = this.getMetadataFilePath(sessionId);
    await fs.writeFile(
      metadataFilePath,
      JSON.stringify(metadata.toJSON(), null, 2)
    );
  }

  /**
   * 加载元数据
   * @param sessionId 会话ID
   * @returns 元数据对象或null
   */
  async loadMetadata(sessionId: string): Promise<SessionMetadata | null> {
    const metadataFilePath = this.getMetadataFilePath(sessionId);

    try {
      const content = await fs.readFile(metadataFilePath, 'utf-8');
      const data = JSON.parse(content);
      return SessionMetadata.fromJSON(data);
    } catch (error) {
      // KB-FS-META（2026-08-29）：ENOENT（元数据不存在，预期）与 JSON 损坏
      // （断电半写，数据问题）此前混为一谈静默返回 null → 标题/模式/tags 丢失
      // 不可感知。区分：非 ENOENT 记录 warn。
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('loadMetadata:读取/解析失败', {
          sessionId,
          metadataFilePath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return null;
    }
  }

  /**
   * 删除会话（P1-1 双存储对齐：软删除语义）
   * 对齐 FileSystemUnifiedStorage：rename 到 .trash/（带时间戳避免同名冲突），
   * 误删可恢复，不再直接 fs.rm 物理删除。.trash 的 TTL 清理由
   * FileSystemUnifiedStorage.purgeExpiredTrash 统一负责（两链共用 basePath）。
   * @param sessionId 会话ID
   */
  async deleteSession(sessionId: string): Promise<void> {
    const sessionDir = this.getSessionDir(sessionId);

    try {
      const trashDir = join(
        this.rootDir,
        '.trash',
        `${sessionId}_${Date.now()}`
      );
      logger.debug('deleteSession:旧链 FileSystemStorage 软删除', {
        sessionId,
        sourceDir: sessionDir,
        trashDir,
      });
      logger.info('deleteSession:开始软删除', {
        sessionId,
        sourceDir: sessionDir,
        trashDir,
      });
      await fs.mkdir(dirname(trashDir), { recursive: true });
      await fs.rename(sessionDir, trashDir);
      logger.info('deleteSession:软删除完成', {
        sessionId,
        trashDir,
      });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        // 目录不存在（会话可能已软删除/隔离），预期路径，无需告警
        logger.debug('deleteSession:会话目录不存在，跳过', {
          sessionId,
          sourceDir: sessionDir,
        });
        return;
      }
      logger.warn('deleteSession:软删除失败', {
        sessionId,
        sourceDir: sessionDir,
        error: error instanceof Error ? error.message : String(error),
      });
      await handleError(error, {
        module: 'session:storage',
        action: 'deleteSession',
      });
    }
  }

  /**
   * 列出会话
   * @param options 列表选项
   * @returns 会话ID列表
   */
  async listSessions(options?: SessionListOptions): Promise<string[]> {
    try {
      await this.ensureDir(this.rootDir);
      const entries = await fs.readdir(this.rootDir, { withFileTypes: true });

      const sessionIds: string[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        // 验证目录中包含 session.json 文件，排除非会话目录（如 FileSystemUnifiedStorage 创建的 sessions/ 嵌套目录）
        const jsonPath = join(this.rootDir, entry.name, 'session.json');
        try {
          await fs.access(jsonPath);
          sessionIds.push(entry.name);
        } catch {
          continue;
        }
      }

      return sessionIds;
    } catch (error) {
      return [];
    }
  }

  /**
   * 检查会话是否存在
   * @param sessionId 会话ID
   * @returns 是否存在
   */
  async sessionExists(sessionId: string): Promise<boolean> {
    const sessionFilePath = this.getSessionFilePath(sessionId);

    try {
      await fs.access(sessionFilePath);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * 压缩会话（P1-1 双存储对齐：compact 语义）
   * 对齐 FileSystemUnifiedStorage：全量重写 messages.jsonl，按消息 id 反向去重
   * （后写覆盖先写，Map.set 天然覆盖），回收增量追加产生的重复行。
   * @param sessionId 会话ID
   */
  async compactSession(sessionId: string): Promise<void> {
    const messagesFilePath = this.getMessagesFilePath(sessionId);
    const compactStart = Date.now();

    let content: string;
    try {
      content = await fs.readFile(messagesFilePath, 'utf-8');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // 会话无消息文件（尚未写入/已被删除），预期路径，无需告警
      logger.debug('compactSession:消息文件不存在，跳过', {
        sessionId,
        messagesFilePath,
        code,
      });
      return;
    }

    const lines = content.trim().split('\n');
    if (lines.length === 0) {
      logger.debug('compactSession:消息文件为空，跳过', {
        sessionId,
        messagesFilePath,
      });
      return;
    }
    logger.info('compactSession:开始全量重写', {
      sessionId,
      messagesFilePath,
      beforeLines: lines.length,
      fileBytes: content.length,
    });
    logger.debug('compactSession:旧链 FileSystemStorage 全量重写', {
      sessionId,
      beforeLines: lines.length,
    });

    // 反向去重：后写覆盖先写（与 FileSystemUnifiedStorage.loadMessages 一致）
    const msgMap = new Map<string, SessionMessage>();
    let badLines = 0;
    for (const line of lines) {
      try {
        const data = JSON.parse(line);
        const msg = SessionMessage.fromJSON(data);
        msgMap.set(msg.id, msg);
      } catch {
        // 坏行跳过（保留可解析行，丢弃损坏行）
        badLines++;
      }
    }

    const compacted = [...msgMap.values()];
    if (compacted.length === 0) {
      logger.warn('compactSession:解析后无有效消息，跳过写回', {
        sessionId,
        beforeLines: lines.length,
        badLines,
      });
      return;
    }

    const compactedData =
      compacted.map((m) => JSON.stringify(m.toJSON())).join('\n') + '\n';
    try {
      // KB-FS-COMPACT-ATOMIC（2026-08-29）：原直接 writeFile 覆盖——写入中途崩溃
      // → messages.jsonl 半写损坏且无可恢复备份。改为 AtomicWriter（tmp+rename 原子替换）
      await this.writer.write(messagesFilePath, compactedData);
      logger.info('compactSession:完成', {
        sessionId,
        beforeLines: lines.length,
        afterCount: compacted.length,
        deduped: lines.length - compacted.length,
        badLines,
        writeBytes: compactedData.length,
        elapsedMs: Date.now() - compactStart,
      });
    } catch (error) {
      logger.warn('compactSession:写回失败', {
        sessionId,
        messagesFilePath,
        error: error instanceof Error ? error.message : String(error),
      });
      await handleError(error, {
        module: 'session:storage',
        action: 'compactSession',
      });
    }
  }
}
