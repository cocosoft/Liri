/**
 * P3-a：孤儿会话成本摘要清理（2026-10-31）。
 *
 * 覆盖：存活口径（磁盘会话 + `.trash` 可恢复会话）、预演只读、apply 备份+审计+事务删除、
 * 幂等、以及「sessions 目录不可读 ⇒ 拒绝全清」的防御。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  collectKnownSessionIds,
  pruneOrphanCostSummaries,
} from '../../scripts/prune-orphan-cost-summaries.js';
import { openBunDatabase } from '../../src/external/sqlite3';

let root: string;
let dbPath: string;

const SCHEMA = `
CREATE TABLE session_cost_summaries (
  session_id TEXT PRIMARY KEY,
  total_cost_usd REAL NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

function seedDb(): void {
  const db = openBunDatabase(dbPath);
  db.exec(SCHEMA);
  const insert = db.query(
    'INSERT INTO session_cost_summaries (session_id, total_cost_usd, updated_at) VALUES (?, ?, ?)'
  );
  insert.run('live-1', 1.5, 3000); // 磁盘上仍存在
  insert.run('trashed-1', 0.8, 2000); // 已软删除但可恢复（7 天 TTL 内）
  insert.run('orphan-1', 2.0, 1000); // 真孤儿
  insert.run('orphan-2', 0.3, 500); // 真孤儿
  insert.run('global', 11.1, 4000); // 全局聚合桶（受保护）
  db.close();
}

function seedFs(): void {
  mkdirSync(join(root, 'sessions', 'p1', 'live-1'), { recursive: true });
  mkdirSync(join(root, 'sessions', 'p1', '.trash', 'trashed-1_1793400000000'), {
    recursive: true,
  });
  mkdirSync(join(root, 'sessions', 'p1', 'pid'), { recursive: true });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'liri-orphan-cost-'));
  dbPath = join(root, 'app.db');
  seedFs();
  seedDb();
});

afterEach(() => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    // Windows 偶发 EBUSY：留给系统清理
  }
});

describe('collectKnownSessionIds（存活口径）', () => {
  it('磁盘会话 + .trash 可恢复会话都算存活；pid 不算', () => {
    const known = collectKnownSessionIds(root);
    expect(known.has('live-1')).toBe(true);
    expect(known.has('trashed-1')).toBe(true);
    expect(known.has('pid')).toBe(false);
  });
});

describe('pruneOrphanCostSummaries', () => {
  it('预演：只报告孤儿，不删行、不建备份', () => {
    const result = pruneOrphanCostSummaries({
      dataRoot: root,
      dbPath,
      apply: false,
    });
    expect(result.scan.totalSummaryRows).toBe(5);
    expect(result.scan.orphans).toBe(2);
    expect(result.applied).toBe(0);
    expect(existsSync(join(root, 'migrations'))).toBe(false);

    const db = openBunDatabase(dbPath, { readonly: true });
    expect(
      (
        db.query('SELECT COUNT(*) AS n FROM session_cost_summaries').get() as {
          n: number;
        }
      ).n
    ).toBe(5);
    db.close();
  });

  it('--apply：只删孤儿，备份 + 审计；存活的与可恢复的保留', () => {
    const result = pruneOrphanCostSummaries({
      dataRoot: root,
      dbPath,
      apply: true,
      now: new Date('2026-10-31T12:00:00Z'),
    });
    expect(result.applied).toBe(2);

    const db = openBunDatabase(dbPath, { readonly: true });
    const ids = (
      db.query('SELECT session_id FROM session_cost_summaries').all() as Array<{
        session_id: string;
      }>
    )
      .map((r) => r.session_id)
      .sort();
    expect(ids).toEqual(['global', 'live-1', 'trashed-1']);
    db.close();

    const backupDir = join(
      root,
      'migrations',
      'orphan-cost-summaries-20261031T120000'
    );
    const backup = readFileSync(
      join(backupDir, 'session_cost_summaries.jsonl'),
      'utf-8'
    )
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
    expect(backup.map((r) => r.session_id).sort()).toEqual([
      'orphan-1',
      'orphan-2',
    ]);
    const audit = JSON.parse(
      readFileSync(join(backupDir, 'audit.jsonl'), 'utf-8').trim()
    );
    expect(audit).toMatchObject({ removed: 2, totalBefore: 5 });
  });

  it('重复执行 ⇒ 幂等', () => {
    pruneOrphanCostSummaries({ dataRoot: root, dbPath, apply: true });
    const again = pruneOrphanCostSummaries({
      dataRoot: root,
      dbPath,
      apply: true,
    });
    expect(again.scan.orphans).toBe(0);
    expect(again.applied).toBe(0);
  });

  it('防御：sessions 目录不存在（无可信存活集）⇒ apply 抛错、不删任何行', () => {
    const emptyRoot = mkdtempSync(join(tmpdir(), 'liri-orphan-empty-'));
    try {
      expect(() =>
        pruneOrphanCostSummaries({
          dataRoot: emptyRoot,
          dbPath,
          apply: true,
        })
      ).toThrow(/拒绝批量删除/);
      const db = openBunDatabase(dbPath, { readonly: true });
      expect(
        (
          db
            .query('SELECT COUNT(*) AS n FROM session_cost_summaries')
            .get() as { n: number }
        ).n
      ).toBe(5);
      db.close();
    } finally {
      try {
        rmSync(emptyRoot, { recursive: true, force: true });
      } catch {
        // 同上
      }
    }
  });
});
