/**
 * 存量脏 TAOR 检查点清理工具（A 阶段一 ③，2026-09-05）
 *
 * 背景：归属③（2026-09-05，任务私有实例不产 DB 检查点）之前，LRTO 任务私有 TAOR
 * 实例以 sessionId=taskId 落库 DB 检查点（taor_checkpoints），会被 Durable Resume
 * 当普通会话恢复（已修复）。本工具清理此类遗留脏行。
 *
 * 安全边界：
 * - 默认【只报告】：按 session_id 分组输出（kind/行数/时间窗），对 taskId 形态做
 *   【仅供参考】的启发式标注（不用于自动删除判定，见 CS02 边界说明）。
 * - 删除必须显式：`--apply --session <id>`（可重复），逐 id 幂等删除；
 *   执行时机按 20260904 方案附 A ③ 待正式评审确认，故不提供批量自动删除。
 *
 * 用法：
 *   bun scripts/cleanup-legacy-taor-checkpoints.ts                 # 只报告
 *   bun scripts/cleanup-legacy-taor-checkpoints.ts --apply --session <id>
 */
import { Database } from 'bun:sqlite';
import { homedir } from 'os';
import { join } from 'path';
import { existsSync } from 'fs';

const dbPath = process.env.LIRI_DATA_DIR
  ? join(process.env.LIRI_DATA_DIR, 'app.db')
  : join(homedir(), '.pyapp', 'data', 'app.db');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const sessionFilters: string[] = [];
for (let i = 0; i < args.length - 1; i++) {
  if (args[i] === '--session') {
    sessionFilters.push(args[i + 1] ?? '');
  }
}
const help = args.includes('--help');

if (help) {
  console.log(
    `用法:
  bun scripts/cleanup-legacy-taor-checkpoints.ts
      # 报告模式（默认）：列出 taor_checkpoints 各 session_id 分布
  bun scripts/cleanup-legacy-taor-checkpoints.ts --apply --session <id> [--session <id>...]
      # 删除指定 session_id 的全部检查点行（幂等；多次执行无副作用）`
  );
  process.exit(0);
}

if (apply && sessionFilters.length === 0) {
  console.error(
    '安全护栏：--apply 必须搭配至少一个 --session <id>（显式范围），禁止批量自动删除。'
  );
  process.exit(2);
}

if (!existsSync(dbPath)) {
  console.error('DB not found:', dbPath);
  process.exit(1);
}

const db = new Database(dbPath);
const hasTable = db
  .query(`SELECT name FROM sqlite_master WHERE type='table' AND name='taor_checkpoints'`)
  .all().length;

if (!hasTable) {
  console.log('taor_checkpoints 表不存在（无存量数据，无需清理）。');
  db.close();
  process.exit(0);
}

/** 启发式标注（仅供参考，不参与删除判定）：taskId 形态或非典型会话 id 形态 */
function advisoryFlag(sessionId: string): boolean {
  const isTypicalSessionId = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
    sessionId
  );
  if (isTypicalSessionId) return false;
  return (
    /^(pdca_|session:|task_|goal_|plan_|lrto_)/i.test(sessionId) ||
    sessionId.includes(':') ||
    sessionId.includes('@')
  );
}

interface GroupRow {
  session_id: string;
  kind: string | null;
  rows: number;
  first_at: number;
  last_at: number;
}

console.log('DB path:', dbPath);

if (apply) {
  const del = db.query(`DELETE FROM taor_checkpoints WHERE session_id = ?`);
  for (const sid of sessionFilters) {
    const before = (
      db.query(`SELECT COUNT(*) AS c FROM taor_checkpoints WHERE session_id = ?`).get(sid) as {
        c: number;
      }
    ).c;
    del.run(sid);
    console.log(
      `[deleted] session_id=${sid} rows=${before}（幂等：重复执行 0 行可删）`
    );
  }
  db.close();
  process.exit(0);
}

// ─── 报告模式 ─────────────────────────────────────────
const groups = db
  .query(
    `SELECT session_id, kind, COUNT(*) AS rows,
            MIN(created_at) AS first_at, MAX(created_at) AS last_at
     FROM taor_checkpoints
     GROUP BY session_id, kind
     ORDER BY session_id`
  )
  .all() as GroupRow[];

const totals = db
  .query(`SELECT COUNT(*) AS rows FROM taor_checkpoints`)
  .get() as { rows: number };
const goalRows = db
  .query(`SELECT COUNT(*) AS rows FROM taor_checkpoints WHERE kind = 'goal'`)
  .get() as { rows: number };

console.log(`\n=== taor_checkpoints 存量分布（总行数 ${totals.rows}，其中 goal=${goalRows.rows}）===`);
if (groups.length === 0) {
  console.log('（空）');
} else {
  const pad = (s: string, n: number) => s.padEnd(n).slice(0, n);
  console.log(
    `${pad('session_id', 48)} | ${pad('kind', 6)} | ${pad('rows', 4)} | 时间窗(本地)`
  );
  for (const g of groups) {
    const flag = advisoryFlag(g.session_id) ? '  ⚠ 疑 taskId 形态(启发式,仅供参考)' : '';
    console.log(
      `${pad(g.session_id, 48)} | ${pad(g.kind ?? 'NULL', 6)} | ${pad(String(g.rows), 4)} | ` +
        `${new Date(g.first_at).toLocaleString()} ~ ${new Date(g.last_at).toLocaleString()}${flag}`
    );
  }
}

console.log(
  `\n提示：
- 删除请显式执行：bun scripts/cleanup-legacy-taor-checkpoints.ts --apply --session <id>
- ⚠ 标注仅为启发式（taskId 形态如 pdca_/session:/task_/含冒号等），不代表判定结论；
  归属③ 前旧私有实例产出 = session_id 无对应真实会话消息的 taskId 键行，请对照确认。
- 存量 goal 键行（kind='goal'，真实会话 PDL 快路径产物）由 Durable Resume 分流跳过，
  无需也不应删除（保留 /goal 恢复依据）。
- 执行时机按 20260904 方案附 A ③ 待正式评审确认。`
);

db.close();
