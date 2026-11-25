/**
 * 团队记忆同步状态持久化（Phase 2N-1，2026-11-25）
 *
 * 目的：把拉取 `cursor` 与每条记忆的 `etag` 落库 ⇒ 重启后**断点续传**、不重复下载，
 * 也不再依赖内存 `etagCache`（进程重启即丢，曾导致 `If-Match` 失效）。
 *
 * 只**新增**表 `team_memory_sync_state`（`project_rules §1.5` 允许新增，不改既有结构）。
 */

import { Database } from '@openliri/infra/external';
import { resolveDbPath } from '@openliri/infra/environment';

const SYNC_STATE_TABLE = 'team_memory_sync_state';

export interface TeamMemorySyncState {
  teamId: string;
  /** 已应用的最大服务端 `version`（下次拉取 `version > cursor`） */
  cursor: number;
  /** `id → etag`（推送时作为 `If-Match` 基线） */
  etags: Record<string, string>;
  /**
   * `id → 上次同步时的本地正文 hash`（Phase 2N-12）。
   *
   * 增量列表只返回 `version > cursor` 的条目 ⇒ 未变的远端条目**不会出现**在
   * 本轮列表里。没有这份基线就无法区分"两边都没变"（应跳过）与"本地改了"
   * （应推送）—— 原实现一律判 `local_only` ⇒ 每轮把未变条目重复 PUT。
   */
  localHashes: Record<string, string>;
  lastSyncAt: string | null;
  lastError: string | null;
}

function safeParseEtags(raw: unknown): Record<string, string> {
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string' && value) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export class TeamMemorySyncStateStore {
  constructor(private readonly dbPath: string = resolveDbPath()) {}

  /** 打开连接 + 确保表存在；调用方负责 `close()` */
  private async open(): Promise<Database> {
    const db = new Database(this.dbPath);
    await new Promise<void>((resolve, reject) => {
      db.run(
        `CREATE TABLE IF NOT EXISTS ${SYNC_STATE_TABLE} (
          team_id TEXT PRIMARY KEY,
          cursor INTEGER NOT NULL DEFAULT 0,
          etags_json TEXT NOT NULL DEFAULT '{}',
          local_hashes_json TEXT NOT NULL DEFAULT '{}',
          last_sync_at TEXT,
          last_error TEXT
        )`,
        (err: Error | null) => (err ? reject(err) : resolve())
      );
    });
    // 2N-12：旧版本建的表没有 `local_hashes_json` ⇒ 补列（SQLite 的 ADD COLUMN 无 IF NOT EXISTS）
    const columns = await this.all(db, `PRAGMA table_info(${SYNC_STATE_TABLE})`);
    if (!columns.some((column) => column.name === 'local_hashes_json')) {
      await this.run(
        db,
        `ALTER TABLE ${SYNC_STATE_TABLE} ADD COLUMN local_hashes_json TEXT NOT NULL DEFAULT '{}'`,
        []
      );
    }
    return db;
  }

  async get(teamId: string): Promise<TeamMemorySyncState | null> {
    const db = await this.open();
    try {
      const row = await new Promise<Record<string, unknown> | undefined>(
        (resolve, reject) => {
          db.get(
            `SELECT team_id, cursor, etags_json, local_hashes_json, last_sync_at, last_error
             FROM ${SYNC_STATE_TABLE} WHERE team_id = ?`,
            [teamId],
            (err: Error | null, result: Record<string, unknown> | undefined) =>
              err ? reject(err) : resolve(result)
          );
        }
      );
      if (!row) return null;
      return {
        teamId,
        cursor: Number(row.cursor ?? 0),
        etags: safeParseEtags(row.etags_json),
        localHashes: safeParseEtags(row.local_hashes_json),
        lastSyncAt:
          typeof row.last_sync_at === 'string' ? row.last_sync_at : null,
        lastError:
          typeof row.last_error === 'string' ? row.last_error : null,
      };
    } finally {
      db.close();
    }
  }

  /** 保存拉取进度（cursor 只增不减；成功后清空 last_error） */
  async saveProgress(
    teamId: string,
    cursor: number,
    etags: Record<string, string>
  ): Promise<void> {
    const db = await this.open();
    try {
      await this.run(
        db,
        `INSERT INTO ${SYNC_STATE_TABLE}
           (team_id, cursor, etags_json, last_sync_at, last_error)
         VALUES (?, ?, ?, ?, NULL)
         ON CONFLICT(team_id) DO UPDATE SET
           cursor = MAX(${SYNC_STATE_TABLE}.cursor, excluded.cursor),
           etags_json = excluded.etags_json,
           last_sync_at = excluded.last_sync_at,
           last_error = NULL`,
        [
          teamId,
          Math.max(0, Math.floor(cursor)),
          JSON.stringify(etags),
          new Date().toISOString(),
        ]
      );
    } finally {
      db.close();
    }
  }

  /** 只更新 etag 映射（保留既有 cursor；推送成功后作为 `If-Match` 基线） */
  async saveEtags(
    teamId: string,
    etags: Record<string, string>
  ): Promise<void> {
    const db = await this.open();
    try {
      await this.run(
        db,
        `INSERT INTO ${SYNC_STATE_TABLE}
           (team_id, cursor, etags_json, last_sync_at, last_error)
         VALUES (?, 0, ?, NULL, NULL)
         ON CONFLICT(team_id) DO UPDATE SET etags_json = excluded.etags_json`,
        [teamId, JSON.stringify(etags)]
      );
    } finally {
      db.close();
    }
  }

  /**
   * 只更新"上次同步时的本地正文 hash"基线（Phase 2N-12；保留 cursor/etags/错误）。
   */
  async saveLocalHashes(
    teamId: string,
    localHashes: Record<string, string>
  ): Promise<void> {
    const db = await this.open();
    try {
      await this.run(
        db,
        `INSERT INTO ${SYNC_STATE_TABLE}
           (team_id, cursor, etags_json, local_hashes_json, last_sync_at, last_error)
         VALUES (?, 0, '{}', ?, NULL, NULL)
         ON CONFLICT(team_id) DO UPDATE SET
           local_hashes_json = excluded.local_hashes_json`,
        [teamId, JSON.stringify(localHashes)]
      );
    } finally {
      db.close();
    }
  }

  /**
   * 清空某团队的续传状态（cursor + etag 基线 + last_error）。
   *
   * 全量重同步入口专用（Phase 2N-8）：`saveProgress` 的 cursor 是
   * `MAX(旧值, 新值)` **只增不减**，无法用它把游标归零。
   */
  async reset(teamId: string): Promise<void> {
    const db = await this.open();
    try {
      await this.run(db, `DELETE FROM ${SYNC_STATE_TABLE} WHERE team_id = ?`, [
        teamId,
      ]);
    } finally {
      db.close();
    }
  }

  /** 记录失败（保留既有 cursor/etags） */
  async saveError(teamId: string, message: string): Promise<void> {
    const db = await this.open();
    try {
      await this.run(
        db,
        `INSERT INTO ${SYNC_STATE_TABLE}
           (team_id, cursor, etags_json, last_sync_at, last_error)
         VALUES (?, 0, '{}', NULL, ?)
         ON CONFLICT(team_id) DO UPDATE SET last_error = excluded.last_error`,
        [teamId, message.slice(0, 500)]
      );
    } finally {
      db.close();
    }
  }

  private run(
    db: Database,
    sql: string,
    params: Array<string | number | null>
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      db.run(sql, params, (err: Error | null) =>
        err ? reject(err) : resolve()
      );
    });
  }

  /** 查询多行（用于 PRAGMA 表结构自检） */
  private all(
    db: Database,
    sql: string
  ): Promise<Array<Record<string, unknown>>> {
    return new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
      db.all(sql, (err: Error | null, rows: Array<Record<string, unknown>>) =>
        err ? reject(err) : resolve(rows ?? [])
      );
    });
  }
}
