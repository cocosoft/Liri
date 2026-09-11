/**
 * MIT License
 * Copyright (c) 2026 190615273@qq.com
 *
 * 数据迁移（O15-B，2026-09-11）：知识图谱实体 ID 统一为**裸 slug**
 *
 * 背景：历史端点 ID 存在 `prefix:slug` 形态（如 `pdca:plan`），与裸 slug 约定不一致，
 * 且同一实体可能被写成两个 ID（分裂）。O15-B 之后新写入一律裸 slug（ID 不承载 kind；
 * kind 归 `kg_nodes.kind`），本脚本负责把**存量**一次性对齐。
 *
 * 三类处置（不做猜测，规则确定）：
 *   1. 目标裸 slug **已被既有节点占用** → **合并**：复用 `KnowledgeGraph.mergeNodes()`
 *      （改指全部关系 + 同自然键去重 + 每条改动写审计 → 可逐条撤销），删除源节点；
 *      源 kind 非空而目标为空时补到目标
 *   2. 目标裸 slug **空闲** → **改名**：单事务改写 5 处引用
 *      `kg_edges.from_id/to_id`、`kg_edge_tombstones.from_id/to_id`、
 *      `kg_nodes.node_id/slug`、`kg_lineage.artifact_id(artifact_type='node')`、
 *      `kg_edge_audit.before_json/after_json` 内的 `from`/`to` 快照
 *   3. 目标裸 slug **被多个存量 ID 争抢且无既有节点**（如 `pdca:review` 与 `wi:review`
 *      都想叫 `review`）→ 全部改名，但**保留前缀作区分**（`pdca-review` / `wi-review`）：
 *      仍是裸 slug（无冒号），语义不被强行合并（用户 2026-09-11 决策）
 *
 * 安全设计：
 *   - **默认干跑**（只读 + 打印计划），必须显式 `--apply` 才写库
 *   - 写库前 WAL checkpoint 后备份到 `<app.db>.bak-o15b-<时间戳>`
 *     （回滚 = 停服后用备份覆盖 app.db 及其 -wal/-shm）
 *   - 预检失败即中止（不做"尽力而为"的静默修补）：改名目标重复/已被占用、
 *     改名后会撞 D8 唯一键、墓碑主键冲突 → 全部报出后 exit 1
 *   - 改名阶段单事务（BEGIN/COMMIT，失败 ROLLBACK）
 *   - 审计中**本次迁移自身写入的记录不改写**（历史快照保持真实）
 *
 * 用法：
 *   bun run app/scripts/migrate-graph-node-ids-o15b.ts            # 干跑
 *   bun run app/scripts/migrate-graph-node-ids-o15b.ts --apply    # 执行
 */

import { copyFileSync, existsSync } from 'fs';
import { Database } from '../src/core/external/sqlite3';
import { resolveDbPath } from '@modules/core/paths';
import {
  KnowledgeGraph,
  KG_EDGES_TABLE,
  KG_EDGE_TOMBSTONES_TABLE,
  KG_EDGE_AUDIT_TABLE,
  KG_NODES_TABLE,
} from '@modules/knowledge/graph/KnowledgeGraph';
import { KG_LINEAGE_TABLE } from '@modules/knowledge/lineage/LineageStore';

const APPLY = process.argv.includes('--apply');
/** 本次迁移开始时刻：早于此值的审计记录才允许改写（保护本次迁移写入的历史） */
const MIGRATION_STARTED_AT = Date.now();

/** 一个待处置的存量 ID */
interface PlanItem {
  /** 存量 ID（含冒号） */
  from: string;
  /** 目标裸 slug */
  to: string;
  /** merge = 目标已存在（须合并）；rename = 目标不存在（改名即可） */
  action: 'merge' | 'rename';
  /** 关联边数 */
  degree: number;
  /** 存量 kind（= 旧 splitNodeId 从 ID 前缀解出的值） */
  kind: string;
}

const dbPath = resolveDbPath();
console.log(`库路径: ${dbPath}`);
if (!existsSync(dbPath)) {
  console.error('❌ 数据库不存在，终止');
  process.exit(1);
}

const db = new Database(dbPath);

function allRows<T>(database: Database, sql: string, params: unknown[] = []) {
  return new Promise<T[]>((resolve, reject) => {
    database.all(sql, params, (err, rows) =>
      err ? reject(err) : resolve((rows ?? []) as T[])
    );
  });
}

function runSql(database: Database, sql: string, params: unknown[] = []) {
  return new Promise<void>((resolve, reject) => {
    database.run(sql, params, (err) => (err ? reject(err) : resolve()));
  });
}

const all = <T>(sql: string, params: unknown[] = []): Promise<T[]> =>
  allRows<T>(db, sql, params);

// ─── 1. 生成计划 ─────────────────────────────────────────────
const colonNodes = await all<{ node_id: string; kind: string }>(
  `SELECT node_id, kind FROM ${KG_NODES_TABLE}
    WHERE instr(node_id, ':') > 0 ORDER BY node_id`
);

const splitId = (id: string): { prefix: string; suffix: string } => {
  const at = id.indexOf(':');
  return { prefix: id.slice(0, at), suffix: id.slice(at + 1) };
};

/** 同一裸 slug 被几个存量 ID 争抢（用于规则 3） */
const suffixContenders = new Map<string, number>();
for (const node of colonNodes) {
  const { suffix } = splitId(node.node_id);
  suffixContenders.set(suffix, (suffixContenders.get(suffix) ?? 0) + 1);
}

const plan: PlanItem[] = [];
for (const node of colonNodes) {
  const { prefix, suffix } = splitId(node.node_id);
  const existing = await all<{ node_id: string }>(
    `SELECT node_id FROM ${KG_NODES_TABLE} WHERE node_id = ?`,
    [suffix]
  );
  // 规则 3：目标 slug 空闲但被多个存量 ID 争抢 → 保留前缀做区分（仍是裸 slug）
  const contested = (suffixContenders.get(suffix) ?? 0) > 1;
  const to = existing.length === 0 && contested ? `${prefix}-${suffix}` : suffix;
  const degree = await all<{ c: number }>(
    `SELECT COUNT(*) AS c FROM ${KG_EDGES_TABLE} WHERE from_id = ? OR to_id = ?`,
    [node.node_id, node.node_id]
  );
  plan.push({
    from: node.node_id,
    to,
    action: existing.length > 0 ? 'merge' : 'rename',
    degree: degree[0]?.c ?? 0,
    kind: node.kind,
  });
}

const merges = plan.filter((p) => p.action === 'merge');
const renames = plan.filter((p) => p.action === 'rename');

console.log(`\n=== 计划：${plan.length} 个含冒号实体 ID ===`);
for (const item of plan) {
  console.log(
    `  [${item.action === 'merge' ? '合并' : '改名'}] ${item.from.padEnd(34)} → ${item.to.padEnd(28)} (kind="${item.kind}", ${item.degree} 条边)`
  );
}
console.log(`  小计：合并 ${merges.length} / 改名 ${renames.length}`);

// ─── 2. 预检 ─────────────────────────────────────────────────
const problems: string[] = [];

// 2.0 改名目标必须互不重复（否则第二个 UPDATE 直接撞主键）
const targetCount = new Map<string, string[]>();
for (const item of renames) {
  targetCount.set(item.to, [...(targetCount.get(item.to) ?? []), item.from]);
}
for (const [target, sources] of targetCount) {
  if (sources.length > 1) {
    problems.push(`改名目标重复："${target}" ← ${sources.join(' / ')}`);
  }
}

for (const item of renames) {
  const collide = await all<{ c: number }>(
    `SELECT COUNT(*) AS c FROM ${KG_EDGES_TABLE} a
       JOIN ${KG_EDGES_TABLE} b
         ON a.edge_type = b.edge_type
        AND COALESCE(a.domain,'') = COALESCE(b.domain,'')
        AND ((a.from_id = ? AND b.from_id = ?) OR (a.to_id = ? AND b.to_id = ?))
        AND a.edge_id <> b.edge_id`,
    [item.from, item.to, item.from, item.to]
  );
  if ((collide[0]?.c ?? 0) > 0) {
    problems.push(
      `${item.from} → ${item.to}：改名后 ${collide[0]!.c} 组边会撞 D8 唯一键（需先人工合并）`
    );
  }

  const tomb = await all<{ c: number }>(
    `SELECT COUNT(*) AS c FROM ${KG_EDGE_TOMBSTONES_TABLE} a
       JOIN ${KG_EDGE_TOMBSTONES_TABLE} b
         ON a.edge_type = b.edge_type AND a.domain = b.domain
        AND ((a.from_id = ? AND b.from_id = ?) OR (a.to_id = ? AND b.to_id = ?))`,
    [item.from, item.to, item.from, item.to]
  );
  if ((tomb[0]?.c ?? 0) > 0) {
    problems.push(`${item.from} → ${item.to}：改名后墓碑主键冲突 ${tomb[0]!.c} 组`);
  }
}

const tombRows = await all<{ c: number }>(
  `SELECT COUNT(*) AS c FROM ${KG_EDGE_TOMBSTONES_TABLE}`
);
const auditRows = await all<{ c: number }>(
  `SELECT COUNT(*) AS c FROM ${KG_EDGE_AUDIT_TABLE}`
);
const nodeLineage = await all<{ c: number }>(
  `SELECT COUNT(*) AS c FROM ${KG_LINEAGE_TABLE} WHERE artifact_type = 'node'`
);

console.log('\n=== 影响面 ===');
console.log(
  `  边表: 涉及 ${plan.reduce((s, p) => s + p.degree, 0)} 条（含重复计数）`
);
console.log(`  墓碑总数 ${tombRows[0]?.c ?? 0}`);
console.log(`  审计记录 ${auditRows[0]?.c ?? 0} 条（历史 before/after 快照会被改写）`);
console.log(`  lineage 节点血缘 ${nodeLineage[0]?.c ?? 0} 条（改名的重指 / 合并的并入目标）`);

if (problems.length > 0) {
  console.error('\n❌ 预检未通过，未做任何写入：');
  problems.forEach((p) => console.error(`  - ${p}`));
  db.close();
  process.exit(1);
}
console.log('  ✅ 预检通过（无唯一键/主键冲突）');

if (!APPLY) {
  console.log('\n（干跑模式，未写入任何数据）改用 --apply 执行');
  db.close();
  process.exit(0);
}

// ─── 3. 备份（先 checkpoint，保证 app.db 自包含） ─────────────
await runSql(db, 'PRAGMA wal_checkpoint(TRUNCATE)');
db.close();
const backupPath = `${dbPath}.bak-o15b-${new Date()
  .toISOString()
  .replace(/[:.]/g, '-')}`;
copyFileSync(dbPath, backupPath);
for (const suffix of ['-wal', '-shm']) {
  const side = `${dbPath}${suffix}`;
  if (existsSync(side)) copyFileSync(side, `${backupPath}${suffix}`);
}
console.log(`\n=== 已备份 ===\n  ${backupPath}`);

// ─── 4. 合并（复用 mergeNodes：改指 + 去重 + 审计） ───────────
if (merges.length > 0) {
  const graph = new KnowledgeGraph(dbPath);
  await graph.init();
  for (const item of merges) {
    const source = (await graph.getNode(item.from)) as Record<string, unknown> | null;
    const target = (await graph.getNode(item.to)) as Record<string, unknown> | null;
    const result = await graph.mergeNodes(item.from, item.to);
    // 源 kind 非空、目标为空 → 迁移到目标（ID 前缀是存量 kind 的唯一来源，不丢信息）
    const sourceKind = String(source?.kind ?? '').trim();
    const targetKind = String(target?.kind ?? '').trim();
    if (!targetKind && sourceKind) {
      await graph.updateNodeArchive(item.to, { kind: sourceKind });
    }
    console.log(
      `  [合并] ${item.from} → ${item.to}：改指 ${result.repointed} / 去重 ${result.deduped}${
        !targetKind && sourceKind ? ` / kind 迁移 "${sourceKind}"` : ''
      }`
    );
  }
  await graph.close();
}

// ─── 5. 改名（单事务，5 处引用一起改） ───────────────────────
const db2 = new Database(dbPath);

/**
 * 把审计 JSON 快照内的 from/to 由旧 ID 换成新 ID
 *
 * 只处理**本次迁移之前**写入的记录（本次迁移自身产生的审计保持原样，历史才可信）；
 * 单次全表扫描 + 内存映射，避免每个 ID 扫一遍。
 */
async function remapAuditJson(idMap: Map<string, string>): Promise<number> {
  const rows = await allRows<{
    audit_id: string;
    before_json: string | null;
    after_json: string | null;
  }>(
    db2,
    `SELECT audit_id, before_json, after_json FROM ${KG_EDGE_AUDIT_TABLE} WHERE created_at < ?`,
    [MIGRATION_STARTED_AT]
  );
  let changed = 0;
  for (const row of rows) {
    const fix = (json: string | null): string | null => {
      if (!json) return json;
      const parsed = JSON.parse(json) as Record<string, unknown>;
      let touched = false;
      const fromMapped = idMap.get(String(parsed.from ?? ''));
      if (fromMapped) {
        parsed.from = fromMapped;
        touched = true;
      }
      const toMapped = idMap.get(String(parsed.to ?? ''));
      if (toMapped) {
        parsed.to = toMapped;
        touched = true;
      }
      return touched ? JSON.stringify(parsed) : json;
    };
    const before = fix(row.before_json);
    const after = fix(row.after_json);
    if (before !== row.before_json || after !== row.after_json) {
      await runSql(
        db2,
        `UPDATE ${KG_EDGE_AUDIT_TABLE} SET before_json = ?, after_json = ? WHERE audit_id = ?`,
        [before, after, row.audit_id]
      );
      changed += 1;
    }
  }
  return changed;
}

/** 把 lineage 节点血缘指到新 ID（已存在同一 (doc,node) 时丢弃多余旧行） */
async function remapLineage(from: string, to: string): Promise<number> {
  await runSql(
    db2,
    `DELETE FROM ${KG_LINEAGE_TABLE}
      WHERE artifact_type = 'node' AND artifact_id = ?
        AND doc_path IN (SELECT doc_path FROM ${KG_LINEAGE_TABLE}
                          WHERE artifact_type = 'node' AND artifact_id = ?)`,
    [from, to]
  );
  const before = await allRows<{ c: number }>(
    db2,
    `SELECT COUNT(*) AS c FROM ${KG_LINEAGE_TABLE} WHERE artifact_type = 'node' AND artifact_id = ?`,
    [from]
  );
  await runSql(
    db2,
    `UPDATE ${KG_LINEAGE_TABLE} SET artifact_id = ? WHERE artifact_type = 'node' AND artifact_id = ?`,
    [to, from]
  );
  return before[0]?.c ?? 0;
}

let auditFixed = 0;
let lineageFixed = 0;
try {
  await runSql(db2, 'BEGIN');
  for (const item of renames) {
    await runSql(db2, `UPDATE ${KG_EDGES_TABLE} SET from_id = ? WHERE from_id = ?`, [
      item.to,
      item.from,
    ]);
    await runSql(db2, `UPDATE ${KG_EDGES_TABLE} SET to_id = ? WHERE to_id = ?`, [
      item.to,
      item.from,
    ]);
    await runSql(
      db2,
      `UPDATE ${KG_EDGE_TOMBSTONES_TABLE} SET from_id = ? WHERE from_id = ?`,
      [item.to, item.from]
    );
    await runSql(
      db2,
      `UPDATE ${KG_EDGE_TOMBSTONES_TABLE} SET to_id = ? WHERE to_id = ?`,
      [item.to, item.from]
    );
    // O15-B：ID 即 slug → node_id 与 slug 同时对齐
    await runSql(
      db2,
      `UPDATE ${KG_NODES_TABLE} SET node_id = ?, slug = ? WHERE node_id = ?`,
      [item.to, item.to, item.from]
    );
    lineageFixed += await remapLineage(item.from, item.to);
    console.log(`  [改名] ${item.from} → ${item.to}`);
  }
  // 合并组的 lineage 同样需要重指（mergeNodes 只处理边）
  for (const item of merges) {
    lineageFixed += await remapLineage(item.from, item.to);
  }
  // 审计历史快照统一一次改写（含本次迁移前的所有相关记录）
  auditFixed = await remapAuditJson(new Map(plan.map((p) => [p.from, p.to])));
  await runSql(db2, 'COMMIT');
} catch (err) {
  await runSql(db2, 'ROLLBACK');
  console.error(
    '\n❌ 改名阶段失败，已回滚（若合并阶段已提交，需用备份恢复）：',
    err
  );
  db2.close();
  process.exit(1);
}

// ─── 6. 校验 ─────────────────────────────────────────────────
const left = await allRows<{ c: number }>(
  db2,
  `SELECT COUNT(*) AS c FROM ${KG_NODES_TABLE} WHERE instr(node_id, ':') > 0`
);
const nodes = await allRows<{ c: number }>(
  db2,
  `SELECT COUNT(*) AS c FROM ${KG_NODES_TABLE}`
);
const edges = await allRows<{ c: number }>(
  db2,
  `SELECT COUNT(*) AS c FROM ${KG_EDGES_TABLE}`
);
const dangling = await allRows<{ c: number }>(
  db2,
  `SELECT COUNT(*) AS c FROM ${KG_EDGES_TABLE} e
     WHERE NOT EXISTS (SELECT 1 FROM ${KG_NODES_TABLE} n WHERE n.node_id = e.from_id)
        OR NOT EXISTS (SELECT 1 FROM ${KG_NODES_TABLE} n WHERE n.node_id = e.to_id)`
);
const slugMismatch = await allRows<{ c: number }>(
  db2,
  `SELECT COUNT(*) AS c FROM ${KG_NODES_TABLE} WHERE slug <> node_id`
);
db2.close();

console.log('\n=== 完成 ===');
console.log(`  改名 ${renames.length} 个 / 合并 ${merges.length} 个`);
console.log(`  审计快照改写 ${auditFixed} 条；lineage 重指 ${lineageFixed} 条`);
console.log(`  剩余含冒号节点: ${left[0]?.c ?? 0}`);
console.log(`  节点总数: ${nodes[0]?.c ?? 0}（合并前 2210；减少量应等于合并组数）`);
console.log(`  边总数: ${edges[0]?.c ?? 0}（合并会去掉重复关系）`);
console.log(`  悬挂边（端点无节点记录）: ${dangling[0]?.c ?? 0}`);
console.log(`  slug ≠ node_id 的节点: ${slugMismatch[0]?.c ?? 0}`);
console.log(`  备份: ${backupPath}`);

// 显式退出：监控/事件总线会留下定时器与句柄，不主动退出则进程不结束（退出码不确定）
process.exit(0);
