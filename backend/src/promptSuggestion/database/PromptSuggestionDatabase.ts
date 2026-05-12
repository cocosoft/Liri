/**
 * Prompt Suggestion数据库模块
 * 用于存储建议历史和系统配置
 */

import { Database } from 'sqlite3';
import type {
  SuggestionHistory,
  SuggestionConfig,
  DEFAULT_SUGGESTION_CONFIG,
} from '../types';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

/**
 * PromptSuggestion数据库存储实现
 */
export class PromptSuggestionDatabase {
  private db: Database | null = null;
  private dbPath: string;

  constructor(dbPath: string = './data/py_copilot.db') {
    this.dbPath = dbPath;
  }

  /**
   * 初始化数据库
   */
  async initDatabase(): Promise<void> {
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

    await this.createTables();
    await this.initSystemConfig();
  }

  /**
   * 创建数据库表
   */
  private async createTables(): Promise<void> {
    if (!this.db) {
      throw new AppError('Database not initialized', ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
    }

    await this.createSuggestionHistoryTable();
  }

  /**
   * 创建suggestion_history表
   */
  private async createSuggestionHistoryTable(): Promise<void> {
    if (!this.db) {
      throw new AppError('Database not initialized', ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
    }

    await new Promise<void>((resolve, reject) => {
      this.db?.run(
        `
        CREATE TABLE IF NOT EXISTS suggestion_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          suggestion TEXT NOT NULL,
          prompt_id TEXT,
          shown_at INTEGER NOT NULL,
          accepted_at INTEGER,
          outcome TEXT NOT NULL,
          accept_method TEXT,
          time_to_accept_ms INTEGER,
          time_to_ignore_ms INTEGER,
          time_to_first_keystroke_ms INTEGER,
          similarity REAL,
          session_id TEXT,
          created_at INTEGER NOT NULL
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

    await new Promise<void>((resolve, reject) => {
      this.db?.run(
        `
        CREATE INDEX IF NOT EXISTS idx_suggestion_session
        ON suggestion_history(session_id)
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

    await new Promise<void>((resolve, reject) => {
      this.db?.run(
        `
        CREATE INDEX IF NOT EXISTS idx_suggestion_outcome
        ON suggestion_history(outcome)
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

    await new Promise<void>((resolve, reject) => {
      this.db?.run(
        `
        CREATE INDEX IF NOT EXISTS idx_suggestion_created
        ON suggestion_history(created_at)
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
   * 初始化系统配置
   */
  private async initSystemConfig(): Promise<void> {
    if (!this.db) {
      throw new AppError('Database not initialized', ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
    }

    const configs: Array<{ key: string; value: string }> = [
      { key: 'prompt_suggestion_enabled', value: 'true' },
      { key: 'suggestion_max_words', value: '12' },
      { key: 'suggestion_max_length', value: '100' },
      { key: 'speculation_enabled', value: 'true' },
    ];

    for (const config of configs) {
      await new Promise<void>((resolve, reject) => {
        this.db?.run(
          `
          INSERT OR IGNORE INTO system_config (key, value, updated_at)
          VALUES (?, ?, strftime('%s', 'now'))
        `,
          [config.key, config.value],
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
  }

  /**
   * 插入建议历史记录
   */
  async insertSuggestionHistory(
    history: Omit<SuggestionHistory, 'id'>
  ): Promise<number> {
    if (!this.db) {
      throw new AppError('Database not initialized', ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
    }

    return new Promise((resolve, reject) => {
      this.db?.run(
        `
        INSERT INTO suggestion_history (
          suggestion, prompt_id, shown_at, accepted_at, outcome,
          accept_method, time_to_accept_ms, time_to_ignore_ms,
          time_to_first_keystroke_ms, similarity, session_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        [
          history.suggestion,
          history.prompt_id,
          history.shown_at,
          history.accepted_at,
          history.outcome,
          history.accept_method,
          history.time_to_accept_ms,
          history.time_to_ignore_ms,
          history.time_to_first_keystroke_ms,
          history.similarity,
          history.session_id,
          history.created_at,
        ],
        function (err) {
          if (err) {
            reject(err);
          } else {
            resolve(this.lastID);
          }
        }
      );
    });
  }

  /**
   * 更新建议历史记录（接受时）
   */
  async updateSuggestionAccepted(
    id: number,
    acceptedAt: number,
    acceptMethod: string,
    timeToAcceptMs: number | null
  ): Promise<void> {
    if (!this.db) {
      throw new AppError('Database not initialized', ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
    }

    await new Promise<void>((resolve, reject) => {
      this.db?.run(
        `
        UPDATE suggestion_history
        SET accepted_at = ?, accept_method = ?, time_to_accept_ms = ?
        WHERE id = ?
      `,
        [acceptedAt, acceptMethod, timeToAcceptMs, id],
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
   * 更新建议历史记录（忽略时）
   */
  async updateSuggestionIgnored(
    id: number,
    timeToIgnoreMs: number | null
  ): Promise<void> {
    if (!this.db) {
      throw new AppError('Database not initialized', ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
    }

    await new Promise<void>((resolve, reject) => {
      this.db?.run(
        `
        UPDATE suggestion_history
        SET time_to_ignore_ms = ?
        WHERE id = ?
      `,
        [timeToIgnoreMs, id],
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
   * 获取建议历史记录
   */
  async getSuggestionHistory(
    sessionId?: string,
    limit: number = 100
  ): Promise<SuggestionHistory[]> {
    if (!this.db) {
      throw new AppError('Database not initialized', ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
    }

    let sql = 'SELECT * FROM suggestion_history';
    const params: (string | number)[] = [];

    if (sessionId) {
      sql += ' WHERE session_id = ?';
      params.push(sessionId);
    }

    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    return new Promise((resolve, reject) => {
      this.db?.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows as SuggestionHistory[]);
        }
      });
    });
  }

  /**
   * 获取系统配置
   */
  async getConfig(key: string): Promise<string | null> {
    if (!this.db) {
      throw new AppError('Database not initialized', ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
    }

    return new Promise((resolve, reject) => {
      this.db?.get(
        `
        SELECT value FROM system_config WHERE key = ?
      `,
        [key],
        (err, row) => {
          if (err) {
            reject(err);
          } else if (row) {
            resolve((row as { value: string }).value);
          } else {
            resolve(null);
          }
        }
      );
    });
  }

  /**
   * 设置系统配置
   */
  async setConfig(key: string, value: string): Promise<void> {
    if (!this.db) {
      throw new AppError('Database not initialized', ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
    }

    await new Promise<void>((resolve, reject) => {
      this.db?.run(
        `
        INSERT OR REPLACE INTO system_config (key, value, updated_at)
        VALUES (?, ?, strftime('%s', 'now'))
      `,
        [key, value],
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
   * 获取所有建议相关配置
   */
  async getSuggestionConfig(): Promise<SuggestionConfig> {
    const enabled = await this.getConfig('prompt_suggestion_enabled');
    const maxWords = await this.getConfig('suggestion_max_words');
    const maxLength = await this.getConfig('suggestion_max_length');
    const speculation = await this.getConfig('speculation_enabled');

    return {
      prompt_suggestion_enabled: enabled === 'true',
      suggestion_max_words: maxWords ? parseInt(maxWords, 10) : 12,
      suggestion_max_length: maxLength ? parseInt(maxLength, 10) : 100,
      speculation_enabled: speculation === 'true',
    };
  }

  /**
   * 获取接受率统计
   */
  async getAcceptanceStats(sessionId?: string): Promise<{
    total: number;
    accepted: number;
    ignored: number;
    acceptanceRate: number;
  }> {
    if (!this.db) {
      throw new AppError('Database not initialized', ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
    }

    let sql = 'SELECT outcome, COUNT(*) as count FROM suggestion_history';
    const params: string[] = [];

    if (sessionId) {
      sql += ' WHERE session_id = ?';
      params.push(sessionId);
    }

    sql += ' GROUP BY outcome';

    return new Promise((resolve, reject) => {
      this.db?.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const stats = {
            total: 0,
            accepted: 0,
            ignored: 0,
            acceptanceRate: 0,
          };

          for (const row of rows as Array<{ outcome: string; count: number }>) {
            stats.total += row.count;
            if (row.outcome === 'accepted') {
              stats.accepted = row.count;
            } else if (row.outcome === 'ignored') {
              stats.ignored = row.count;
            }
          }

          stats.acceptanceRate =
            stats.total > 0
              ? Math.round((stats.accepted / stats.total) * 10000) / 100
              : 0;

          resolve(stats);
        }
      });
    });
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

let databaseInstance: PromptSuggestionDatabase | null = null;

/**
 * 获取PromptSuggestion数据库单例
 */
export function getPromptSuggestionDatabase(
  dbPath?: string
): PromptSuggestionDatabase {
  if (!databaseInstance) {
    databaseInstance = new PromptSuggestionDatabase(dbPath);
  }
  return databaseInstance;
}
