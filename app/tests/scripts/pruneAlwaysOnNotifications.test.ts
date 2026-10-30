/**
 * 存量清理：AlwaysOn「执行完成」历史通知（2026-10-31，用户批准）。
 *
 * 覆盖：口径（只匹配 `AlwaysOn · %`）、预演只读、`--apply` 备份 + 审计 + 单事务删除、幂等。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  pruneAlwaysOnNotifications,
  scanAlwaysOnNotifications,
} from '../../scripts/prune-alwayson-notifications.js';
import { openBunDatabase } from '../../src/external/sqlite3';

let root: string;
let dbPath: string;

const SCHEMA = `
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  source TEXT,
  created_at INTEGER NOT NULL
);
`;

function seed(): void {
  const db = openBunDatabase(dbPath);
  db.exec(SCHEMA);
  const insert = db.query(
    'INSERT INTO notifications (id, title, status, source, created_at) VALUES (?, ?, ?, ?, ?)'
  );
  insert.run('a1', 'AlwaysOn · 项目甲 执行完成', 'read', 'proactive', 1000);
  insert.run('a2', 'AlwaysOn · 项目乙 执行完成', 'unread', 'proactive', 2000);
  insert.run('a3', 'AlwaysOn · 项目丙 执行完成', 'unread', 'proactive', 3000);
  insert.run('c1', '日历提醒：周会', 'unread', 'calendar', 1500);
  insert.run('s1', '系统通知：磁盘空间不足', 'unread', 'system', 1600);
  // 根因修复后的**新格式**（需人介入的有效提醒）——必须保留
  insert.run(
    'n1',
    'AlwaysOn · 项目丁 需要关注（执行失败）',
    'unread',
    'proactive',
    4000
  );
  db.close();
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'liri-alwayson-notif-'));
  dbPath = join(root, 'app.db');
  seed();
});

afterEach(() => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    // Windows 上偶发 EBUSY（句柄释放延迟）：临时目录留给系统清理
  }
});

describe('scanAlwaysOnNotifications（口径）', () => {
  it('只命中旧格式「执行完成」；其它来源与新的「需要关注」提醒不计入', () => {
    const scan = scanAlwaysOnNotifications(dbPath);
    expect(scan.matched).toBe(3);
    expect(scan.total).toBe(6);
    expect(scan.since).toBe(1000);
    expect(scan.until).toBe(3000);
    expect(scan.sample[0]!.id).toBe('a3'); // 最新在前（n1 不命中）
  });
});

describe('pruneAlwaysOnNotifications（预演 / 执行）', () => {
  it('预演：不删除任何行、不建备份', () => {
    const result = pruneAlwaysOnNotifications({
      dbPath,
      dataRoot: root,
      apply: false,
    });
    expect(result.scan.matched).toBe(3);
    expect(result.applied).toBe(0);
    expect(existsSync(join(root, 'migrations'))).toBe(false);
    expect(scanAlwaysOnNotifications(dbPath).total).toBe(6);
  });

  it('--apply：备份完整行 + 审计 + 单事务删除；其它通知保留', () => {
    const result = pruneAlwaysOnNotifications({
      dbPath,
      dataRoot: root,
      apply: true,
      now: new Date('2026-10-31T12:00:00Z'),
    });
    expect(result.applied).toBe(3);
    expect(scanAlwaysOnNotifications(dbPath).matched).toBe(0);
    // 保留：calendar / system / 新的「需要关注」各 1 条
    expect(scanAlwaysOnNotifications(dbPath).total).toBe(3);

    const backupDir = join(
      root,
      'migrations',
      'alwayson-notifications-prune-20261031T120000'
    );
    const backup = readFileSync(join(backupDir, 'notifications.jsonl'), 'utf-8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
    expect(backup).toHaveLength(3);
    expect(backup.map((r) => r.id).sort()).toEqual(['a1', 'a2', 'a3']);

    const audit = JSON.parse(
      readFileSync(join(backupDir, 'audit.jsonl'), 'utf-8').trim()
    );
    expect(audit).toMatchObject({ removed: 3, totalBefore: 6 });
  });

  it('重复执行 ⇒ 幂等（无命中即不建备份）', () => {
    pruneAlwaysOnNotifications({ dbPath, dataRoot: root, apply: true });
    const again = pruneAlwaysOnNotifications({
      dbPath,
      dataRoot: root,
      apply: true,
    });
    expect(again.scan.matched).toBe(0);
    expect(again.applied).toBe(0);
    expect(again.backupDir).toBeUndefined();
  });
});
