/**
 * P34 · 项目条目与工作项绑定（2026-11-02）
 *
 * 覆盖审计缺口「`project_items` 无 `work_item_id` / `assignment_id`」：
 * ① 新库写入后可往返读出两个绑定字段；
 * ② 存量库（首版表结构）在 `initialize()` 时幂等补列，补列后写入同样可读；
 * ③ 未提供绑定 ⇒ 读取为 `undefined`（普通对话条目零变更）。
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '@openliri/infra/external';

import { ProjectItemStore } from '../../src/workspace/ProjectItemStore';

const PROJECT_ID = 'p34-items';
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function setup(): { root: string; dbPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'p34-items-'));
  roots.push(root);
  mkdirSync(join(root, 'projects', PROJECT_ID), { recursive: true });
  return { root, dbPath: join(root, 'projects', PROJECT_ID, 'items.db') };
}

function openDb(dbPath: string): Promise<Database> {
  return new Promise((resolve, reject) => {
    const db = new Database(dbPath, (err: Error | null) =>
      err ? reject(err) : resolve(db)
    );
  });
}

function run(db: Database, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(sql, (err: Error | null) => (err ? reject(err) : resolve()));
  });
}

function item(over: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id: 'a1',
    projectId: PROJECT_ID,
    kind: 'artifact' as const,
    title: '报告.md',
    content: '报告.md',
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

describe('ProjectItemStore · 工作项绑定', () => {
  it('新库：workItemId / assignmentId 往返可读', async () => {
    const { root } = setup();
    const store = new ProjectItemStore(PROJECT_ID, root);
    await store.initialize();
    try {
      await store.upsert(item({ workItemId: 'w-1', assignmentId: 'as-1' }));
      const got = await store.getById('a1');
      expect(got?.workItemId).toBe('w-1');
      expect(got?.assignmentId).toBe('as-1');
    } finally {
      await store.close();
    }
  });

  it('未提供绑定 ⇒ undefined（普通对话条目零变更）', async () => {
    const { root } = setup();
    const store = new ProjectItemStore(PROJECT_ID, root);
    await store.initialize();
    try {
      await store.upsert(item());
      const got = await store.getById('a1');
      expect(got?.workItemId).toBeUndefined();
      expect(got?.assignmentId).toBeUndefined();
    } finally {
      await store.close();
    }
  });

  it('存量库：initialize() 幂等补列后可写入绑定', async () => {
    const { root, dbPath } = setup();
    const db = await openDb(dbPath);
    await run(
      db,
      `CREATE TABLE project_items (
        id          TEXT PRIMARY KEY NOT NULL,
        project_id  TEXT NOT NULL,
        kind        TEXT NOT NULL CHECK(kind IN ('context', 'artifact')),
        type        TEXT,
        title       TEXT NOT NULL,
        content     TEXT NOT NULL DEFAULT '',
        summary     TEXT,
        session_id  TEXT,
        message_id  TEXT,
        ref_ids     TEXT,
        phase       TEXT,
        tags        TEXT,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    );
    await new Promise<void>((resolve) => db.close(() => resolve()));

    // 连续两次初始化：补列必须幂等（第二次不因"列已存在"而失败）
    for (let i = 0; i < 2; i++) {
      const store = new ProjectItemStore(PROJECT_ID, root);
      await store.initialize();
      try {
        await store.upsert(
          item({ id: `a${i}`, workItemId: 'w-2', assignmentId: 'as-2' })
        );
        const got = await store.getById(`a${i}`);
        expect(got?.workItemId).toBe('w-2');
        expect(got?.assignmentId).toBe('as-2');
      } finally {
        await store.close();
      }
    }
  });
});
