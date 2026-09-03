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
// IMPLIED, BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * DreamCycleDb — 梦境周期 SQL 镜像（3-4 + HTTP analytics 端点，2026-09-03）
 *
 * 权威记录仍为 cycles/<cycleId>.json（DreamPersistence.saveCycle，UDC saveCycle）；
 * 本模块在 app.db 维护 dream_cycles 镜像表，供按时间窗/触发源/状态 SQL 查询与统计。
 *
 * v3 语义（对齐 HTTP analytics 端点设计 v3）：
 * - 时间过滤/排序统一用 completed_at（与 JSON 源 listCycles 的 completedAt 一致）
 * - created_at = 首次出现的 startedAt（幂等；ON CONFLICT 保留首值，弃 Date.now()）
 * - prune 与 JSON 侧 pruneOldCycles 口径一致（超龄 + 溢出保留最近 keepMax）
 */

import { Database } from '@modules/core/external/sqlite3';
import { resolveDbPath } from '@modules/core';
import { handleError } from '@modules/error';
import type { DreamCycleRecord } from './types';

/** limit 上限（v3：缺省 50、非法(<1/NaN/0)回 50、>500 截 500） */
export const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 50;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS dream_cycles (
  cycle_id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  completed_at INTEGER NOT NULL,
  trigger_source TEXT NOT NULL,
  status TEXT NOT NULL,
  sessions_scanned INTEGER NOT NULL DEFAULT 0,
  sessions_processed INTEGER NOT NULL DEFAULT 0,
  knowledge_files_processed INTEGER NOT NULL DEFAULT 0,
  memories_created INTEGER NOT NULL DEFAULT 0,
  memories_refined INTEGER NOT NULL DEFAULT 0,
  knowledge_files_updated INTEGER NOT NULL DEFAULT 0,
  soul_updated INTEGER NOT NULL DEFAULT 0,
  user_profile_updated INTEGER NOT NULL DEFAULT 0,
  memory_count INTEGER NOT NULL DEFAULT 0,
  soul_conflicts INTEGER,
  user_conflicts INTEGER,
  insights_json TEXT,
  errors_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dream_cycles_started ON dream_cycles(started_at);
CREATE INDEX IF NOT EXISTS idx_dream_cycles_source ON dream_cycles(trigger_source);
`;

/** dream_cycles 行（读取用，snake → camel） */
export interface DreamCycleRow {
  cycleId: string;
  startedAt: number;
  completedAt: number;
  triggerSource: string;
  status: string;
  sessionsScanned: number;
  sessionsProcessed: number;
  knowledgeFilesProcessed: number;
  memoriesCreated: number;
  memoriesRefined: number;
  knowledgeFilesUpdated: number;
  soulUpdated: boolean;
  userProfileUpdated: boolean;
  memoryCount: number;
  soulConflicts: number | null;
  userConflicts: number | null;
  insights: string[];
  errors: string[];
  createdAt: number;
}

/** 周期统计（HTTP analytics stats，v3） */
export interface CycleStats {
  total: number;
  completed: number;
  partial: number;
  failed: number;
  byTriggerSource: Record<string, number>;
  /** 仅 completed/partial 行的均值；空均值集 → null */
  avgMemoriesCreated: number | null;
}

/** 过滤条件（query/aggregate 共用 where 构造） */
export interface CycleFilter {
  from?: number;
  to?: number;
  triggerSource?: string;
  status?: string;
  limit?: number;
}

function run(db: Database, sql: string, params: unknown[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function exec(db: Database, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    db.exec(sql, (err: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function all<T>(
  db: Database,
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err: Error | null, rows: T[]) => {
      if (err) reject(err);
      else resolve(rows ?? []);
    });
  });
}

/** where 子句与参数（from/to 按 completed_at；from/to 已由调用方过滤非有限数） */
function buildWhere(filter?: CycleFilter): {
  where: string;
  params: unknown[];
} {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (filter?.from !== undefined) {
    conds.push('completed_at >= ?');
    params.push(filter.from);
  }
  if (filter?.to !== undefined) {
    conds.push('completed_at <= ?');
    params.push(filter.to);
  }
  if (filter?.triggerSource) {
    conds.push('trigger_source = ?');
    params.push(filter.triggerSource);
  }
  if (filter?.status) {
    conds.push('status = ?');
    params.push(filter.status);
  }
  return {
    where: conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '',
    params,
  };
}

/** limit 语义（v3）：缺省 50、非法(<1/NaN)回 50、>500 截 500 */
function resolveLimit(limit?: number): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  if (!Number.isFinite(limit) || limit < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

export class DreamCycleDb {
  private db: Database | null = null;

  constructor(private dbPath: string = resolveDbPath()) {}

  async init(): Promise<void> {
    if (this.db) return;
    this.db = await new Promise<Database>((resolve, reject) => {
      const db = new Database(this.dbPath, (err) => {
        if (err) reject(err);
        else resolve(db);
      });
    });
    await exec(this.db, SCHEMA);
  }

  /**
   * upsert 周期。created_at = 首次出现的 startedAt（幂等）；
   * ON CONFLICT 只更新业务字段，不更新 created_at。
   */
  async upsertCycle(record: DreamCycleRecord): Promise<void> {
    const db = this.db;
    if (!db) return;
    const createdAt = Number.isFinite(record.startedAt)
      ? record.startedAt
      : Date.now();
    await run(
      db,
      `INSERT INTO dream_cycles
        (cycle_id, started_at, completed_at, trigger_source, status,
         sessions_scanned, sessions_processed, knowledge_files_processed,
         memories_created, memories_refined, knowledge_files_updated,
         soul_updated, user_profile_updated, memory_count,
         soul_conflicts, user_conflicts, insights_json, errors_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(cycle_id) DO UPDATE SET
         started_at = excluded.started_at,
         completed_at = excluded.completed_at,
         trigger_source = excluded.trigger_source,
         status = excluded.status,
         sessions_scanned = excluded.sessions_scanned,
         sessions_processed = excluded.sessions_processed,
         knowledge_files_processed = excluded.knowledge_files_processed,
         memories_created = excluded.memories_created,
         memories_refined = excluded.memories_refined,
         knowledge_files_updated = excluded.knowledge_files_updated,
         soul_updated = excluded.soul_updated,
         user_profile_updated = excluded.user_profile_updated,
         memory_count = excluded.memory_count,
         soul_conflicts = excluded.soul_conflicts,
         user_conflicts = excluded.user_conflicts,
         insights_json = excluded.insights_json,
         errors_json = excluded.errors_json`,
      [
        record.cycleId,
        record.startedAt,
        record.completedAt,
        record.triggerSource,
        record.status,
        record.sessionsScanned ?? 0,
        record.sessionsProcessed ?? 0,
        record.knowledgeFilesProcessed ?? 0,
        record.memoriesCreated ?? 0,
        record.memoriesRefined ?? 0,
        record.knowledgeFilesUpdated ?? 0,
        record.soulUpdated ? 1 : 0,
        record.userProfileUpdated ? 1 : 0,
        record.memoryCount ?? 0,
        record.soulConflicts ?? null,
        record.userConflicts ?? null,
        JSON.stringify(record.insights ?? []),
        JSON.stringify(record.errors ?? []),
        createdAt,
      ]
    );
  }

  /** 查询周期：completed_at 时间窗/触发源/状态过滤 + limit（v3 语义） */
  async queryCycles(filter?: CycleFilter): Promise<DreamCycleRow[]> {
    const db = this.db;
    if (!db) return [];
    const { where, params } = buildWhere(filter);
    const limit = resolveLimit(filter?.limit);
    const rows = await all<Record<string, unknown>>(
      db,
      `SELECT cycle_id, started_at, completed_at, trigger_source, status,
              sessions_scanned, sessions_processed, knowledge_files_processed,
              memories_created, memories_refined, knowledge_files_updated,
              soul_updated, user_profile_updated, memory_count,
              soul_conflicts, user_conflicts, insights_json, errors_json, created_at
         FROM dream_cycles
        ${where}
        ORDER BY completed_at DESC
        LIMIT ?`,
      [...params, limit]
    );
    return rows.map((r) => ({
      cycleId: r.cycle_id as string,
      startedAt: r.started_at as number,
      completedAt: r.completed_at as number,
      triggerSource: r.trigger_source as string,
      status: r.status as string,
      sessionsScanned: (r.sessions_scanned as number) ?? 0,
      sessionsProcessed: (r.sessions_processed as number) ?? 0,
      knowledgeFilesProcessed: (r.knowledge_files_processed as number) ?? 0,
      memoriesCreated: (r.memories_created as number) ?? 0,
      memoriesRefined: (r.memories_refined as number) ?? 0,
      knowledgeFilesUpdated: (r.knowledge_files_updated as number) ?? 0,
      soulUpdated: (r.soul_updated as number) === 1,
      userProfileUpdated: (r.user_profile_updated as number) === 1,
      memoryCount: (r.memory_count as number) ?? 0,
      soulConflicts: (r.soul_conflicts as number | null) ?? null,
      userConflicts: (r.user_conflicts as number | null) ?? null,
      insights: JSON.parse((r.insights_json as string) || '[]') as string[],
      errors: JSON.parse((r.errors_json as string) || '[]') as string[],
      createdAt: r.created_at as number,
    }));
  }

  /** 全量统计（过滤后口径）：行维度 + GROUP BY trigger_source，两次并行查询 */
  async aggregateCycles(
    filter?: Omit<CycleFilter, 'limit'>
  ): Promise<CycleStats> {
    const db = this.db;
    if (!db) {
      return {
        total: 0,
        completed: 0,
        partial: 0,
        failed: 0,
        byTriggerSource: {},
        avgMemoriesCreated: null,
      };
    }
    const { where, params } = buildWhere(filter);
    const [sumRow, groupRows] = await Promise.all([
      all<Record<string, unknown>>(
        db,
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
                SUM(CASE WHEN status = 'partial' THEN 1 ELSE 0 END) AS partial,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
                AVG(CASE WHEN status IN ('completed','partial')
                         THEN memories_created END) AS avg_memories
           FROM dream_cycles
          ${where}`,
        params
      ),
      all<Record<string, unknown>>(
        db,
        `SELECT trigger_source, COUNT(*) AS cnt
           FROM dream_cycles
          ${where}
          GROUP BY trigger_source`,
        params
      ),
    ]);
    const s = sumRow[0] ?? {};
    const byTriggerSource: Record<string, number> = {};
    for (const g of groupRows) {
      byTriggerSource[g.trigger_source as string] = (g.cnt as number) ?? 0;
    }
    return {
      total: (s.total as number) ?? 0,
      completed: (s.completed as number) ?? 0,
      partial: (s.partial as number) ?? 0,
      failed: (s.failed as number) ?? 0,
      byTriggerSource,
      avgMemoriesCreated:
        s.avg_memories === null || s.avg_memories === undefined
          ? null
          : Number(s.avg_memories),
    };
  }

  /** 清理镜像（与 JSON 侧 pruneOldCycles 口径一致：超龄删除 + 溢出保留最近 keepMax）。返回删除行数 */
  async pruneCycles(maxAgeMs: number, keepMax: number): Promise<number> {
    const db = this.db;
    if (!db) return 0;
    const cutoff = Date.now() - maxAgeMs;
    const toDelete = await all<{ id: string }>(
      db,
      `SELECT cycle_id AS id FROM dream_cycles WHERE completed_at < ?`,
      [cutoff]
    );
    await run(db, `DELETE FROM dream_cycles WHERE completed_at < ?`, [cutoff]);
    const remain = await all<{ n: number }>(
      db,
      `SELECT COUNT(*) AS n FROM dream_cycles`,
      []
    );
    const remainCount = remain[0]?.n ?? 0;
    let overflow = 0;
    if (remainCount > keepMax) {
      overflow = remainCount - keepMax;
      await run(
        db,
        `DELETE FROM dream_cycles WHERE cycle_id IN (
           SELECT cycle_id FROM dream_cycles ORDER BY completed_at ASC LIMIT ?
         )`,
        [overflow]
      );
    }
    return toDelete.length + overflow;
  }

  async close(): Promise<void> {
    if (!this.db) return;
    const db = this.db;
    this.db = null;
    await new Promise<void>((resolve) => {
      db.close(() => resolve());
    });
  }
}

/** 惰性单例（UDC/handler 共用，避免重复连接） */
let _instance: DreamCycleDb | null = null;
export async function getDreamCycleDb(): Promise<DreamCycleDb> {
  _instance ??= new DreamCycleDb();
  await _instance.init();
  return _instance;
}

/** fire-and-forget 便捷 upsert（失败降级日志） */
export async function mirrorCycleToDb(record: DreamCycleRecord): Promise<void> {
  try {
    const db = await getDreamCycleDb();
    await db.upsertCycle(record);
  } catch (err) {
    await handleError(err, {
      module: 'dream:cycleDb',
      action: 'mirrorCycleToDb',
      context: { cycleId: record.cycleId },
    });
  }
}

/** fire-and-forget 便捷 prune（失败降级日志；由 JSON 侧 pruneOldCycles 调用） */
export async function mirrorPruneToDb(
  maxAgeMs: number,
  keepMax: number
): Promise<void> {
  try {
    const db = await getDreamCycleDb();
    await db.pruneCycles(maxAgeMs, keepMax);
  } catch (err) {
    await handleError(err, {
      module: 'dream:cycleDb',
      action: 'mirrorPruneToDb',
      context: { maxAgeMs, keepMax },
    });
  }
}
