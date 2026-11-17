#!/usr/bin/env bun
/**
 * 未知命令采样周报（P2-A2，2026-11-17；R5 增加 `--fail-over`）—— 只读消费
 * `unknown-commands.jsonl`（`permission/classifiers/unknownCommandSamples.ts` 落盘）。
 *
 * 用途：每日/每周看"哪些未收录命令被转成了审批"，据此**人工**补
 * `AUTO_MODE_READONLY_COMMANDS` 或规则文件（不做运行时自动放行）。
 * 评审流水线见 `.trae/docs/permission-whitelist-review.md`。
 *
 * 用法：
 *   bun run scripts/report-unknown-commands.ts [--top 20] [--since 7] [--json]
 *                                              [--log <path>] [--fail-over <N>]
 *
 * `--fail-over <N>`：窗口内**不同命令名数量** > N ⇒ 退出码 2（CI / 每日任务据此变红）。
 *
 * 路径优先级：`--log` > `PERMISSION_UNKNOWN_COMMAND_LOG` > `LIRI_HOME` 或 `~/.pyapp`
 *   + `data/permission/unknown-commands.jsonl`（与运行时 `resolvePyappHome` 同口径）。
 *   R4 起采样轮转：同目录的 `unknown-commands.<YYYY-MM>[-<epoch>].jsonl` 会一并读取。
 *
 * 退出码：0 = 正常（含"文件不存在/无样本"）；1 = 参数错误；2 = 超过 `--fail-over` 阈值。
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  readUnknownCommandLogText,
  summarizeUnknownCommandText,
  type UnknownCommandReport,
} from '../packages/infra/src/permission/classifiers/unknownCommandDigest';

export type { UnknownCommandReport };
export type { UnknownCommandSampleRow } from '../packages/infra/src/permission/classifiers/unknownCommandDigest';

/**
 * 聚合 JSONL 文本 → 按 head 分组（count 降序；同 count 按最近出现时间降序）。
 *
 * R5：实现已收敛到 infra（设置页 / 启动提示共用同一口径），此处保留同名导出。
 */
export function aggregateUnknownCommands(
  text: string,
  opts: { sinceDays?: number; top?: number; now?: number } = {}
): UnknownCommandReport {
  return summarizeUnknownCommandText(text, opts);
}

/** 读取活跃文件 + 轮转产物（R5：实现收敛到 infra，此处保留同名导出） */
export { readUnknownCommandLogText };

/** 与运行时 `resolvePyappHome` 同口径（`LIRI_HOME` 覆盖 ⇒ 否则 `~/.pyapp`） */
export function resolveSampleLogPath(cliOverride?: string): string {
  const explicit =
    cliOverride?.trim() || process.env.PERMISSION_UNKNOWN_COMMAND_LOG?.trim();
  if (explicit) return explicit;
  const home = process.env.LIRI_HOME?.trim() || join(homedir(), '.pyapp');
  return join(home, 'data', 'permission', 'unknown-commands.jsonl');
}

function formatTime(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 16);
}

function printReport(report: UnknownCommandReport, logPath: string): void {
  if (report.rows.length === 0) {
    console.log(`[unknown-commands] 无样本（${logPath}）`);
    return;
  }
  console.log(`\n未知命令采样周报 —— ${logPath}`);
  console.log(
    `样本 ${report.total} 条（窗口内 ${report.windowTotal} 条）` +
      `${report.skipped > 0 ? `，跳过损坏行 ${report.skipped}` : ''}\n`
  );
  console.log(
    '  次数  最近出现          命令名                         最近命令样例'
  );
  console.log(
    '  ----  ----------------  -----------------------------  ------------------------------'
  );
  for (const row of report.rows) {
    console.log(
      `  ${String(row.count).padStart(4)}  ${formatTime(row.lastSeen)}  ${row.head
        .padEnd(29)
        .slice(0, 29)}  ${row.latestSurface.slice(0, 60)}`
    );
  }
  console.log(
    '\n处置：评审后只改 AUTO_MODE_READONLY_COMMANDS / 规则文件（不做运行时自动放行）；' +
      '流水线见 .trae/docs/permission-whitelist-review.md\n'
  );
}

interface CliOptions {
  log?: string;
  top: number;
  sinceDays?: number;
  json: boolean;
  /** 窗口内不同命令名数量 > 该值 ⇒ 退出码 2 */
  failOver?: number;
}

export function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { top: 20, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      opts.json = true;
      continue;
    }
    if (arg === '--log') {
      opts.log = argv[++i];
      continue;
    }
    if (arg === '--top') {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n <= 0) throw new Error('--top 必须是正整数');
      opts.top = n;
      continue;
    }
    if (arg === '--since') {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n <= 0)
        throw new Error('--since 必须是正数（天）');
      opts.sinceDays = n;
      continue;
    }
    if (arg === '--fail-over') {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n < 0)
        throw new Error('--fail-over 必须是非负整数');
      opts.failOver = n;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      console.log(
        '用法: bun run scripts/report-unknown-commands.ts [--top 20] [--since 7] [--json] [--log <path>] [--fail-over <N>]'
      );
      process.exit(0);
    }
    throw new Error(`未知参数: ${arg}`);
  }
  return opts;
}

function main(): void {
  let opts: CliOptions;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(
      `[unknown-commands] ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(1);
  }

  const logPath = resolveSampleLogPath(opts.log);
  // R4：一并读取轮转产物（`<base>.<YYYY-MM>[-<epoch>].jsonl`），避免月初漏掉上月样本
  const text = readUnknownCommandLogText(logPath);
  if (!text.trim()) {
    console.log(
      `[unknown-commands] 采样文件不存在或无样本：${logPath}\n` +
        '（尚未出现"未收录命令转审批"：要么白名单已覆盖，要么还没触发采样）'
    );
    return;
  }

  const report = aggregateUnknownCommands(text, {
    sinceDays: opts.sinceDays,
    top: opts.top,
  });

  if (opts.json) {
    console.log(JSON.stringify({ logPath, ...report }, null, 2));
  } else {
    printReport(report, logPath);
  }

  // R5：阈值门禁（CI / 每日任务据此变红）；口径 = 窗口内**不同命令名**数量
  if (typeof opts.failOver === 'number') {
    const headCount = report.rows.length;
    if (headCount > opts.failOver) {
      console.error(
        `[unknown-commands] ❌ 未收录命令种类 ${headCount} > 阈值 ${opts.failOver}` +
          `（窗口 ${opts.sinceDays ?? '全量'} 天）⇒ 请评审补白名单/规则`
      );
      process.exit(2);
    }
    console.log(
      `[unknown-commands] ✅ 未收录命令种类 ${headCount} ≤ 阈值 ${opts.failOver}`
    );
  }
}

if (import.meta.main) {
  main();
}
