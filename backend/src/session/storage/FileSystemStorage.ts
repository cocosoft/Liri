import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { Session } from '../models/Session';
import { SessionMessage } from '../models/SessionMessage';
import { SessionMetadata } from '../models/SessionMetadata';
import type {
  SessionStorage,
  MessageLoadOptions,
  SessionListOptions,
} from '../SessionStorage';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 文件系统存储实现
 * 用于持久化会话存储，将会话数据存储到文件系统
 */
export class FileSystemStorage implements SessionStorage {
  /**
   * 存储根目录
   */
  private rootDir: string;

  /**
   * 构造函数
   * @param rootDir 存储根目录
   */
  constructor(rootDir: string = './data/sessions') {
    this.rootDir = rootDir;
  }

  /**
   * 确保目录存在
   * @param dir 目录路径
   */
  private async ensureDir(dir: string): Promise<void> {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error: any) {
      // 目录已存在，忽略错误
      if (error.code !== 'EEXIST') {
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
    return join(this.rootDir, sessionId);
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
    } catch (error: any) {
      logger.error(`Error loading session ${sessionId}:`, error.message);
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

      let messages = lines
        .map((line) => {
          try {
            const data = JSON.parse(line);
            return SessionMessage.fromJSON(data);
          } catch {
            return null;
          }
        })
        .filter((msg): msg is SessionMessage => msg !== null);

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
      return null;
    }
  }

  /**
   * 删除会话
   * @param sessionId 会话ID
   */
  async deleteSession(sessionId: string): Promise<void> {
    const sessionDir = this.getSessionDir(sessionId);

    try {
      // 删除会话目录及其所有内容
      await fs.rm(sessionDir, { recursive: true, force: true });
    } catch (error) {
      // 目录不存在，忽略错误
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

      let sessionIds = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);

      // 应用过滤选项
      if (options) {
        // 这里可以根据需要实现更复杂的过滤逻辑
        // 例如，读取每个会话的元数据进行过滤
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
   * 压缩会话
   * @param sessionId 会话ID
   */
  async compactSession(sessionId: string): Promise<void> {
    // 这里可以实现会话压缩逻辑
    // 例如，合并消息文件，删除冗余数据等
  }
}
