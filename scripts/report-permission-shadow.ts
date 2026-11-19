#!/usr/bin/env bun
/**
 * 权限 B3 影子周报（2026-11-19）—— 只读消费 `<dataDir>/permission/deny-shadow.jsonl`
 * （`packages/infra/src/permission/permissionShadow.ts` 落盘）。
 *
 * 用途：影子期（`PERMISSION_SHADOW=true`）用**真实流量**回答两个问题：
 *  ① 硬拒词表命中多少、命中哪些命令头/模式（判定是否过严或过松）；
 *  ② 配额定多少合适（`quota_hit` 的 count/limit 分布；默认不限 ⇒ 该类型为 0 属正常）。
 *
 * 用法：
 *   bun run scripts/report-permission-shadow.ts [--top 20] [--since 7] [--json] [--log <path>]
 *
 * 路径优先级：`--log` > `LIRI_DATA_DIR`/默认 `<LIRI_HOME|~/.pyapp>/data` + `permission/deny-shadow.jsonl`
 * （与运行时 `resolvePermissionShadowPath()` 同口径）；同目录轮转产物
 * `deny-shadow.<epoch>.jsonl` 会一并读取。
 *
 * **限制（如实标注）**：台账只存 8 位会话哈希与 ≤200 字符命令预览 ⇒ 无法还原完整命令；
 * 也无法直接得到"用户最终批准/拒绝"的处置（那需要审批侧联动，未实现）。
 *
 * 退出码：0 = 正常（含"文件不存在/无样本"）；1 = 参数错误。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { resolveDataDir } from '../packages/infra/src/environment';

export interface PermissionShadowLine {
  at: number;
  kind: 'hard_deny_hit' | 'quota_hit';
  mode?: string;
  toolName?: string;
  sessionHash?: string;
  commandPreview?: string;
  matchedBy?: 'head' | 'pattern';
  matched?: string;
  count?: number;
  limit?: number;
}

export interface PermissionShadowSummary {
  total: number;
  byKind: Record<string, number>;
  byDay: Array<{ day: string; count: number }>;
  topMatched: Array<{ key: string; count: number }>;
  topTools: Array<{ key: string; count: number }>;
  quotaLimits: Array<{ key: string; count: number }>;
  sessions: number;
}

/** 活跃台账路径（与运行时 `resolvePermissionShadowPath()` 同口径） */
export function resolvePermissionShadowPath(cliOverride?: string): string {
  const explicit = cliOverride?.trim();
  if (explicit) return explicit;
  return join(resolveDataDir(), 'permission', 'deny-shadow.jsonl');
}

/** 读取活跃台账 + 同目录轮转产物（`<base>.<epoch>.jsonl`） */
export function readPermissionShadowText(logPath: string): string {
  const dir = dirname(logPath);
  if (!existsSync(dir)) return '';
  const base = logPath.slice(dir.length + 1).replace(/\.jsonl$/, '');
  const parts: string[] = [];
  for (const name of readdirSync(dir)) {
    const isActive = name === `${base}.jsonl`;
    const isRotated =
      name.startsWith(`${base}.`) && name.endsWith('.jsonl') && !isActive;
    if (!isActive && !isRotated) continue;
    parts.push(readFileSync(join(dir, name), 'utf8'));
  }
  return parts.join('\n');
}

/** 解析文本 → 记录（坏行跳过；不抛错） */
export function parsePermissionShadowLines(
  text: string
): PermissionShadowLine[] {
  const out: PermissionShadowLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as PermissionShadowLine;
      if (typeof parsed?.at === 'number' && typeof parsed.kind === 'string') {
        out.push(parsed);
      }
    } catch {
      // 坏行跳过（轮转拼接 / 手工编辑都可能产生）
    }
  }
  return out;
}

function topOf(counter: Map<string, number>, top: number) {
  return [...counter.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, top)
    .map(([key, count]) => ({ key, count }));
}

/** 汇总（纯函数：便于单测） */
export function summarizePermissionShadow(
  records: readonly PermissionShadowLine[],
  opts: { now?: number; sinceDays?: number; top?: number } = {}
): PermissionShadowSummary {
  const top = opts.top ?? 20;
  const now = opts.now ?? Date.now();
  const since =
    opts.sinceDays && opts.sinceDays > 0
      ? now - opts.sinceDays * 24 * 60 * 60 * 1000
      : Number.NEGATIVE_INFINITY;
  const kept = records.filter((r) => r.at >= since);

  const byKind = new Map<string, number>();
  const byDay = new Map<string, number>();
  const matched = new Map<string, number>();
  const tools = new Map<string, number>();
  const limits = new Map<string, number>();
  const sessions = new Set<string>();

  for (const r of kept) {
    byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + 1);
    const day = new Date(r.at).toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
    if (r.toolName) tools.set(r.toolName, (tools.get(r.toolName) ?? 0) + 1);
    if (r.kind === 'hard_deny_hit' && r.matched) {
      const key = `${r.matchedBy ?? 'head'}:${r.matched}`;
      matched.set(key, (matched.get(key) ?? 0) + 1);
    }
    if (r.kind === 'quota_hit') {
      const key = `limit=${r.limit ?? 0}`;
      limits.set(key, (limits.get(key) ?? 0) + 1);
    }
    if (r.sessionHash) sessions.add(r.sessionHash);
  }

  return {
    total: kept.length,
    byKind: Object.fromEntries(byKind),
    byDay: [...byDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, count]) => ({ day, count })),
    topMatched: topOf(matched, top),
    topTools: topOf(tools, top),
    quotaLimits: topOf(limits, top),
    sessions: sessions.size,
  };
}

function render(summary: PermissionShadowSummary, sinceDays?: number): string {
  const lines: string[] = [
    `# 权限 B3 影子周报`,
    '',
    `- 窗口：${sinceDays && sinceDays > 0 ? `最近 ${sinceDays} 天` : '全部'}`,
    `- 样本：**${summary.total}** 条（会话 ${summary.sessions} 个）`,
    `- 按类型：${JSON.stringify(summary.byKind)}`,
    '',
    '## 按天',
    ...(summary.byDay.length
      ? summary.byDay.map((d) => `- ${d.day}: ${d.count}`)
      : ['- （无样本）']),
    '',
    '## 硬拒命中（Top）',
    ...(summary.topMatched.length
      ? summary.topMatched.map((m) => `- ${m.key} × ${m.count}`)
      : ['- （无命中）']),
    '',
    '## 命中工具（Top）',
    ...(summary.topTools.length
      ? summary.topTools.map((m) => `- ${m.key} × ${m.count}`)
      : ['- （无样本）']),
    '',
    '## 配额命中（按上限）',
    ...(summary.quotaLimits.length
      ? summary.quotaLimits.map((m) => `- ${m.key} × ${m.count}`)
      : ['- （无配额命中；默认不限 ⇒ 正常）']),
  ];
  return `${lines.join('\n')}\n`;
}

/** CLI 入口 */
if (import.meta.main) {
  const argv = process.argv.slice(2);
  const argOf = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const top = Number(argOf('--top') ?? 20);
  const since = Number(argOf('--since') ?? 0);
  if (!Number.isFinite(top) || top <= 0) {
    console.error('--top 必须是正整数');
    process.exit(1);
  }
  if (!Number.isFinite(since) || since < 0) {
    console.error('--since 必须是非负整数（天）');
    process.exit(1);
  }
  const file = resolvePermissionShadowPath(argOf('--log'));
  const text = readPermissionShadowText(file);
  const summary = summarizePermissionShadow(parsePermissionShadowLines(text), {
    sinceDays: since,
    top,
  });
  if (argv.includes('--json')) {
    console.log(JSON.stringify({ file, ...summary }, null, 2));
  } else {
    if (summary.total === 0) {
      console.log(`台账：${file}`);
      console.log('（无样本：文件不存在或期内无命中）');
    } else {
      console.log(render(summary, since));
    }
  }
}
