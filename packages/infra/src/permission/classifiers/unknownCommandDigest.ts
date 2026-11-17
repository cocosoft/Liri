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
 * 未知命令采样的**聚合与摘要**（R5，2026-11-17；治理方案 §4.2）
 *
 * 单一实现三处共用（CS01）：
 * - `scripts/report-unknown-commands.ts`（周报 CLI：`--since/--top/--fail-over`）；
 * - `GET /v1/permissions/rules`（设置页「本周 N 个未收录命令」提示 + 添加规则跳转）；
 * - 启动提示（REPL / DAEMON 非阻塞一行）。
 *
 * 口径：
 * - `headCount`：窗口内**不同命令名**数量（评审要补的是"命令种类"，不是次数）；
 * - `sampleCount`：窗口内采样条数（= 被转审批的出现次数，R4 起每 head 每次出现都落一行）；
 * - `topHeads`：按次数降序的前 N 个命令名；
 * - 无样本 / 文件不存在 ⇒ `null`（空即空，不臆造 0 值的"有数据"表象）。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { getLogger } from '@openliri/infra/monitoring';

import { resolveUnknownCommandLogPath } from './unknownCommandSamples';

const logger = getLogger('permission:unknownCommandDigest');

/** 单条采样（只取聚合需要的字段；R4 新增字段忽略） */
export interface UnknownCommandSampleRow {
  head: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
  /** 最近一次的命令原文（已去敏，供归类） */
  latestSurface: string;
}

export interface UnknownCommandReport {
  rows: UnknownCommandSampleRow[];
  /** 解析不了的行数（损坏 / 半行） */
  skipped: number;
  /** `--since` 过滤前的样本总数 */
  total: number;
  /** 窗口内的样本总数（= 各行 count 之和） */
  windowTotal: number;
}

/** 设置页 / 启动提示用的摘要 */
export interface UnknownCommandDigest {
  /** 统计窗口（天） */
  sinceDays: number;
  /** 窗口内不同命令名数量 */
  headCount: number;
  /** 窗口内采样条数（≈ 被转审批的次数） */
  sampleCount: number;
  /** 次数最多的前 N 个命令名 */
  topHeads: UnknownCommandSampleRow[];
}

/** 解析一行 JSON；非法行返回 `null`（不抛） */
function parseLine(line: string): { head: string; at: number; surface: string } | null {
  const text = line.trim();
  if (!text) return null;
  try {
    const raw = JSON.parse(text) as {
      head?: unknown;
      at?: unknown;
      surface?: unknown;
    };
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
 * @param opts.sinceDays 只看最近 N 天（缺省 ⇒ 全量）
 * @param opts.top       截断条数（缺省 ⇒ 全部）
 * @param opts.now       注入当前时间（测试用；缺省 `Date.now()`）
 */
export function summarizeUnknownCommandText(
  text: string,
  opts: { sinceDays?: number; top?: number; now?: number } = {}
): UnknownCommandReport {
  const now = opts.now ?? Date.now();
  const since =
    typeof opts.sinceDays === 'number' && opts.sinceDays > 0
      ? now - opts.sinceDays * 24 * 60 * 60 * 1000
      : undefined;

  const map = new Map<string, UnknownCommandSampleRow>();
  let skipped = 0;
  let total = 0;
  let windowTotal = 0;

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const sample = parseLine(line);
    if (!sample) {
      skipped += 1;
      continue;
    }
    total += 1;
    if (since !== undefined && sample.at < since) continue;
    windowTotal += 1;
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
    windowTotal,
  };
}

/**
 * 读取活跃文件 + 同目录下的**轮转产物**（`<base>.<YYYY-MM>[-<epoch>].jsonl`）。
 *
 * R4 起采样按 5 MB / 按月轮转；只读活跃文件会在月初漏掉上一月的样本。
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

/**
 * 从文本构建摘要（纯函数）。
 *
 * @returns 窗口内没有样本 ⇒ `null`（不是"0 个命令"的假数据）
 */
export function buildUnknownCommandDigest(
  text: string,
  opts: { sinceDays?: number; top?: number; now?: number } = {}
): UnknownCommandDigest | null {
  const report = summarizeUnknownCommandText(text, {
    ...(opts.sinceDays !== undefined ? { sinceDays: opts.sinceDays } : {}),
    ...(opts.now !== undefined ? { now: opts.now } : {}),
  });
  if (report.windowTotal === 0) return null;
  const top = typeof opts.top === 'number' && opts.top > 0 ? opts.top : 5;
  return {
    sinceDays: opts.sinceDays ?? 7,
    headCount: report.rows.length,
    sampleCount: report.windowTotal,
    topHeads: report.rows.slice(0, top),
  };
}

/**
 * 读取本地采样并生成摘要（失败只 debug ⇒ `null`，不编造"没有缺口"）。
 *
 * 路径与采样写入同源（`resolveUnknownCommandLogPath`，含 env 覆盖）。
 */
export function readUnknownCommandDigest(opts: {
  sinceDays?: number;
  top?: number;
  now?: number;
  logPath?: string;
} = {}): UnknownCommandDigest | null {
  try {
    const path = opts.logPath ?? resolveUnknownCommandLogPath();
    const text = readUnknownCommandLogText(path);
    return buildUnknownCommandDigest(text, opts);
  } catch (err) {
    // @ignore-catch — 摘要属旁路观测，读取失败不得影响设置页 / 启动
    logger.debug('未知命令采样摘要读取失败（忽略）', {
      error: String(err),
    });
    return null;
  }
}

/**
 * 启动 / 设置页提示文案（单一出口，避免 REPL / DAEMON / 前端各写一份）。
 *
 * @returns 无样本 ⇒ `null`（不提示"本周 0 个"，那是噪音）
 */
export function formatUnknownCommandNotice(
  digest: UnknownCommandDigest | null
): string | null {
  if (!digest) return null;
  const topHead = digest.topHeads[0]?.head;
  return (
    `本周 ${digest.headCount} 个未收录命令导致 ${digest.sampleCount} 次审批` +
    (topHead ? `（最多：${topHead}）` : '') +
    '；可在「设置 → 权限管理」添加 allow 规则'
  );
}
