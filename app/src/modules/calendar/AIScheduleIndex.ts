/**
 * AIScheduleIndex — AI 日程索引表 CRUD
 * 存储 AI 对话中创建的日程元数据，用于日历面板中的"AI 提取"来源展示
 */

import { Database } from '@modules/core/external/sqlite3';
import { resolveDbPath } from '@modules/core';
import { getLogger } from '@modules/monitoring';
const logger = getLogger('calendar:aiScheduleIndex');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS ai_schedules (
  id TEXT PRIMARY KEY,
  calendar_event_id TEXT NOT NULL,
  session_id TEXT,
  conversation_snippet TEXT,
  created_by_tool_call_id TEXT,
  hook_error TEXT,
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_schedules_event ON ai_schedules(calendar_event_id);
CREATE INDEX IF NOT EXISTS idx_ai_schedules_session ON ai_schedules(session_id);
CREATE INDEX IF NOT EXISTS idx_ai_schedules_deleted ON ai_schedules(deleted);
`;

/** AI 日程索引条目 */
export interface AIScheduleEntry {
  id: string;
  calendarEventId: string;
  sessionId?: string;
  conversationSnippet?: string;
  createdByToolCallId?: string;
  hookError?: string;
  deleted: boolean;
  createdAt: string;
}

/** AI 日程事件（前端展示用） */
export interface AIScheduleEvent {
  id: string;
  calendarEventId: string;
  date: string;
  time?: string;
  summary: string;
  sessionId?: string;
  conversationSnippet?: string;
  source: 'ai';
}

/** 将数据库行转换为 AIScheduleEntry */
function rowToEntry(row: any): AIScheduleEntry {
  return {
    id: row.id,
    calendarEventId: row.calendar_event_id,
    sessionId: row.session_id ?? undefined,
    conversationSnippet: row.conversation_snippet ?? undefined,
    createdByToolCallId: row.created_by_tool_call_id ?? undefined,
    hookError: row.hook_error ?? undefined,
    deleted: !!row.deleted,
    createdAt: row.created_at,
  };
}

/**
 * AIScheduleIndex
 * 管理 ai_schedules 表的读写操作
 */
export class AIScheduleIndex {
  private db: Database | null = null;
  private dbPath: string;

  constructor(dbPath: string = resolveDbPath()) {
    this.dbPath = dbPath;
  }

  /** 确保数据库连接可用 */
  private ensureDb(): Database {
    if (!this.db) {
      throw new Error('AIScheduleIndex 未初始化，请先调用 init()');
    }
    return this.db;
  }

  /**
   * 初始化数据库表和索引
   */
  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db = new Database(this.dbPath, (err: Error | null) => {
        if (err) {
          logger.error('ai_schedules 数据库连接失败', { error: String(err) });
          return reject(err);
        }
        this.db!.exec(SCHEMA, (schemaErr: Error | null) => {
          if (schemaErr) {
            logger.error('ai_schedules 建表失败', { error: String(schemaErr) });
            return reject(schemaErr);
          }
          logger.info('ai_schedules 表已就绪');
          resolve();
        });
      });
    });
  }

  /**
   * 写入一条 AI 日程索引
   */
  async insert(
    entry: Omit<AIScheduleEntry, 'deleted' | 'createdAt'>
  ): Promise<void> {
    const db = this.ensureDb();
    const sql = `INSERT INTO ai_schedules (id, calendar_event_id, session_id, conversation_snippet, created_by_tool_call_id, hook_error, created_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`;

    return new Promise((resolve, reject) => {
      db.run(
        sql,
        [
          entry.id,
          entry.calendarEventId,
          entry.sessionId ?? null,
          entry.conversationSnippet ?? null,
          entry.createdByToolCallId ?? null,
          entry.hookError ?? null,
        ],
        (err: Error | null) => {
          if (err) return reject(err);
          resolve();
        }
      );
    });
  }

  /**
   * 更新 hook_error 字段（提醒创建失败时记录）
   */
  async setHookError(id: string, error: string): Promise<void> {
    const db = this.ensureDb();
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE ai_schedules SET hook_error = ? WHERE id = ?',
        [error, id],
        (err: Error | null) => {
          if (err) return reject(err);
          resolve();
        }
      );
    });
  }

  /**
   * 按日历事件 ID 查找索引
   */
  async findByCalendarEventId(
    calendarEventId: string
  ): Promise<AIScheduleEntry | null> {
    const db = this.ensureDb();
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM ai_schedules WHERE calendar_event_id = ? AND deleted = 0',
        [calendarEventId],
        (err: Error | null, row: any) => {
          if (err) return reject(err);
          resolve(row ? rowToEntry(row) : null);
        }
      );
    });
  }

  /**
   * 标记为已删除（级联删除时不物理删除）
   */
  async markDeleted(calendarEventId: string): Promise<void> {
    const db = this.ensureDb();
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE ai_schedules SET deleted = 1 WHERE calendar_event_id = ?',
        [calendarEventId],
        (err: Error | null) => {
          if (err) return reject(err);
          resolve();
        }
      );
    });
  }

  /**
   * 列出所有未删除的 AI 日程（用于日历面板聚合）
   */
  async listActive(): Promise<AIScheduleEntry[]> {
    const db = this.ensureDb();
    return new Promise((resolve, reject) => {
      db.all(
        'SELECT * FROM ai_schedules WHERE deleted = 0 ORDER BY created_at DESC',
        (err: Error | null, rows: any[]) => {
          if (err) return reject(err);
          resolve((rows || []).map(rowToEntry));
        }
      );
    });
  }

  /**
   * 关闭数据库连接
   */
  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
