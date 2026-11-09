/**
 * B9（2026-11-09，设计稿 §4 指标 4）：demand / interactive 任务**收敛率取数**。
 *
 * 指标 4「不退化为空转」原先只能人工离线看样本（B4 时如实标注"无真实样本，无法取数"）。
 * 本脚本把取数变成可复现命令：读 `pdca_checkpoints`（终态检查点带 `phase` 与 `demand` 身份），
 * 按自主度分组输出终态分布与收敛率。聚合口径见 `lib/demandConvergence.ts`（纯函数，可单测）。
 *
 * 用法：
 *   bun run scripts/report-demand-convergence.ts
 *   bun run scripts/report-demand-convergence.ts --since 2026-10-01
 *   bun run scripts/report-demand-convergence.ts --json
 *   bun run scripts/report-demand-convergence.ts --db <path-to-app.db>
 */
import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { resolveDbPath } from '@openliri/infra/environment';
import { formatSummary, summarizeCheckpoints } from './lib/demandConvergence';

/** 取检查点行（只读；表不存在 ⇒ 空数组，由报告如实呈现 0 样本） */
function loadCheckpointRows(
  dbPath: string,
  since?: string
): Array<{ raw: string }> {
  const db = new Database(dbPath, { readonly: true });
  try {
    const hasTable = db
      .query(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'pdca_checkpoints'"
      )
      .get();
    if (!hasTable) return [];
    const sql = since
      ? 'SELECT data FROM pdca_checkpoints WHERE updated_at >= ?'
      : 'SELECT data FROM pdca_checkpoints';
    const rows = (
      since ? db.query(sql).all(since) : db.query(sql).all()
    ) as Array<{
      data: string;
    }>;
    return rows.map((r) => ({ raw: r.data }));
  } finally {
    db.close();
  }
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(
      [
        '用法:',
        '  bun run scripts/report-demand-convergence.ts [--since YYYY-MM-DD] [--json] [--db <path>]',
        '',
        '  --since  只统计 updated_at >= 该日期的检查点（缺省=全部）',
        '  --json   输出机器可读 JSON（供趋势留存/对比）',
        '  --db     指定 app.db 路径（缺省走 resolveDbPath()）',
      ].join('\n')
    );
    return;
  }

  const dbFlag = args.indexOf('--db');
  const dbPath = dbFlag >= 0 ? (args[dbFlag + 1] ?? '') : resolveDbPath();
  const sinceFlag = args.indexOf('--since');
  const since = sinceFlag >= 0 ? args[sinceFlag + 1] : undefined;

  if (!dbPath || !existsSync(dbPath)) {
    console.error(
      `未找到数据库：${dbPath || '(空路径)'}\n` +
        '提示：可用 --db 指定 app.db，或先正常运行一次任务以生成数据。'
    );
    process.exitCode = 1;
    return;
  }

  const summary = summarizeCheckpoints(loadCheckpointRows(dbPath, since));
  if (args.includes('--json')) {
    console.log(JSON.stringify({ dbPath, since, ...summary }, null, 2));
    return;
  }
  console.log(formatSummary(summary, { dbPath, since }));
}

main();
