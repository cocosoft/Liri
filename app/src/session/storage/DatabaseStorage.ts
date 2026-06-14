import { join } from 'path';
import { Database } from '@modules/core/external/sqlite3';
import { Session } from '../models/Session';
import { SessionMessage } from '../models/SessionMessage';
import { SessionMetadata } from '../models/SessionMetadata';
import type {
  SessionStorage,
  MessageLoadOptions,
  SessionListOptions,
} from '../SessionStorage';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { resolveDbPath } from '@modules/core/paths';

/**
 * 数据库存储实现
 * 用于大型会话存储，将会话数据存储到SQLite数据库
 */
export class DatabaseStorage implements SessionStorage {
  /**
   * 数据库连接
   */
  private db: Database | null = null;

  /**
   * 数据库文件路径
   */
  private dbPath: string;

  /**
   * 构造函数
   * @param dbPath 数据库文件路径
   */
  constructor(dbPath: string = resolveDbPath()) {
    this.dbPath = dbPath;
  }

  /**
   * 初始化数据库
   */
  private async initDatabase(): Promise<void> {
    if (this.db) {
      return;
    }

    this.db = await new Promise<Database>((resolve, reject) => {
      const db = new Database(this.dbPath, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve(db);
        }
      });
    });

    // 创建表
    await this.createTables();
  }

  /**
   * 创建表
   */
  private async createTables(): Promise<void> {
    if (!this.db) {
      throw new AppError(
        'Database not initialized',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    // 创建会话表
    await new Promise<void>((resolve, reject) => {
      this.db?.run(
        `
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          createdAt TEXT,
          updatedAt TEXT,
          metadata TEXT,
          state TEXT
        )
      `,
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });

    // 创建消息表
    await new Promise<void>((resolve, reject) => {
      this.db?.run(
        `
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          sessionId TEXT,
          type TEXT,
          content TEXT,
          createdAt TEXT,
          parentId TEXT,
          toolResult TEXT,
          FOREIGN KEY (sessionId) REFERENCES sessions(id)
        )
      `,
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }

  /**
   * 保存会话
   * @param session 会话对象
   */
  async saveSession(session: Session): Promise<void> {
    await this.initDatabase();
    if (!this.db) {
      throw new AppError(
        'Database not initialized',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const sessionData = session.toJSON();
    await new Promise<void>((resolve, reject) => {
      this.db?.run(
        `INSERT OR REPLACE INTO sessions (id, createdAt, updatedAt, metadata, state) VALUES (?, ?, ?, ?, ?)`,
        [
          session.id,
          sessionData.createdAt,
          sessionData.updatedAt,
          JSON.stringify(sessionData.metadata),
          JSON.stringify(sessionData.state),
        ],
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }

  /**
   * 加载会话
   * @param sessionId 会话ID
   * @returns 会话对象或null
   */
  async loadSession(sessionId: string): Promise<Session | null> {
    await this.initDatabase();
    if (!this.db) {
      throw new AppError(
        'Database not initialized',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const row: any = await new Promise<unknown>((resolve, reject) => {
      this.db?.get(
        `SELECT * FROM sessions WHERE id = ?`,
        [sessionId],
        (err, row) => {
          if (err) {
            reject(err);
          } else {
            resolve(row);
          }
        }
      );
    });

    if (!row) {
      return null;
    }

    const sessionData = {
      id: row.id,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      metadata: JSON.parse(row.metadata),
      state: JSON.parse(row.state),
      messages: [],
    };

    // 加载消息
    const messages = await this.loadMessages(sessionId);
    sessionData.messages = messages;

    return Session.fromJSON(sessionData);
  }

  /**
   * 保存消息
   * @param sessionId 会话ID
   * @param message 消息对象
   */
  async saveMessage(sessionId: string, message: SessionMessage): Promise<void> {
    await this.initDatabase();
    if (!this.db) {
      throw new AppError(
        'Database not initialized',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const messageData = message.toJSON();
    await new Promise<void>((resolve, reject) => {
      this.db?.run(
        `INSERT INTO messages (id, sessionId, type, content, createdAt, parentId, toolResult) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          message.id,
          sessionId,
          messageData.type,
          messageData.content,
          messageData.createdAt,
          messageData.parentId || null,
          messageData.toolResult
            ? JSON.stringify(messageData.toolResult)
            : null,
        ],
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
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
    await this.initDatabase();
    if (!this.db) {
      throw new AppError(
        'Database not initialized',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    let query = `SELECT * FROM messages WHERE sessionId = ?`;
    const params: any[] = [sessionId];

    // 应用过滤选项
    if (options) {
      if (options.since) {
        query += ` AND createdAt >= ?`;
        params.push(options.since.toISOString());
      }

      if (options.until) {
        query += ` AND createdAt <= ?`;
        params.push(options.until.toISOString());
      }

      if (options.types) {
        query += ` AND type IN (${options.types.map(() => '?').join(',')})`;
        params.push(...options.types);
      }
    }

    // 按创建时间排序
    query += ` ORDER BY createdAt ASC`;

    // 应用分页选项
    if (options) {
      if (options.limit) {
        query += ` LIMIT ?`;
        params.push(options.limit);
      }

      if (options.offset) {
        query += ` OFFSET ?`;
        params.push(options.offset);
      }
    }

    const rows = await new Promise<any[]>((resolve, reject) => {
      this.db?.all(query, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });

    return rows.map((row) => {
      const messageData = {
        id: row.id,
        type: row.type,
        content: row.content,
        createdAt: row.createdAt,
        parentId: row.parentId,
        toolResult: row.toolResult ? JSON.parse(row.toolResult) : undefined,
      };
      return SessionMessage.fromJSON(messageData);
    });
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
    await this.initDatabase();
    if (!this.db) {
      throw new AppError(
        'Database not initialized',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    await new Promise<void>((resolve, reject) => {
      this.db?.run(
        `UPDATE sessions SET metadata = ? WHERE id = ?`,
        [JSON.stringify(metadata.toJSON()), sessionId],
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }

  /**
   * 加载元数据
   * @param sessionId 会话ID
   * @returns 元数据对象或null
   */
  async loadMetadata(sessionId: string): Promise<SessionMetadata | null> {
    await this.initDatabase();
    if (!this.db) {
      throw new AppError(
        'Database not initialized',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const row = await new Promise<unknown>((resolve, reject) => {
      this.db?.get(
        `SELECT metadata FROM sessions WHERE id = ?`,
        [sessionId],
        (err, row) => {
          if (err) {
            reject(err);
          } else {
            resolve(row);
          }
        }
      );
    });

    if (!row || !row.metadata) {
      return null;
    }

    return SessionMetadata.fromJSON(JSON.parse(row.metadata));
  }

  /**
   * 删除会话
   * @param sessionId 会话ID
   */
  async deleteSession(sessionId: string): Promise<void> {
    await this.initDatabase();
    if (!this.db) {
      throw new AppError(
        'Database not initialized',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    // 先删除消息
    await new Promise<void>((resolve, reject) => {
      this.db?.run(
        `DELETE FROM messages WHERE sessionId = ?`,
        [sessionId],
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });

    // 再删除会话
    await new Promise<void>((resolve, reject) => {
      this.db?.run(`DELETE FROM sessions WHERE id = ?`, [sessionId], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * 列出会话
   * @param options 列表选项
   * @returns 会话ID列表
   */
  async listSessions(options?: SessionListOptions): Promise<string[]> {
    await this.initDatabase();
    if (!this.db) {
      throw new AppError(
        'Database not initialized',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    let query = `SELECT id FROM sessions`;
    const params: any[] = [];

    // 应用过滤选项
    if (options) {
      if (options.since) {
        query += ` WHERE createdAt >= ?`;
        params.push(options.since.toISOString());
      }

      if (options.until) {
        query += `${params.length > 0 ? ' AND' : ' WHERE'} updatedAt <= ?`;
        params.push(options.until.toISOString());
      }
    }

    // 按更新时间排序
    query += ` ORDER BY updatedAt DESC`;

    // 应用分页选项
    if (options) {
      if (options.limit) {
        query += ` LIMIT ?`;
        params.push(options.limit);
      }

      if (options.offset) {
        query += ` OFFSET ?`;
        params.push(options.offset);
      }
    }

    const rows = await new Promise<any[]>((resolve, reject) => {
      this.db?.all(query, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });

    return rows.map((row) => row.id);
  }

  /**
   * 检查会话是否存在
   * @param sessionId 会话ID
   * @returns 是否存在
   */
  async sessionExists(sessionId: string): Promise<boolean> {
    await this.initDatabase();
    if (!this.db) {
      throw new AppError(
        'Database not initialized',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const row = await new Promise<unknown>((resolve, reject) => {
      this.db?.get(
        `SELECT id FROM sessions WHERE id = ?`,
        [sessionId],
        (err, row) => {
          if (err) {
            reject(err);
          } else {
            resolve(row);
          }
        }
      );
    });

    return !!row;
  }

  /**
   * 压缩会话
   * @param sessionId 会话ID
   */
  async compactSession(sessionId: string): Promise<void> {
    // 这里可以实现会话压缩逻辑
    // 例如，清理冗余数据，优化数据库表等
  }

  /**
   * 关闭数据库连接
   */
  async close(): Promise<void> {
    if (this.db) {
      await new Promise<void>((resolve, reject) => {
        this.db?.close((err) => {
          if (err) {
            reject(err);
          } else {
            this.db = null;
            resolve();
          }
        });
      });
    }
  }
}
