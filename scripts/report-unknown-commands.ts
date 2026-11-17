#!/usr/bin/env bun
/**
 * 未知命令采样周报（P2-A2，2026-11-17）—— 只读消费
 * `unknown-commands.jsonl`（`permission/classifiers/unknownCommandSamples.ts` 落盘）。
 *
 * 用途：每周看"哪些未收录命令被转成了审批"，据此**人工**补
 * `AUTO_MODE_READONLY_COMMANDS` 或规则文件（不做运行时自动放行）。
 *
 * 用法：
 *   bun run scripts/report-unknown-commands.ts [--top 20] [--since 7] [--json] [--log <path>]
 *
 * 路径优先级：`--log` > `PERMISSION_UNKNOWN_COMMAND_LOG` > `LIRI_HOME` 或 `~/.pyapp`
 *   + `data/permission/unknown-commands.jsonl`（与运行时 `resolvePyappHome` 同口径）。
 *
 * 退出码：0 = 正常（含"文件不存在/无样本"）；1 = 参数错误。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

export interface UnknownCommandSample {
  head: string;
  at: number;
  surface: string;
}

export interface UnknownCommandReportRow {
  head: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
  /** 最近一次的命令原文（已截断，供归类） */
  latestSurface: string;
}

export interface UnknownCommandReport {
  rows: UnknownCommandReportRow[];
  /** 文件里解析不了的行数（损坏 / 半行） */
  skipped: number;
  /** 通过 `--since` 过滤前的样本总数 */
  total: number;
}

/** 解析一行 JSON；非法行返回 `null`（不抛） */
function parseLine(line: string): UnknownCommandSample | null {
  const text = line.trim();
  if (!text) return null;
  try {
    const raw = JSON.parse(text) as Partial<UnknownCommandSample>;
    if (typeof raw.head !== 'string' || !raw.head) return null;
    if (typeof raw.at !== 'number' || !Number.isFinite(raw.at)) return null;
    return {
      head: raw.head,
      at: raw.at,
      surface: typeof raw.surface === 'string' ? raw.surface : '',
    };
  } catch {
    return null;
  }
}

/**
 * 聚合 JSONL 文本 → 按 head 分组（count 降序；同 count 按最近出现时间降序）。
 *
 * @param text   JSONL 原文
 * @param opts.sinceDays  只看最近 N 天（缺省 ⇒ 全量）
 * @param opts.top        截断条数（缺省 ⇒ 全部）
 * @param opts.now        注入当前时间（测试用；缺省 `Date.now()`）
 */
export function aggregateUnknownCommands(
  text: string,
  opts: { sinceDays?: number; top?: number; now?: number } = {}
): UnknownCommandReport {
  const now = opts.now ?? Date.now();
  const since =
    typeof opts.sinceDays === 'number' && opts.sinceDays > 0
      ? now - opts.sinceDays * 24 * 60 * 60 * 1000
      : undefined;

  const map = new Map<string, UnknownCommandReportRow>();
  let skipped = 0;
  let total = 0;

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const sample = parseLine(line);
    if (!sample) {
      skipped += 1;
      continue;
    }
    total += 1;
    if (since !== undefined && sample.at < since) continue;
    const prev = map.get(sample.head);
    if (!prev) {
      map.set(sample.head, {
        head: sample.head,
        count: 1,
        firstSeen: sample.at,
        lastSeen: sample.at,
        latestSurface: sample.surface,
      });
      continue;
    }
    prev.count += 1;
    prev.firstSeen = Math.min(prev.firstSeen, sample.at);
    if (sample.at >= prev.lastSeen) {
      prev.lastSeen = sample.at;
      prev.latestSurface = sample.surface || prev.latestSurface;
    }
  }

  const rows = [...map.values()].sort(
    (a, b) => b.count - a.count || b.lastSeen - a.lastSeen
  );
  return {
    rows:
      typeof opts.top === 'number' && opts.top > 0
        ? rows.slice(0, opts.top)
        : rows,
    skipped,
    total,
  };
}

/** 与运行时 `resolvePyappHome` 同口径（`LIRI_HOME` 覆盖 ⇒ 否则 `~/.pyapp`） */
export function resolveSampleLogPath(cliOverride?: string): string {
  const explicit =
    cliOverride?.trim() || process.env.PERMISSION_UNKNOWN_COMMAND_LOG?.trim();
  if (explicit) return explicit;
  const home = process.env.LIRI_HOME?.trim() || join(homedir(), '.pyapp');
  return join(home, 'data', 'permission', 'unknown-commands.jsonl');
}

/**
 * 读取活跃文件 + 同目录下的**轮转产物**（`<base>.<YYYY-MM>[-<epoch>].jsonl`）。
 *
 * R4 起采样按 5 MB / 按月轮转；周报若只读活跃文件，会在月初漏掉上一月的样本。
 * 不存在的文件跳过（不报错）；目录不存在 ⇒ 只返回空串。
 */
export function readUnknownCommandLogText(logPath: string): string {
  const dir = dirname(logPath);
  const fileName = basename(logPath);
  const base = basename(logPath, '.jsonl');
  const parts: string[] = [];
  if (existsSync(logPath)) parts.push(readFileSync(logPath, 'utf8'));
  if (!existsSync(dir)) return parts.join('');
  const rotated = readdirSync(dir)
    .filter(
      (entry) =>
        entry !== fileName &&
        entry.startsWith(`${base}.`) &&
        entry.endsWith('.jsonl')
    )
    .sort();
  for (const entry of rotated) {
    parts.push(readFileSync(join(dir, entry), 'utf8'));
  }
  return parts.join('');
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
    `样本 ${report.total} 条${report.skipped > 0 ? `（跳过损坏行 ${report.skipped}）` : ''}\n`
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
    '\n处置：评审后只改 AUTO_MODE_READONLY_COMMANDS / 规则文件（不做运行时自动放行）。\n'
  );
}

interface CliOptions {
  log?: string;
  top: number;
  sinceDays?: number;
  json: boolean;
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
    if (arg === '--help' || arg === '-h') {
      console.log(
        '用法: bun run scripts/report-unknown-commands.ts [--top 20] [--since 7] [--json] [--log <path>]'
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
    return;
  }
  printReport(report, logPath);
}

if (import.meta.main) {
  main();
}
