#!/usr/bin/env bun
/**
 * analyze-tool-usage.ts — P0-0（「工具与命令治理方案」2026-10-30）
 *
 * **用途**：从**真实会话事件日志**统计工具使用分布，给"工具治理"提供可复核的数据，
 * 而不是按文案/印象决定删留。**非 CI 门禁**（依赖本机会话数据；无样本时如实报"无样本"）。
 *
 * 输出：
 * 1. 工具调用分布（`assistant/tool_call`，按规范名归并别名）；
 * 2. 注册但从未被调用的工具（`TOOL_NAMES` − 已调用；供"候选排序"，**不是删除依据**）；
 * 3. 单轮披露快照体积（`context/model-input` 里 `data.tools.schemas` 的最大一帧）——
 *    即"模型这一轮实际看到的工具面有多大"，与 AC-16 门禁的 default 面互为补充。
 *
 * 口径：
 * - 样本根目录：`TOOL_USAGE_LOG_ROOT` > 第 1 个参数 > `~/.pyapp/data/sessions`；
 * - 只认事件文件：活动尾 `events.jsonl` + 分片 `events.<序号>.jsonl`（A 分片布局）；
 *   `events.tail` 是不完整日志、`events.idx` 是派生物，均排除；
 * - 别名归并见 `TOOL_ALIASES`（实测：`read`/`read_file`/`read_me` 都是 `file_read` 的历史写法）。
 *
 * 用法（app 目录下）：
 *   bun run analyze:tool-usage
 *   bun run scripts/analyze-tool-usage.ts <sessionsDir>
 */

import {
  createReadStream,
  existsSync,
  readdirSync,
  statSync,
  type Dirent,
} from 'node:fs';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { TOOL_NAMES } from '../src/constants/toolNames.generated';

export const TOOL_CALL_EVENT = 'assistant/tool_call';
export const MODEL_INPUT_EVENT = 'context/model-input';

/**
 * 历史别名 → 规范 wire 名。
 *
 * 依据（实测 29 个会话）：`read` 146 / `read_file` 4 / `read_me` 1 / `read_product_file` 1 /
 * `shell` 1 / `session_lookup` 104 次 —— 别名层仍在被真实调用（旧 transcript 与模型习惯），
 * 统计必须归并，否则会误判成"另一个工具"。
 */
export const TOOL_ALIASES: Readonly<Record<string, string>> = {
  read: 'file_read',
  read_file: 'file_read',
  read_me: 'file_read',
  read_product_file: 'read_project_file',
  shell: 'bash',
  session_lookup: 'sessions',
};

/** 别名归并为规范名（无别名则原样返回） */
export function canonicalToolName(name: string): string {
  return TOOL_ALIASES[name] ?? name;
}

export interface UsageSummary {
  /** 调用总次数（已归并别名） */
  totalCalls: number;
  /** 不同工具数（规范名） */
  distinct: number;
  /** 规范名 → 次数（降序；同次数按名字升序，稳定可复现） */
  counts: Array<[string, number]>;
  /** 注册但从未被调用（按名字升序） */
  neverCalled: string[];
  /** 被调用但不在注册表（别名未覆盖的旧名 / 动态注册 / MCP） */
  notRegistered: string[];
}

/**
 * 汇总使用分布（**纯函数**，单测直接打这里）。
 *
 * @param countsByName 原始出现名 → 次数（未归并）
 * @param registered 注册清单（默认内置 `TOOL_NAMES`）
 */
export function summarizeUsage(
  countsByName: ReadonlyMap<string, number>,
  registered: readonly string[] = TOOL_NAMES
): UsageSummary {
  const merged = new Map<string, number>();
  for (const [raw, count] of countsByName) {
    const name = canonicalToolName(raw);
    merged.set(name, (merged.get(name) ?? 0) + count);
  }

  const counts = [...merged.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  );
  const registeredSet = new Set(registered);

  return {
    totalCalls: counts.reduce((sum, [, n]) => sum + n, 0),
    distinct: counts.length,
    counts,
    neverCalled: [...registeredSet].filter((n) => !merged.has(n)).sort(),
    notRegistered: [...merged.keys()].filter((n) => !registeredSet.has(n)).sort(),
  };
}

/** 单轮披露快照的字节数（`JSON.stringify` 的 UTF-8 长度，含 output_schema/aliases） */
export function schemaSnapshotBytes(schemas: readonly unknown[]): number {
  return schemas.reduce<number>(
    (sum, s) => sum + Buffer.byteLength(JSON.stringify(s), 'utf8'),
    0
  );
}

/** 默认样本根（env > 参数 > `~/.pyapp/data/sessions`） */
export function defaultRoot(argv: readonly string[] = process.argv): string {
  const envRoot = process.env.TOOL_USAGE_LOG_ROOT?.trim();
  if (envRoot) return envRoot;
  const arg = argv[2]?.trim();
  if (arg) return arg;
  return join(homedir(), '.pyapp', 'data', 'sessions');
}

/**
 * A（2026-10-30）：事件文件 = 活动尾 `events.jsonl` + 分片 `events.<序号>.jsonl`。
 * `events.tail`（不完整日志）与 `events.idx`（派生物）排除。
 */
const EVENT_FILE_RE = /^events(?:\.(\d{4,}))?\.jsonl$/;

/** 目录内读序：分片升序在前，活动尾最后（与原单文件布局的"按 seq 递增"一致） */
function eventFileOrder(name: string): number {
  const segment = EVENT_FILE_RE.exec(name)?.[1];
  return segment === undefined
    ? Number.MAX_SAFE_INTEGER
    : Number.parseInt(segment, 10);
}

/** 递归收集事件文件（深度 ≤ 3：`<root>/<partition>/<session>/events*.jsonl`） */
export function collectEventLogs(root: string, depth = 0): string[] {
  if (!existsSync(root)) return [];
  let entries: Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  // 同一会话目录内：分片升序 → 尾文件（跨目录顺序不影响聚合口径）
  const out: string[] = entries
    .filter((ent) => ent.isFile() && EVENT_FILE_RE.test(ent.name))
    .map((ent) => ent.name)
    .sort((a, b) => eventFileOrder(a) - eventFileOrder(b))
    .map((name) => join(root, name));
  if (depth >= 3) return out;
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    out.push(...collectEventLogs(join(root, ent.name), depth + 1));
  }
  return out;
}

export interface ScanResult {
  files: number;
  bytes: number;
  counts: Map<string, number>;
  /** 最大的一帧工具面快照（无快照 ⇒ null） */
  schemaSnapshot: { file: string; count: number; bytes: number } | null;
}

/** 流式扫描（大日志不整文件入内存） */
export async function scanLogs(files: readonly string[]): Promise<ScanResult> {
  const counts = new Map<string, number>();
  let bytes = 0;
  let schemaSnapshot: ScanResult['schemaSnapshot'] = null;

  for (const file of files) {
    try {
      bytes += statSync(file).size;
    } catch {
      /* 统计失败不影响解析 */
    }
    const rl = createInterface({
      input: createReadStream(file, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let ev: { type?: string; data?: Record<string, unknown> };
      try {
        ev = JSON.parse(trimmed) as { type?: string; data?: Record<string, unknown> };
      } catch {
        continue;
      }
      if (ev.type === TOOL_CALL_EVENT) {
        const name = ev.data?.['name'];
        if (typeof name === 'string' && name) {
          counts.set(name, (counts.get(name) ?? 0) + 1);
        }
        continue;
      }
      if (ev.type === MODEL_INPUT_EVENT) {
        const schemas = (ev.data?.['tools'] as { schemas?: unknown } | undefined)
          ?.schemas;
        if (Array.isArray(schemas) && schemas.length > 0) {
          const size = schemaSnapshotBytes(schemas);
          if (!schemaSnapshot || schemas.length > schemaSnapshot.count) {
            schemaSnapshot = { file, count: schemas.length, bytes: size };
          }
        }
      }
    }
  }

  return { files: files.length, bytes, counts, schemaSnapshot };
}

/** 打印报告（CLI 与测试共用同一文案口径） */
export function formatReport(
  scan: ScanResult,
  summary: UsageSummary,
  topN = 20
): string[] {
  const lines: string[] = [
    `样本：${scan.files} 个 events.jsonl / ${(scan.bytes / 1024 / 1024).toFixed(1)} MB`,
    `工具调用：${summary.totalCalls} 次 · 不同工具 ${summary.distinct} 个 · 注册 ${TOOL_NAMES.length} 个`,
  ];
  if (summary.totalCalls === 0) {
    lines.push('无样本（未找到 assistant/tool_call 事件）—— 换一个会话根目录再试。');
    return lines;
  }

  lines.push(`Top ${Math.min(topN, summary.counts.length)}：`);
  for (const [name, count] of summary.counts.slice(0, topN)) {
    const pct = ((count / summary.totalCalls) * 100).toFixed(1);
    lines.push(`  ${name.padEnd(24)} ${String(count).padStart(7)}  ${pct}%`);
  }

  lines.push(
    `从未调用（${summary.neverCalled.length}/${TOOL_NAMES.length}）：` +
      (summary.neverCalled.length > 0 ? summary.neverCalled.join(', ') : '无')
  );
  if (summary.notRegistered.length > 0) {
    lines.push(
      `不在注册表（别名/动态/MCP）：${summary.notRegistered.join(', ')}`
    );
  }
  if (scan.schemaSnapshot) {
    const kb = (scan.schemaSnapshot.bytes / 1024).toFixed(1);
    lines.push(
      `最大单轮披露快照：${scan.schemaSnapshot.count} 个工具 / ${kb} KB` +
        `（${scan.schemaSnapshot.file}）`
    );
  } else {
    lines.push('最大单轮披露快照：无（日志中无 context/model-input 快照）');
  }
  lines.push(
    '说明：从未调用 ≠ 可删（媒体/办公类在编码为主的样本里天然 0 调用）；' +
      '删留须走 CD05→CD06→CD07。'
  );
  return lines;
}

if (import.meta.main) {
  const root = defaultRoot();
  const files = collectEventLogs(root);
  const scan = await scanLogs(files);
  const summary = summarizeUsage(scan.counts);
  console.log(`样本根：${root}`);
  for (const line of formatReport(scan, summary)) console.log(line);
  // lint:exit（N-16/N-49）：入口脚本必须显式退出，避免长驻句柄让命令"卡住不返回"
  process.exit(0);
}
