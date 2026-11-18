#!/usr/bin/env bun
/**
 * IngestFunnel shadow 周报（#1，2026-11-18）—— 只读消费
 * `<dataDir>/ingest/funnel-shadow.jsonl`（`channels/routing/ingestFunnel.ts` 落盘）。
 *
 * 用途：S1 影子期（`INGEST_FUNNEL_SHADOW=true`）用**真实流量**反推 R1 名单：
 * 高频会话 ⇒ `conversationAllowlist` 候选；高频事件类型 ⇒ `eventTypeAllowlist` 候选。
 *
 * 用法：
 *   bun run scripts/report-ingest-funnel.ts [--top 20] [--since 7] [--json] [--log <path>]
 *
 * 路径优先级：`--log` > `LIRI_DATA_DIR`/默认 `<LIRI_HOME|~/.pyapp>/data` + `ingest/funnel-shadow.jsonl`
 * （直接复用 `resolveDataDir()`，与运行时同口径）。同目录轮转产物
 * `funnel-shadow.<epoch>.jsonl` 会一并读取。
 *
 * **限制（如实标注）**：台账 sender 只存 8 位哈希 ⇒ 可看"某发送者多吵"，但**无法**
 * 还原 `senderAllowlist` 需要的原值。
 *
 * 退出码：0 = 正常（含"文件不存在/无样本"）；1 = 参数错误。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { resolveDataDir } from '../packages/infra/src/environment';
import {
  summarizeIngestFunnelShadowText,
  type IngestFunnelGroupRow,
  type IngestFunnelShadowReport,
} from '../packages/channels/src/channels/routing/ingestFunnelDigest';

export type { IngestFunnelShadowReport };

/** 活跃台账路径（与运行时 `resolveIngestFunnelShadowPath()` 同口径） */
export function resolveFunnelShadowPath(cliOverride?: string): string {
  const explicit = cliOverride?.trim();
  if (explicit) return explicit;
  return join(resolveDataDir(), 'ingest', 'funnel-shadow.jsonl');
}

/** 读取活跃台账 + 同目录轮转产物（`<base>.<epoch>.jsonl`） */
export function readFunnelShadowText(logPath: string): string {
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

function formatTime(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 16);
}

function printGroup(title: string, rows: IngestFunnelGroupRow[]): void {
  if (rows.length === 0) {
    console.log(`\n${title}：无样本`);
    return;
  }
  console.log(`\n${title}`);
  console.log('  次数  最近出现           键');
  console.log('  ----  -----------------  ------------------------------');
  for (const row of rows) {
    console.log(
      `  ${String(row.count).padStart(4)}  ${formatTime(row.lastSeen)}  ${row.key}`
    );
  }
}

function printReport(report: IngestFunnelShadowReport, logPath: string): void {
  if (report.total === 0) {
    console.log(
      `[ingest-funnel] 无样本（${logPath}）\n` +
        '（影子未开启 / 尚无入站消息：确认 INGEST_FUNNEL_SHADOW=true 且通道有流量）'
    );
    return;
  }
  console.log(`\nIngestFunnel 影子台账 —— ${logPath}`);
  console.log(
    `记录 ${report.total} 条（窗口内 ${report.windowTotal} 条）` +
      `${report.skipped > 0 ? `，跳过损坏行 ${report.skipped}` : ''}`
  );
  printGroup('按渠道', report.byChannel);
  printGroup('按决定（pass = 当前会放行）', report.byDecision);
  printGroup('drop 原因分布', report.dropReasons);
  printGroup('高频会话（conversationAllowlist 候选）', report.byConversation);
  printGroup('高频事件类型（eventTypeAllowlist 候选）', report.byEventType);
  printGroup('高频发送者哈希（仅哈希，不能直接写 senderAllowlist）', [
    ...report.bySenderHash,
  ]);
  console.log(
    '\n处置：把要**保留**的会话写入 `channels.funnel.conversationAllowlist`，' +
      '事件类型写入 `eventTypeAllowlist`；sender 级名单需另开原值采样。\n'
  );
}

interface CliOptions {
  log?: string;
  top: number;
  sinceDays?: number;
  json: boolean;
}

function parseArgs(argv: string[]): CliOptions {
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
        '用法: bun run scripts/report-ingest-funnel.ts [--top 20] [--since 7] [--json] [--log <path>]'
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
      `[ingest-funnel] ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(1);
  }

  const logPath = resolveFunnelShadowPath(opts.log);
  const report = summarizeIngestFunnelShadowText(
    readFunnelShadowText(logPath),
    {
      top: opts.top,
      ...(opts.sinceDays ? { sinceDays: opts.sinceDays } : {}),
    }
  );

  if (opts.json) {
    console.log(JSON.stringify({ logPath, ...report }, null, 2));
  } else {
    printReport(report, logPath);
  }
}

if (import.meta.main) {
  main();
}
