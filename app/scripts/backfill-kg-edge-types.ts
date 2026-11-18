/**
 * backfill-kg-edge-types —— **一次性**回填 `kg_edges.edge_type` 到规范名（D8，2026-11-18）
 *
 * 背景（`.trae/specs/kg-minimal-ontology.md` §6「已知迁移注意」）：本体层只保证**新写入**被规范化，
 * 存量行的 `edge_type` 仍是历史写法（如 `works_at`），用规范名查询**召回不到**它们。
 *
 * 用法（cwd = `app/`）：
 *   bun run backfill:kg-edge-types                      # 默认 **dry-run**：只读 + 打印计划
 *   bun run backfill:kg-edge-types --db <path>          # 指定库（多租户/备份副本）
 *   bun run backfill:kg-edge-types --apply              # **执行**（需在停写窗口内）
 *
 * 口径（如实）：
 * - 规范化**复用** `normalizeRelationType`（唯一事实源，不另写映射表）；
 * - 只改 `edge_type`，**不动** `edge_id` / `from_id` / `to_id` / `updated_at`；
 * - `--apply` 在**单个事务**内执行，任一语句失败即整体回滚；
 * - 幂等：再次运行不会产生新的变更行（计划为空）。
 */
import { Database } from '@openliri/infra/external';
import { resolveTenantDbPath } from '@openliri/infra/environment';

import { normalizeRelationType } from '../src/knowledge/graph/ontology';

/** 表名（与 `KnowledgeGraph.KG_EDGES_TABLE` 同值；脚本不 import 实现类以免拉起整图初始化） */
const KG_EDGES = 'kg_edges';

/** 聚合行（`SELECT edge_type, COUNT(*) … GROUP BY`） */
export interface EdgeTypeCountRow {
  edge_type: string;
  count: number;
}

/** 一条回填计划（`from` ≠ `to` 才会出现） */
export interface EdgeTypeBackfillRow {
  from: string;
  to: string;
  count: number;
}

/**
 * 纯函数：把「现存 edge_type 分布」折算成回填计划。
 *
 * 规则：`normalizeRelationType(from)` ≠ `from` ⇒ 需要回填；按 `count` 降序（便于先看大头）。
 * 注意：多条历史写法可能收敛到同一规范名（如 `works_at` / `worksat` ⇒ `works_for`），
 * 本函数**保持逐条**列出（执行时逐条 UPDATE，语义等价且更容易审计）。
 */
export function planEdgeTypeBackfill(
  rows: readonly EdgeTypeCountRow[]
): EdgeTypeBackfillRow[] {
  const plan: EdgeTypeBackfillRow[] = [];
  for (const row of rows) {
    const to = normalizeRelationType(row.edge_type);
    if (to === row.edge_type) continue;
    plan.push({ from: row.edge_type, to, count: row.count });
  }
  return plan.sort((a, b) => b.count - a.count);
}

/**
 * 取「可安全改名」的边 id（**冲突感知**）。
 *
 * 必要性（2026-11-18 实测）：`kg_edges` 有唯一索引
 * `idx_kg_edge_unique(from_id, to_id, edge_type, COALESCE(domain,''))` ——
 * 直接把 `works_at` 改名成 `works_for` 会撞上**已存在**的同三元组规范边，
 * 整笔事务被 `UNIQUE constraint failed` 回滚。
 *
 * 口径：只改「改后不会与既有规范边重复」的行；冲突行**跳过并计数**（不删除、不改 id），
 * 由使用方按报告人工决定是否合并（删除属破坏性操作，走 `code-deletion.md` 另行裁定）。
 */
export const SQL_SELECT_UPDATABLE_EDGE_IDS = `
SELECT e.edge_id AS id, e.owner_key AS owner
  FROM kg_edges e
 WHERE e.edge_type = ?
   AND NOT EXISTS (
     SELECT 1 FROM kg_edges t
      WHERE t.from_id = e.from_id
        AND t.to_id = e.to_id
        AND t.edge_type = ?
        AND COALESCE(t.domain, '') = COALESCE(e.domain, '')
   )`;

interface CliOptions {
  apply: boolean;
  dbPath?: string;
}

function parseArgs(argv: readonly string[]): CliOptions {
  const opts: CliOptions = { apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') {
      opts.apply = true;
      continue;
    }
    if (arg === '--db') {
      opts.dbPath = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      console.log(
        '用法: bun run backfill:kg-edge-types [--apply] [--db <path>]\n' +
          '  默认 dry-run（只读）；--apply 需在停写窗口内执行（单事务，失败整体回滚）'
      );
      process.exit(0);
    }
    throw new Error(`未知参数: ${arg}`);
  }
  return opts;
}

function openDb(path: string): Promise<Database> {
  return new Promise((resolve, reject) => {
    const db = new Database(path, (err: Error | null) => {
      if (err) reject(err);
      else resolve(db);
    });
  });
}

function all(
  db: Database,
  sql: string,
  params: unknown[] = []
): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err: Error | null, rows: unknown[]) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function run(db: Database, sql: string, params: unknown[]): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function close(db: Database): Promise<void> {
  return new Promise((resolve) => {
    db.close(() => resolve());
  });
}

async function main(): Promise<void> {
  let opts: CliOptions;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(
      `[kg-backfill] ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
    return;
  }

  const dbPath = opts.dbPath?.trim() || resolveTenantDbPath();
  console.log(`[kg-backfill] 目标库：${dbPath}`);
  console.log(`[kg-backfill] 模式：${opts.apply ? 'APPLY（写）' : 'DRY-RUN（只读）'}`);

  const db = await openDb(dbPath);
  try {
    const rows = (await all(
      db,
      `SELECT edge_type, COUNT(*) AS count FROM ${KG_EDGES} GROUP BY edge_type ORDER BY count DESC`
    )) as EdgeTypeCountRow[];

    const plan = planEdgeTypeBackfill(rows);
    if (plan.length === 0) {
      console.log('[kg-backfill] ✅ 无需回填（全部 edge_type 已是规范名）');
      process.exit(0);
      return;
    }

    console.log(`[kg-backfill] 计划（${plan.length} 组）：`);
    for (const row of plan) {
      console.log(
        `  ${String(row.count).padStart(6)} 行  ${row.from} → ${row.to}`
      );
    }
    const total = plan.reduce((sum, r) => sum + r.count, 0);
    console.log(`[kg-backfill] 合计 ${total} 行`);

    if (!opts.apply) {
      console.log(
        '\n[kg-backfill] DRY-RUN：未写入。确认后在**停写窗口**内执行：\n' +
          '  bun run backfill:kg-edge-types --apply'
      );
      process.exit(0);
      return;
    }

    await run(db, 'BEGIN IMMEDIATE', []);
    let applied = 0;
    try {
      for (const row of plan) {
        // 冲突感知：只改「改后不与既有规范边重复」的行（逐组重取，故同组多别名也只会留一条）
        const ids = (await all(db, SQL_SELECT_UPDATABLE_EDGE_IDS, [
          row.from,
          row.to,
        ])) as Array<{ id: string; owner: string }>;
        for (const { id, owner } of ids) {
          await run(
            db,
            `UPDATE ${KG_EDGES} SET edge_type = ? WHERE edge_id = ? AND owner_key = ?`,
            [row.to, id, owner]
          );
          applied += 1;
        }
      }
      await run(db, 'COMMIT', []);
    } catch (error) {
      await run(db, 'ROLLBACK', []);
      throw error;
    }

    const skipped = total - applied;
    console.log(
      `[kg-backfill] ✅ 已回填 ${applied} 行（单事务提交）` +
        (skipped > 0
          ? `；跳过 ${skipped} 行 —— 目标规范边已存在（未删除、未改 id，需人工裁定是否合并）`
          : '')
    );
    process.exit(0);
  } catch (error) {
    console.error(
      `[kg-backfill] ❌ 失败（未提交任何变更）：${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  } finally {
    await close(db);
  }
}

if (import.meta.main) {
  await main();
}
