// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 技能系统数据库层
 *
 * 统一管理辅助组件（SkillUsageTracker / SkillCurator / SkillProvenanceTracker）
 * 的 SQLite 持久化表。使用 resolveDbPath() 接入唯一 app.db。
 *
 * 表清单：
 * - skill_usage_records：技能使用记录
 * - skill_curation_states：技能策展状态
 * - skill_provenance：技能溯源信息
 */

import { Database } from '@modules/core/external/sqlite3';
import { resolveDbPath } from '@modules/core';
import { Logger, LogLevel } from '@modules/monitoring';

import type {
  SkillUsageRecord,
  SkillCurationState,
  CuratorActionRecord,
  SkillProvenanceEntry,
} from './types';

const logger = new Logger({ module: 'skills:db', level: LogLevel.INFO });

// ==================== 表名 ====================

const USAGE_TABLE = 'skill_usage_records';
const CURATION_TABLE = 'skill_curation_states';
const CURATION_HISTORY_TABLE = 'skill_curation_history';
const PROVENANCE_TABLE = 'skill_provenance';

// ==================== DB Row 类型 ====================

interface UsageRow {
  id: number;
  skill_name: string;
  timestamp: number;
  duration_ms: number;
  success: number;
  error: string | null;
  source: string;
  triggered_by: string;
  args_summary: string | null;
}

interface CurationRow {
  skill_name: string;
  pinned: number;
  archived: number;
  consolidated_at: number | null;
  patched_at: number | null;
  last_curated_at: number | null;
}

interface CurationHistoryRow {
  id: number;
  skill_name: string;
  action: string;
  timestamp: number;
  details: string;
}

interface ProvenanceRow {
  skill_name: string;
  source: string;
  source_url: string | null;
  source_version: string | null;
  installed_at: number;
  updated_at: number;
  metadata: string | null;
}

/**
 * 技能系统数据库
 */
export class SkillDB {
  private db: Database | null = null;
  private dbPath: string;
  private initialized = false;

  constructor(dbPath: string = resolveDbPath()) {
    this.dbPath = dbPath;
  }

  /**
   * 初始化数据库连接和表结构
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    this.db = await new Promise<Database>((resolve, reject) => {
      const db = new Database(this.dbPath, (err: Error | null) => {
        if (err) reject(err);
        else resolve(db);
      });
    });

    await this.createTables();
    this.initialized = true;
    logger.debug('SkillDB 初始化完成', { dbPath: this.dbPath });
  }

  /**
   * 创建所有表（CREATE TABLE IF NOT EXISTS）
   */
  private async createTables(): Promise<void> {
    const queries = [
      `CREATE TABLE IF NOT EXISTS ${USAGE_TABLE} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        skill_name TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        success INTEGER NOT NULL DEFAULT 1,
        error TEXT,
        source TEXT NOT NULL DEFAULT '',
        triggered_by TEXT NOT NULL DEFAULT 'user',
        args_summary TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_usage_skill_name ON ${USAGE_TABLE}(skill_name)`,
      `CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON ${USAGE_TABLE}(timestamp)`,

      `CREATE TABLE IF NOT EXISTS ${CURATION_TABLE} (
        skill_name TEXT PRIMARY KEY,
        pinned INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        consolidated_at INTEGER,
        patched_at INTEGER,
        last_curated_at INTEGER
      )`,

      `CREATE TABLE IF NOT EXISTS ${CURATION_HISTORY_TABLE} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        skill_name TEXT NOT NULL,
        action TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        details TEXT NOT NULL DEFAULT ''
      )`,
      `CREATE INDEX IF NOT EXISTS idx_curation_history_skill ON ${CURATION_HISTORY_TABLE}(skill_name)`,

      `CREATE TABLE IF NOT EXISTS ${PROVENANCE_TABLE} (
        skill_name TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        source_url TEXT,
        source_version TEXT,
        installed_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        metadata TEXT
      )`,
    ];

    for (const sql of queries) {
      await new Promise<void>((resolve, reject) => {
        this.db!.run(sql, (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  }

  // ==================== 使用记录 (Usage) ====================

  /**
   * 插入一条使用记录
   */
  async insertUsage(record: SkillUsageRecord): Promise<void> {
    await this.init();
    const sql = `INSERT INTO ${USAGE_TABLE} (skill_name, timestamp, duration_ms, success, error, source, triggered_by, args_summary)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
    await new Promise<void>((resolve, reject) => {
      this.db!.run(
        sql,
        [
          record.skillName,
          record.timestamp,
          record.durationMs,
          record.success ? 1 : 0,
          record.error ?? null,
          record.source,
          record.triggeredBy,
          record.argsSummary ?? null,
        ],
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  /**
   * 查询指定技能的使用记录
   */
  async queryUsage(
    skillName: string,
    since?: number,
    limit: number = 100
  ): Promise<SkillUsageRecord[]> {
    await this.init();
    let sql = `SELECT * FROM ${USAGE_TABLE} WHERE skill_name = ?`;
    const params: unknown[] = [skillName];

    if (since) {
      sql += ' AND timestamp >= ?';
      params.push(since);
    }

    sql += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);

    const rows = await new Promise<UsageRow[]>((resolve, reject) => {
      this.db!.all(sql, params, (err, rows: UsageRow[]) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    return rows.map(this.rowToUsage);
  }

  /**
   * 查询指定时间范围内的所有使用记录（用于统计摘要）
   */
  async queryUsageByTime(
    since: number,
    limit: number = 10000
  ): Promise<SkillUsageRecord[]> {
    await this.init();
    const sql = `SELECT * FROM ${USAGE_TABLE} WHERE timestamp >= ? ORDER BY timestamp DESC LIMIT ?`;
    const rows = await new Promise<UsageRow[]>((resolve, reject) => {
      this.db!.all(sql, [since, limit], (err, rows: UsageRow[]) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    return rows.map(this.rowToUsage);
  }

  /**
   * 清除指定技能的记录
   */
  async clearUsage(skillName?: string): Promise<void> {
    await this.init();
    if (skillName) {
      await new Promise<void>((resolve, reject) => {
        this.db!.run(
          `DELETE FROM ${USAGE_TABLE} WHERE skill_name = ?`,
          [skillName],
          (err: Error | null) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    } else {
      await new Promise<void>((resolve, reject) => {
        this.db!.run(`DELETE FROM ${USAGE_TABLE}`, (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  }

  /**
   * 清理旧记录（保留最近的 N 条）
   */
  async pruneUsage(keepCount: number = 10000): Promise<number> {
    await this.init();
    // 获取应保留的最小 id
    const row = await new Promise<{ min_id: number } | undefined>(
      (resolve, reject) => {
        this.db!.get(
          `SELECT id as min_id FROM ${USAGE_TABLE} ORDER BY id DESC LIMIT 1 OFFSET ?`,
          [keepCount - 1],
          (err, row: { min_id: number }) => {
            if (err) reject(err);
            else resolve(row);
          }
        );
      }
    );

    if (!row) return 0;

    await new Promise<void>((resolve, reject) => {
      this.db!.run(
        `DELETE FROM ${USAGE_TABLE} WHERE id < ?`,
        [row.min_id],
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    return row.min_id;
  }

  private rowToUsage(row: UsageRow): SkillUsageRecord {
    return {
      skillName: row.skill_name,
      timestamp: row.timestamp,
      durationMs: row.duration_ms,
      success: row.success === 1,
      error: row.error ?? undefined,
      source: row.source,
      triggeredBy: row.triggered_by as SkillUsageRecord['triggeredBy'],
      argsSummary: row.args_summary ?? undefined,
    };
  }

  // ==================== 策展状态 (Curation) ====================

  /**
   * 保存策展状态
   */
  async saveCuration(state: SkillCurationState): Promise<void> {
    await this.init();
    const sql = `INSERT OR REPLACE INTO ${CURATION_TABLE}
      (skill_name, pinned, archived, consolidated_at, patched_at, last_curated_at)
      VALUES (?, ?, ?, ?, ?, ?)`;
    await new Promise<void>((resolve, reject) => {
      this.db!.run(
        sql,
        [
          state.skillName,
          state.pinned ? 1 : 0,
          state.archived ? 1 : 0,
          state.consolidatedAt,
          state.patchedAt,
          state.lastCuratedAt,
        ],
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  /**
   * 加载所有策展状态
   */
  async loadAllCuration(): Promise<Map<string, SkillCurationState>> {
    await this.init();
    const rows = await new Promise<CurationRow[]>((resolve, reject) => {
      this.db!.all(
        `SELECT * FROM ${CURATION_TABLE}`,
        (err, rows: CurationRow[]) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });

    const map = new Map<string, SkillCurationState>();
    for (const row of rows) {
      const history = await this.loadCurationHistory(row.skill_name);
      map.set(row.skill_name, {
        skillName: row.skill_name,
        pinned: row.pinned === 1,
        archived: row.archived === 1,
        consolidatedAt: row.consolidated_at,
        patchedAt: row.patched_at,
        lastCuratedAt: row.last_curated_at,
        curationHistory: history,
      });
    }
    return map;
  }

  /**
   * 删除策展状态
   */
  async deleteCuration(skillName: string): Promise<void> {
    await this.init();
    await new Promise<void>((resolve, reject) => {
      this.db!.run(
        `DELETE FROM ${CURATION_TABLE} WHERE skill_name = ?`,
        [skillName],
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  // ==================== 策展历史 (Curation History) ====================

  /**
   * 插入策展操作记录
   */
  async insertCurationHistory(
    record: CuratorActionRecord,
    skillName: string
  ): Promise<void> {
    await this.init();
    const sql = `INSERT INTO ${CURATION_HISTORY_TABLE} (skill_name, action, timestamp, details)
      VALUES (?, ?, ?, ?)`;
    await new Promise<void>((resolve, reject) => {
      this.db!.run(
        sql,
        [skillName, record.action, record.timestamp, record.details],
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  /**
   * 加载技能的策展历史
   */
  private async loadCurationHistory(
    skillName: string
  ): Promise<CuratorActionRecord[]> {
    const rows = await new Promise<CurationHistoryRow[]>((resolve, reject) => {
      this.db!.all(
        `SELECT * FROM ${CURATION_HISTORY_TABLE} WHERE skill_name = ? ORDER BY timestamp DESC`,
        [skillName],
        (err, rows: CurationHistoryRow[]) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });

    return rows.map((r) => ({
      action: r.action as CuratorActionRecord['action'],
      timestamp: r.timestamp,
      details: r.details,
    }));
  }

  // ==================== 溯源 (Provenance) ====================

  /**
   * 保存溯源条目
   */
  async saveProvenance(entry: SkillProvenanceEntry): Promise<void> {
    await this.init();
    const sql = `INSERT OR REPLACE INTO ${PROVENANCE_TABLE}
      (skill_name, source, source_url, source_version, installed_at, updated_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)`;
    await new Promise<void>((resolve, reject) => {
      this.db!.run(
        sql,
        [
          entry.skillName,
          entry.source,
          entry.sourceUrl ?? null,
          entry.sourceVersion ?? null,
          entry.installedAt,
          entry.updatedAt,
          entry.metadata ? JSON.stringify(entry.metadata) : null,
        ],
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  /**
   * 加载所有溯源条目
   */
  async loadAllProvenance(): Promise<Map<string, SkillProvenanceEntry>> {
    await this.init();
    const rows = await new Promise<ProvenanceRow[]>((resolve, reject) => {
      this.db!.all(
        `SELECT * FROM ${PROVENANCE_TABLE}`,
        (err, rows: ProvenanceRow[]) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });

    const map = new Map<string, SkillProvenanceEntry>();
    for (const row of rows) {
      map.set(row.skill_name, {
        skillName: row.skill_name,
        source: row.source as SkillProvenanceEntry['source'],
        sourceUrl: row.source_url ?? undefined,
        sourceVersion: row.source_version ?? undefined,
        installedAt: row.installed_at,
        updatedAt: row.updated_at,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      });
    }
    return map;
  }

  /**
   * 删除溯源条目
   */
  async deleteProvenance(skillName: string): Promise<void> {
    await this.init();
    await new Promise<void>((resolve, reject) => {
      this.db!.run(
        `DELETE FROM ${PROVENANCE_TABLE} WHERE skill_name = ?`,
        [skillName],
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  /**
   * 关闭数据库连接
   */
  async close(): Promise<void> {
    if (this.db) {
      await new Promise<void>((resolve, reject) => {
        this.db!.close((err: Error | null) => {
          if (err) reject(err);
          else resolve();
        });
      });
      this.db = null;
      this.initialized = false;
    }
  }
}

/** 全局单例 */
let globalSkillDB: SkillDB | null = null;

/**
 * 获取全局 SkillDB 实例
 */
export function getSkillDB(): SkillDB {
  if (!globalSkillDB) {
    globalSkillDB = new SkillDB();
  }
  return globalSkillDB;
}
