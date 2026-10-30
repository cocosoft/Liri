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
 * 存量清理：AlwaysOn 的「执行完成」历史通知（2026-10-31，用户批准）。
 *
 * **背景**：`460d30898` 已根因修复"新的"刷屏（成功静默 + 稳定去重键 + 来源级预算），
 * 但历史仍留着 **671 条** `AlwaysOn · <项目> 执行完成`（占 notifications 总数 95%），
 * 继续占据消息中心的「通知」Tab。运行记录本身在 `alwayson/reports/*.md` 与
 * `run-logs/*.jsonl`，通知只是重复副本。
 *
 * **口径（保守可回滚）**：
 *  - 只匹配 `title LIKE 'AlwaysOn · %'`（带分隔符，避免误删其它以 AlwaysOn 开头的文案）；
 *  - 默认**只读预演**，`--apply` 才删；
 *  - 删前把**完整行**备份为 `migrations/alwayson-notifications-prune-<ts>/notifications.jsonl`，
 *    并写 `audit.jsonl`（回滚 = 按 id 重新 INSERT 备份行）；
 *  - 单事务删除（失败整体回滚，不留半截）。
 *
 * **不动的数据**：`pending_proactive_pushes` 里的队列行（门禁的 24h 去重/限流回看依赖它，
 * 且按保留期自行清理）；其它来源（`calendar` / `budget`）与系统通知。
 *
 * 运行（**先停止应用**：SQLite 单写者，避免与运行中的队列写并发）：
 *   cd app && bun run prune:alwayson-notifications            # 预演
 *   cd app && bun run prune:alwayson-notifications -- --apply
 */

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
// 统一连接初始化（PRAGMA 单一事实源）：scripts 与运行时共用 `openBunDatabase`
import {
  openBunDatabase,
  type BunDatabase,
} from '../src/external/sqlite3';

/**
 * 匹配口径：**旧格式**的 AlwaysOn 播报（`… 执行完成`）。
 *
 * 刻意不匹配根因修复后的新通知（`… 需要关注（执行失败/本轮未执行/目标未达成）`）——
 * 那些是需要人介入的有效提醒，必须保留。
 */
export const ALWAYSON_NOTICE_PATTERN = 'AlwaysOn · %执行完成';

export interface AlwaysOnNotificationRow {
  id: string;
  title: string;
  status: string;
  created_at: number;
  source: string | null;
}

export interface AlwaysOnNotificationScan {
  /** 命中条数 */
  matched: number;
  /** notifications 总行数 */
  total: number;
  /** 时间跨度（epoch 秒；无命中 ⇒ 0） */
  since: number;
  until: number;
  /** 最近的若干条（预演展示用） */
  sample: AlwaysOnNotificationRow[];
}

export interface PruneAlwaysOnNotificationsResult {
  scan: AlwaysOnNotificationScan;
  applied: number;
  backupDir?: string;
}

function openDb(dbPath: string, readonly: boolean): BunDatabase {
  return openBunDatabase(dbPath, { readonly });
}

/** 只读扫描（预演与执行共用） */
export function scanAlwaysOnNotifications(
  dbPath: string
): AlwaysOnNotificationScan {
  const db = openDb(dbPath, true);
  try {
    const matched = (
      db
        .query(
          `SELECT COUNT(*) AS n FROM notifications WHERE title LIKE ?`
        )
        .get(ALWAYSON_NOTICE_PATTERN) as { n: number }
    ).n;
    const total = (
      db.query('SELECT COUNT(*) AS n FROM notifications').get() as { n: number }
    ).n;
    const span =
      matched > 0
        ? (db
            .query(
              `SELECT MIN(created_at) AS a, MAX(created_at) AS b
                 FROM notifications WHERE title LIKE ?`
            )
            .get(ALWAYSON_NOTICE_PATTERN) as { a: number; b: number })
        : { a: 0, b: 0 };
    const sample =
      matched > 0
        ? (db
            .query(
              `SELECT id, title, status, created_at, source
                 FROM notifications WHERE title LIKE ?
                ORDER BY created_at DESC LIMIT 5`
            )
            .all(ALWAYSON_NOTICE_PATTERN) as unknown as AlwaysOnNotificationRow[])
        : [];
    return { matched, total, since: span.a, until: span.b, sample };
  } finally {
    db.close();
  }
}

/**
 * 执行（或预演）清理。
 *
 * `apply=false` 只返回扫描结果；`apply=true` 先备份全部命中行，再单事务删除。
 */
export function pruneAlwaysOnNotifications(
  params: { dbPath: string; dataRoot: string; apply: boolean; now?: Date }
): PruneAlwaysOnNotificationsResult {
  const scan = scanAlwaysOnNotifications(params.dbPath);
  if (!params.apply || scan.matched === 0) {
    return { scan, applied: 0 };
  }

  const stamp = (params.now ?? new Date())
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..*$/, '');
  const backupDir = join(
    params.dataRoot,
    'migrations',
    `alwayson-notifications-prune-${stamp}`
  );
  mkdirSync(backupDir, { recursive: true });

  const db = openDb(params.dbPath, false);
  try {
    const rows = db
      .query(`SELECT * FROM notifications WHERE title LIKE ?`)
      .all(ALWAYSON_NOTICE_PATTERN) as Array<Record<string, unknown>>;
    // 备份完整行（JSONL：一行一条，便于按 id 重新 INSERT 回滚）
    writeFileSync(
      join(backupDir, 'notifications.jsonl'),
      `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`,
      'utf-8'
    );

    // 单事务删除：任何一步失败整体回滚，不留半截
    let removed = 0;
    db.exec('BEGIN');
    try {
      const res = db
        .query(`DELETE FROM notifications WHERE title LIKE ?`)
        .run(ALWAYSON_NOTICE_PATTERN);
      removed = Number(res.changes ?? 0);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    db.close();

    appendFileSync(
      join(backupDir, 'audit.jsonl'),
      `${JSON.stringify({
        ts: new Date().toISOString(),
        pattern: ALWAYSON_NOTICE_PATTERN,
        removed,
        totalBefore: scan.total,
        since: scan.since,
        until: scan.until,
        backup: join(backupDir, 'notifications.jsonl'),
      })}\n`,
      'utf-8'
    );
    return { scan, applied: removed, backupDir };
  } catch (err) {
    db.close();
    throw err;
  }
}

/** CLI 入口（`--apply` 才删；`--db` / `--root` / `--json`） */
function main(): number {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const json = argv.includes('--json');
  const arg = (name: string): string | undefined => {
    const eq = argv.find((a) => a.startsWith(`${name}=`));
    if (eq) return eq.slice(name.length + 1);
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const dataRoot = arg('--root') ?? join(homedir(), '.pyapp', 'data');
  const dbPath = arg('--db') ?? join(dataRoot, 'app.db');
  if (!existsSync(dbPath)) {
    console.error(`找不到数据库：${dbPath}`);
    return 1;
  }

  const result = pruneAlwaysOnNotifications({
    dbPath,
    dataRoot,
    apply,
  });
  if (json) {
    console.log(JSON.stringify(result));
    return 0;
  }

  const { scan } = result;
  const fmt = (s: number) =>
    s > 0
      ? new Date(s * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
      : '-';
  console.log(
    `[prune:alwayson-notifications] db=${dbPath} ${apply ? 'APPLY' : '预演（只读，加 --apply 才删）'}`
  );
  console.log(
    `  命中 ${scan.matched} 条（notifications 共 ${scan.total} 条）；时间跨度 ${fmt(scan.since)} → ${fmt(scan.until)}`
  );
  for (const row of scan.sample) {
    console.log(
      `   · ${fmt(row.created_at)}  [${row.status}]  ${row.title.slice(0, 56)}`
    );
  }
  if (apply) {
    console.log(
      `  已删除 ${result.applied} 条；备份 + 审计：${result.backupDir ?? '-'}`
    );
  } else if (scan.matched > 0) {
    console.log('  预演结束（未改动任何数据）');
  }
  return 0;
}

if (import.meta.main) {
  process.exit(main());
}
