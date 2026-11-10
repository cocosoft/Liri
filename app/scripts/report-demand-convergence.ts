/**
 * B9（2026-11-09，设计稿 §4 指标 4）：demand / interactive 任务**收敛率取数**。
 *
 * 指标 4「不退化为空转」原先只能人工离线看样本（B4 时如实标注"无真实样本，无法取数"）。
 * 本脚本把取数变成可复现命令：读 `pdca_checkpoints`（终态检查点带 `phase` 与 `demand` 身份），
 * 按自主度分组输出终态分布与收敛率。聚合口径见 `lib/demandConvergence.ts`（纯函数，可单测）。
 *
 * 2026-11-10：补齐指标 2/3（`--log`）—— ask 次数与回执覆盖率同样从真实日志取数，
 * 口径见 `lib/demandAcceptance.ts`。
 *
 * 用法：
 *   bun run scripts/report-demand-convergence.ts
 *   bun run scripts/report-demand-convergence.ts --since 2026-10-01
 *   bun run scripts/report-demand-convergence.ts --json
 *   bun run scripts/report-demand-convergence.ts --db <path-to-app.db>
 *   bun run scripts/report-demand-convergence.ts --log <path-to-app.log>
 */
import { Database } from 'bun:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDbPath, resolveLogsDir } from '@openliri/infra/environment';
import {
  formatSummary,
  listRootTasks,
  summarizeCheckpoints,
} from './lib/demandConvergence';
import {
  filterLogLinesSince,
  formatAcceptance,
  summarizeDemandAcceptance,
} from './lib/demandAcceptance';

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
        '  bun run scripts/report-demand-convergence.ts [--since YYYY-MM-DD] [--json] [--db <path>] [--log <path>]',
        '',
        '  --since  只统计 updated_at >= 该日期的检查点与不早于该日期的日志行（缺省=全部）',
        '  --json   输出机器可读 JSON（供趋势留存/对比）',
        '  --db     指定 app.db 路径（缺省走 resolveDbPath()）',
        '  --log    指定 app.log 路径（缺省走 resolveLogsDir()/app.log；缺失时指标 2/3 报"无日志"）',
      ].join('\n')
    );
    return;
  }

  const dbFlag = args.indexOf('--db');
  const dbPath = dbFlag >= 0 ? (args[dbFlag + 1] ?? '') : resolveDbPath();
  const logFlag = args.indexOf('--log');
  const logPath =
    logFlag >= 0
      ? (args[logFlag + 1] ?? '')
      : join(resolveLogsDir(), 'app.log');
  const sinceFlag = args.indexOf('--since');
  const since = sinceFlag >= 0 ? (args[sinceFlag + 1] ?? undefined) : undefined;

  if (!dbPath || !existsSync(dbPath)) {
    console.error(
      `未找到数据库：${dbPath || '(空路径)'}\n` +
        '提示：可用 --db 指定 app.db，或先正常运行一次任务以生成数据。'
    );
    process.exitCode = 1;
    return;
  }

  const rows = loadCheckpointRows(dbPath, since);
  const summary = summarizeCheckpoints(rows);
  const logLines =
    logPath && existsSync(logPath)
      ? filterLogLinesSince(
          readFileSync(logPath, 'utf-8').split(/\r?\n/),
          since
        )
      : [];
  const acceptance = summarizeDemandAcceptance(listRootTasks(rows), logLines);

  if (args.includes('--json')) {
    console.log(
      JSON.stringify(
        { dbPath, logPath, since, ...summary, acceptance },
        null,
        2
      )
    );
    return;
  }
  console.log(formatSummary(summary, { dbPath, since }));
  console.log('');
  if (!logPath || !existsSync(logPath)) {
    console.log(
      `未找到日志：${logPath || '(空路径)'} —— 指标 2/3 无法取数（可用 --log 指定 app.log）。`
    );
    return;
  }
  console.log(formatAcceptance(acceptance, { logPath, since }));
}

main();
