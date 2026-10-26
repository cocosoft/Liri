#!/usr/bin/env bun
/**
 * 日志窗口分析工具（**跨轮转文件**；2026-10-26 LRO-01 升级）
 *
 * ## 为什么升级
 * 原版只读**单个** `app.log`。而运行时日志按容量轮转为 `app.log.<ISO>`（单文件 10–23MB，
 * 保留约 10 个），当前 `app.log` 常常只有几 KB —— 于是"排查时日志里什么都没有"的结论
 * 是**工具盲区**造成的假阴性（2026-10-26 长程任务排查实证：失败证据全在轮转文件里）。
 *
 * ## 用法
 *   bun run scripts/logscan.ts                          # 默认目录 + 全量
 *   bun run scripts/logscan.ts --from 04:15:00 --to 04:18:00 --grep all-tools-failed
 *   bun run scripts/logscan.ts --list-files             # 列出轮转文件 + 各自时间覆盖区间
 *   bun run scripts/logscan.ts --grep "Denied by rule" --head 20 --json
 *
 * 参数：
 *   --dir <目录>      日志目录（默认 `resolveLogsDir()`；跨平台）
 *   --file <文件>     （可选）只扫单个文件，保持旧用法
 *   --from / --to     `HH:mm:ss`（按**时刻**过滤，跨日期都命中）或 ISO 时间戳（按**绝对时间**）
 *   --grep <词>       子串匹配（`|` 或 `,` 分隔多个，OR）。**Windows 请用逗号**：
 *                     经 cmd.exe 转发时 `|` 会被当作管道元字符拒绝执行
 *   --re <正则>       正则匹配（与 --grep 同时给出时为 AND）
 *   --head N          最多输出 N 行（默认 60）
 *   --raw             原样输出 JSONL 行（便于二次处理）
 *   --json            以 JSON 数组输出命中（含 file/line/record）
 *   --list-files      只列出日志文件与时间覆盖区间，不扫内容
 *   --fail-on-empty   0 命中时退出码 1（便于脚本断言）
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { resolveLogsDir } from '@openliri/kernel/paths';

export interface LogScanOptions {
  dir: string;
  file?: string;
  /** `HH:mm:ss`（时刻窗口）或 ISO（绝对窗口） */
  from?: string;
  to?: string;
  greps: string[];
  re?: string;
  head: number;
  raw: boolean;
  json: boolean;
  listFiles: boolean;
  failOnEmpty: boolean;
}

export interface LogRecord {
  timestamp: string;
  level: string;
  module: string;
  message: string;
  meta?: string;
}

export interface LogHit {
  file: string;
  line: number;
  raw: string;
  record: LogRecord;
}

const LINE_RE =
  /"timestamp":"([^"]+)"\s*,\s*"level":"([^"]+)"\s*,\s*"module":"([^"]+)"\s*,\s*"message":"((?:[^"\\]|\\.)*)"/;

/** 参数解析（纯函数，便于测试） */
export function parseLogScanArgs(
  argv: string[],
  defaults: { dir: string }
): LogScanOptions {
  const arg = (name: string): string | undefined => {
    const i = argv.indexOf('--' + name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const flag = (name: string): boolean => argv.includes('--' + name);

  return {
    dir: arg('dir') ?? defaults.dir,
    file: arg('file'),
    from: arg('from'),
    to: arg('to'),
    greps: (arg('grep') ?? '')
      // 分隔符支持 `|` 与 `,`：Windows 上 `bun run <script>` 经 cmd.exe 转发，
      // `|` 会被当成管道元字符而**直接拒绝执行**（实测 `bun: refusing to pass argument with
      // cmd.exe special characters`）⇒ 跨平台请用逗号，POSIX 两种都行。
      .split(/[,|]/)
      .map((s) => s.trim())
      .filter(Boolean),
    re: arg('re'),
    head: arg('head') ? Number(arg('head')) : 60,
    raw: flag('raw'),
    json: flag('json'),
    listFiles: flag('list-files'),
    failOnEmpty: flag('fail-on-empty'),
  };
}

/** 解析一行 JSONL 日志；非日志行（堆栈/空行）返回 null */
export function parseLogLine(line: string): LogRecord | null {
  if (!line.trim()) return null;
  const m = line.match(LINE_RE);
  if (!m) return null;
  const metaM = line.match(/"meta":(\{.*\})\s*\}\s*$/);
  let meta = metaM?.[1];
  if (meta && meta.length > 160) meta = meta.slice(0, 160) + '…';
  return {
    timestamp: m[1],
    level: m[2],
    module: m[3],
    message: m[4].replace(/\\(.)/g, '$1'),
    meta,
  };
}

/** 时刻（HH:mm:ss 或 HH:mm）→ 归一为 `HH:mm:ss`；非法返回 undefined */
function normalizeClock(value: string): string | undefined {
  const m = value.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return undefined;
  return `${m[1]}:${m[2]}:${m[3] ?? '00'}`;
}

/**
 * 时间窗口判定。
 *
 * - 边界是 `HH:mm:ss` ⇒ 只比**时刻**（跨日期的日志也能被同一窗口覆盖，适合"复现今天的同一时段"）；
 * - 边界是 ISO      ⇒ 比**绝对时间**（字符串比较，日志本身就是 ISO-8601 UTC，可直接比）。
 */
export function inTimeWindow(
  timestamp: string,
  from: string | undefined,
  to: string | undefined
): boolean {
  const fromClock = from ? normalizeClock(from) : undefined;
  const toClock = to ? normalizeClock(to) : undefined;

  if ((from && !fromClock) || (to && !toClock)) {
    // 非时刻形式 ⇒ 按绝对时间比较（ISO 字符串可直接比较）
    const iso = timestamp;
    if (from && iso < from) return false;
    if (to && iso > to) return false;
    return true;
  }

  const clock = timestamp.slice(11, 19);
  if (fromClock && clock < fromClock) return false;
  if (toClock && clock > toClock) return false;
  return true;
}

/** 过滤词匹配：`--grep` 为 OR；`--re` 额外要求命中（AND） */
export function matchesFilters(
  line: string,
  greps: string[],
  re: RegExp | null
): boolean {
  if (greps.length > 0 && !greps.some((g) => line.includes(g))) return false;
  if (re && !re.test(line)) return false;
  return true;
}

/**
 * 列出待扫描的日志文件（**含轮转**）。
 *
 * 口径：`app.log` + `app.log.<任意后缀>`；按文件名升序（轮转名含 ISO 时间，天然按时间排列），
 * `app.log` 排最后（它是"当前"文件）。
 */
export function listLogFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const names = readdirSync(dir).filter(
    (n) => n === 'app.log' || n.startsWith('app.log.')
  );
  const rotated = names.filter((n) => n !== 'app.log').sort();
  return [...rotated, ...names.filter((n) => n === 'app.log')].map((n) =>
    join(dir, n)
  );
}

/** 扫描单个文件 */
export function scanFile(
  path: string,
  opts: Pick<LogScanOptions, 'from' | 'to' | 'greps' | 're' | 'head'>
): LogHit[] {
  const re = opts.re ? new RegExp(opts.re) : null;
  const hits: LogHit[] = [];
  const lines = readFileSync(path, 'utf-8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!matchesFilters(raw, opts.greps, re)) continue;
    const record = parseLogLine(raw);
    if (!record) continue;
    if (!inTimeWindow(record.timestamp, opts.from, opts.to)) continue;
    hits.push({ file: path, line: i + 1, raw, record });
    if (hits.length >= opts.head) break;
  }
  return hits;
}

/** 扫描多个文件（保持文件顺序；总量受 `head` 截断） */
export function scanFiles(
  files: string[],
  opts: Pick<LogScanOptions, 'from' | 'to' | 'greps' | 're' | 'head'>
): LogHit[] {
  const out: LogHit[] = [];
  for (const f of files) {
    const remain = opts.head - out.length;
    if (remain <= 0) break;
    out.push(...scanFile(f, { ...opts, head: remain }));
  }
  return out;
}

/** 文件时间覆盖区间（供 `--list-files` 与轮转策略排查） */
export function fileCoverage(path: string): {
  file: string;
  size: number;
  first?: string;
  last?: string;
} {
  const size = statSync(path).size;
  const lines = readFileSync(path, 'utf-8').split('\n');
  let first: string | undefined;
  let last: string | undefined;
  for (const line of lines) {
    const rec = parseLogLine(line);
    if (!rec) continue;
    if (!first) first = rec.timestamp;
    last = rec.timestamp;
  }
  return { file: path, size, first, last };
}

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

function main(): void {
  const opts = parseLogScanArgs(process.argv.slice(2), {
    dir: resolveLogsDir(),
  });

  const files = opts.file ? [opts.file] : listLogFiles(opts.dir);
  if (files.length === 0) {
    console.error(`未找到日志文件：dir=${opts.dir}`);
    process.exit(opts.failOnEmpty ? 1 : 0);
  }

  if (opts.listFiles) {
    console.log(`=== 日志文件覆盖区间（${files.length} 个）===`);
    for (const f of files) {
      const c = fileCoverage(f);
      console.log(
        `${baseName(f)}  ${(c.size / 1024 / 1024).toFixed(1)}MB  ${c.first ?? '?'} → ${c.last ?? '?'}`
      );
    }
    return;
  }

  const hits = scanFiles(files, opts);

  if (opts.json) {
    console.log(
      JSON.stringify(
        hits.map((h) => ({
          file: baseName(h.file),
          line: h.line,
          ...h.record,
        })),
        null,
        2
      )
    );
  } else if (opts.raw) {
    for (const h of hits)
      console.log(`[${baseName(h.file)}:${h.line}] ${h.raw}`);
  } else {
    for (const h of hits) {
      const t = h.record.timestamp.slice(11, 23);
      console.log(
        `[${baseName(h.file)}:${h.line}] ${t} [${h.record.level}] ${h.record.module}: ${h.record.message}` +
          (h.record.meta ? ` ${h.record.meta}` : '')
      );
    }
  }

  const scope = `${opts.from ?? '-'} → ${opts.to ?? '-'}`;
  console.log(
    `--- 命中 ${hits.length} 行 / 扫描 ${files.length} 个文件（窗口 ${scope}）---`
  );
  if (hits.length === 0 && opts.failOnEmpty) process.exit(1);
}

if (import.meta.main) main();
