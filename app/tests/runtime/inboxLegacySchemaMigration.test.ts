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
 * 旧库（无 `owner_key`）迁移回归（2026-10-27）。
 *
 * 实证缺陷：`idx_inbox_owner` 原先写在建表的同一个 `exec` 里，而补列的
 * `_migrateSchema` 在其后执行 ⇒ 旧库执行到 `CREATE INDEX … (owner_key)` 即抛
 * `table inbox_items has no column named owner_key` ⇒ `_createTable` 整体失败
 * ⇒ 所有审批提交降级为 "Inbox unavailable"（真机会话实测 ≥18 次）。
 *
 * 本用例用**旧库夹具**（结构与线上老库一致：到 `replied_at` 为止）断言：
 * 打开后列/索引补齐，且 `submit()` 成功。
 */
import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Database } from '@modules/external';
import { InboxManager } from '../../src/runtime/InboxManager';

const dir = mkdtempSync(join(tmpdir(), 'inbox-legacy-'));
const dbPath = join(dir, 'app.db');

/** 旧库夹具：与线上老库同构（**不含** `owner_key`） */
function seedLegacyDb(): void {
  const db = new Database(dbPath);
  db.exec(
    `CREATE TABLE inbox_items (
       id TEXT PRIMARY KEY,
       session_id TEXT NOT NULL,
       type TEXT NOT NULL DEFAULT 'approval',
       title TEXT NOT NULL,
       message TEXT NOT NULL DEFAULT '',
       status TEXT NOT NULL DEFAULT 'pending',
       reply TEXT,
       options TEXT,
       offline_capable INTEGER NOT NULL DEFAULT 1,
       source TEXT NOT NULL DEFAULT '',
       metadata TEXT,
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL,
       replied_at INTEGER
     );
     CREATE INDEX idx_inbox_session ON inbox_items(session_id);`,
    (err: Error | null) => {
      if (err) throw err;
    }
  );
  db.close();
}

function columnsOf(path: string, table: string): Promise<string[]> {
  const db = new Database(path);
  return new Promise((resolve, reject) => {
    db.all(
      `PRAGMA table_info(${table})`,
      (err: Error | null, rows: { name: string }[]) => {
        db.close();
        if (err) reject(err);
        else resolve(rows.map((r) => r.name));
      }
    );
  });
}

function indexesOf(path: string, table: string): Promise<string[]> {
  const db = new Database(path);
  return new Promise((resolve, reject) => {
    db.all(
      `PRAGMA index_list(${table})`,
      (err: Error | null, rows: { name: string }[]) => {
        db.close();
        if (err) reject(err);
        else resolve(rows.map((r) => r.name));
      }
    );
  });
}

const manager = new InboxManager(dbPath);

afterAll(() => {
  manager.dispose();
});

describe('InboxManager：旧库迁移', () => {
  it('旧库（无 owner_key）打开后补列补索引，且 submit 成功', async () => {
    seedLegacyDb();
    expect(await columnsOf(dbPath, 'inbox_items')).not.toContain('owner_key');

    const item = await manager.submit({
      sessionId: 'sess-legacy',
      type: 'approval',
      title: '工具审批: bash',
      message: '需要人工确认',
      options: ['approve', 'deny'],
      offlineCapable: true,
      source: 'permission',
      metadata: { sourceModule: 'permission', toolName: 'bash' },
    });

    expect(item.id).toBeTruthy();
    expect(await columnsOf(dbPath, 'inbox_items')).toContain('owner_key');
    expect(await indexesOf(dbPath, 'inbox_items')).toContain('idx_inbox_owner');
  });
});
