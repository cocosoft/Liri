/**
 * M14（2026-10-30，一致性核查）：废弃空表 `work_items` 的下线契约。
 *
 * 背景：该表原由 `TASKS_SCHEMA`（Phase 2 预留）建出，但全仓**零读零写**；真实工作项在
 * `app.db.workitems`（`PdcaWorkItemBridge`）。`task-surface-map.md` 已登记「空表下线」。
 *
 * 本用例钉住三条安全边界（CD05/CD06）：
 *  ① 新库**不再创建** `work_items`（建表语句已从 schema 删除）；
 *  ② 存量**空表** ⇒ `init()` 后幂等 DROP；
 *  ③ 存量**有数据** ⇒ **保留**（绝不静默丢数据），仅告警。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { Database } from '@modules/external';
import { SqliteTaskStore } from '../../src/tasks/db/SqliteTaskStore.js';

let root: string;

function openDb(path: string): Promise<Database> {
  return new Promise((resolve, reject) => {
    const db = new Database(path, (err: Error | null) => {
      if (err) reject(err);
      else resolve(db);
    });
  });
}

function run(db: Database, sql: string, params: unknown[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err: Error | null) => (err ? reject(err) : resolve()));
  });
}

function query(
  db: Database,
  sql: string
): Promise<Array<Record<string, unknown>>> {
  return new Promise((resolve, reject) => {
    db.all(sql, (err: Error | null, rows: Array<Record<string, unknown>>) =>
      err ? reject(err) : resolve(rows)
    );
  });
}

/** 表是否存在（按 sqlite_master 判定，不看数据行） */
async function tableExists(db: Database, name: string): Promise<boolean> {
  const rows = await query(
    db,
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${name}'`
  );
  return rows.length > 0;
}

/** 复刻旧版 schema 的 `work_items` 建表（仅供「存量库」用例） */
const LEGACY_WORK_ITEMS_DDL = `
CREATE TABLE IF NOT EXISTS work_items (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'task',
  status TEXT NOT NULL DEFAULT 'pending',
  session_id TEXT,
  tags TEXT,
  priority INTEGER DEFAULT 3,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);
`;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'liri-workitems-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('M14 废弃表 work_items 下线', () => {
  it('新库不再创建 work_items（建表语句已从 TASKS_SCHEMA 删除）', async () => {
    const dbPath = join(root, 'fresh.db');
    const store = new SqliteTaskStore(dbPath);
    await store.init();
    await store.close();

    const db = await openDb(dbPath);
    try {
      expect(await tableExists(db, 'work_items')).toBe(false);
      // 其他任务表照常创建（零行为变更）
      expect(await tableExists(db, 'task_states')).toBe(true);
      expect(await tableExists(db, 'task_runs')).toBe(true);
    } finally {
      await new Promise<void>((resolve) => db.close(() => resolve()));
    }
  });

  it('存量空表 ⇒ init() 幂等 DROP', async () => {
    const dbPath = join(root, 'legacy-empty.db');
    const seed = await openDb(dbPath);
    await run(seed, LEGACY_WORK_ITEMS_DDL);
    await new Promise<void>((resolve) => seed.close(() => resolve()));

    const store = new SqliteTaskStore(dbPath);
    await store.init();
    await store.close();

    const db = await openDb(dbPath);
    try {
      expect(await tableExists(db, 'work_items')).toBe(false);
    } finally {
      await new Promise<void>((resolve) => db.close(() => resolve()));
    }
  });

  it('存量有数据 ⇒ 保留（绝不静默丢数据）', async () => {
    const dbPath = join(root, 'legacy-rows.db');
    const seed = await openDb(dbPath);
    await run(seed, LEGACY_WORK_ITEMS_DDL);
    await run(
      seed,
      `INSERT INTO work_items (id, workspace_id, title, created_at, updated_at)
       VALUES ('wi-1', 'default', '历史工作项', 1, 1)`
    );
    await new Promise<void>((resolve) => seed.close(() => resolve()));

    const store = new SqliteTaskStore(dbPath);
    await store.init();
    await store.close();

    const db = await openDb(dbPath);
    try {
      expect(await tableExists(db, 'work_items')).toBe(true);
      const rows = await query(db, 'SELECT id FROM work_items');
      expect(rows).toEqual([{ id: 'wi-1' }]);
    } finally {
      await new Promise<void>((resolve) => db.close(() => resolve()));
    }
  });
});
