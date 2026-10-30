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
 * P3-a（2026-10-31）：清理**孤儿**会话成本摘要（`session_cost_summaries`）。
 *
 * **背景**：实测 `session_cost_summaries` **405 行**，而磁盘只剩 12 个会话目录
 * （一致性核查 §P3-a：「session_cost_summaries 增加按会话存在性的清理」）。
 * 每删一个会话，成本摘要都留在库里，长期只增不减。
 *
 * **判定口径（保守）**：
 *  - 存活 = 磁盘上仍存在的会话目录（`sessions/<分区>/<会话>`，跳过 `.trash` / `pid`）；
 *  - **软删除可恢复**：`.trash/<sessionId>_<ts>` 里的会话 id 也算"仍存在"（7 天 TTL 内可回滚，
 *    摘要必须保留，否则回滚后成本丢失）；
 *  - 只有两者都不在的 `session_id` 才算孤儿。
 *
 * **安全**：默认只读预演；`--apply` 先把命中行完整备份到
 * `migrations/orphan-cost-summaries-<ts>/session_cost_summaries.jsonl` + `audit.jsonl`，
 * 再单事务删除。
 *
 * 运行（建议先停止应用）：
 *   cd app && bun run prune:orphan-cost-summaries
 *   cd app && bun run prune:orphan-cost-summaries -- --apply
 */

import { appendFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { openBunDatabase, type BunDatabase } from '../src/external/sqlite3';

/** `.trash/<sessionId>_<epochMs>` → sessionId（去掉尾部时间戳） */
const TRASH_NAME_RE = /^(.*)_\d+$/;

/**
 * 受保护的"伪会话"id：`session_id` 为空时 `CostRecordRepository` 用 `'global'` 落
 * 全局聚合桶（`CostRecordRepository.ts:301`），它不是会话，**永不删除**。
 */
export const PROTECTED_SUMMARY_IDS: ReadonlySet<string> = new Set(['global']);

/**
 * 收集"仍存在"的会话 id：磁盘会话目录 ∪ `.trash` 内可恢复的会话。
 *
 * 非法/不可读目录一律跳过（宁可少删，不可错删）。
 */
export function collectKnownSessionIds(dataRoot: string): Set<string> {
  const ids = new Set<string>();
  const sessionsRoot = join(dataRoot, 'sessions');
  let partitions: string[];
  try {
    partitions = readdirSync(sessionsRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => d.name);
  } catch {
    // @ignore-catch 目录不存在 ⇒ 没有已知会话（调用方应据此拒绝删除）
    return ids;
  }
  for (const partition of partitions) {
    const partitionDir = join(sessionsRoot, partition);
    let entries: Array<{ name: string; isDirectory: () => boolean }>;
    try {
      entries = readdirSync(partitionDir, { withFileTypes: true });
    } catch {
      // @ignore-catch 单个分区不可读 ⇒ 跳过
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === '.trash') {
        // 软删除回收站：`<id>_<ts>` 在 7 天 TTL 内可恢复 ⇒ 摘要必须保留
        try {
          for (const t of readdirSync(join(partitionDir, '.trash'), {
            withFileTypes: true,
          })) {
            if (!t.isDirectory()) continue;
            const m = TRASH_NAME_RE.exec(t.name);
            if (m) ids.add(m[1]);
          }
        } catch {
          // @ignore-catch 回收站不可读 ⇒ 不放宽判定（该批会话视为不存在）
        }
        continue;
      }
      if (entry.name === 'pid') continue; // 会话锁目录，不是会话
      ids.add(entry.name);
    }
  }
  return ids;
}

export interface OrphanCostSummaryScan {
  totalSummaryRows: number;
  knownSessionIds: number;
  orphans: number;
  /** 孤儿行样本（预演展示） */
  sample: Array<{ session_id: string; total_cost_usd: number; updated_at: number }>;
}

function scanOrphans(
  db: BunDatabase,
  known: Set<string>
): OrphanCostSummaryScan {
  const rows = db
    .query(
      `SELECT session_id, total_cost_usd, updated_at FROM session_cost_summaries`
    )
    .all() as unknown as Array<{
    session_id: string;
    total_cost_usd: number;
    updated_at: number;
  }>;
  const orphans = rows.filter(
    (r) => !known.has(r.session_id) && !PROTECTED_SUMMARY_IDS.has(r.session_id)
  );
  return {
    totalSummaryRows: rows.length,
    knownSessionIds: known.size,
    orphans: orphans.length,
    sample: orphans
      .sort((a, b) => b.updated_at - a.updated_at)
      .slice(0, 5),
  };
}

export interface PruneOrphanCostSummariesResult {
  scan: OrphanCostSummaryScan;
  applied: number;
  backupDir?: string;
}

/**
 * 执行（或预演）清理。
 *
 * 防御：若 `sessions/` 完全不可读（`known.size === 0`）⇒ **拒绝删除**
 * （否则会把所有摘要当孤儿清空）。
 */
export function pruneOrphanCostSummaries(params: {
  dataRoot: string;
  dbPath?: string;
  apply: boolean;
  now?: Date;
}): PruneOrphanCostSummariesResult {
  const dbPath = params.dbPath ?? join(params.dataRoot, 'app.db');
  if (!existsSync(dbPath)) {
    throw new Error(`找不到数据库：${dbPath}`);
  }
  const known = collectKnownSessionIds(params.dataRoot);

  const db = openBunDatabase(dbPath, { readonly: !params.apply });
  try {
    const scan = scanOrphans(db, known);
    if (!params.apply || scan.orphans === 0) {
      return { scan, applied: 0 };
    }
    if (known.size === 0) {
      // 目录不可读 / 会话全被移走 ⇒ 不做"全清"这种不可逆判断
      throw new Error('sessions 目录为空或不可读，拒绝批量删除成本摘要');
    }

    const stamp = (params.now ?? new Date())
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\..*$/, '');
    const backupDir = join(
      params.dataRoot,
      'migrations',
      `orphan-cost-summaries-${stamp}`
    );
    mkdirSync(backupDir, { recursive: true });

    const rows = db
      .query(`SELECT * FROM session_cost_summaries`)
      .all() as unknown as Array<Record<string, unknown>>;
    const orphanRows = rows.filter(
      (r) =>
        !known.has(String(r.session_id)) &&
        !PROTECTED_SUMMARY_IDS.has(String(r.session_id))
    );
    writeFileSync(
      join(backupDir, 'session_cost_summaries.jsonl'),
      `${orphanRows.map((r) => JSON.stringify(r)).join('\n')}\n`,
      'utf-8'
    );

    let removed = 0;
    db.exec('BEGIN');
    try {
      const stmt = db.query(
        `DELETE FROM session_cost_summaries WHERE session_id = ?`
      );
      for (const row of orphanRows) {
        const res = stmt.run(String(row.session_id));
        removed += Number(res.changes ?? 0);
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    appendFileSync(
      join(backupDir, 'audit.jsonl'),
      `${JSON.stringify({
        ts: new Date().toISOString(),
        removed,
        totalBefore: scan.totalSummaryRows,
        knownSessionIds: known.size,
        backup: join(backupDir, 'session_cost_summaries.jsonl'),
      })}\n`,
      'utf-8'
    );
    return { scan, applied: removed, backupDir };
  } finally {
    db.close();
  }
}

/** CLI 入口（`--apply` 才删；`--root` / `--db` / `--json`） */
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

  let result: PruneOrphanCostSummariesResult;
  try {
    result = pruneOrphanCostSummaries({
      dataRoot,
      ...(arg('--db') ? { dbPath: arg('--db')! } : {}),
      apply,
    });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
  if (json) {
    console.log(JSON.stringify(result));
    return 0;
  }

  const { scan } = result;
  console.log(
    `[prune:orphan-cost-summaries] root=${dataRoot} ${apply ? 'APPLY' : '预演（只读，加 --apply 才删）'}`
  );
  console.log(
    `  摘要 ${scan.totalSummaryRows} 行；存活/可恢复会话 ${scan.knownSessionIds} 个；孤儿 ${scan.orphans} 行`
  );
  for (const row of scan.sample) {
    console.log(
      `   · ${row.session_id}  $${row.total_cost_usd.toFixed(3)}  updated=${new Date(
        row.updated_at * 1000
      ).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`
    );
  }
  if (apply) {
    console.log(
      `  已删除 ${result.applied} 行；备份 + 审计：${result.backupDir ?? '-'}`
    );
  } else if (scan.orphans > 0) {
    console.log('  预演结束（未改动任何数据）');
  }
  return 0;
}

if (import.meta.main) {
  process.exit(main());
}
