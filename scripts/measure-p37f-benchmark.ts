#!/usr/bin/env bun
/**
 * P3-7f 上下文治理基准度量脚本（阶段 C，2026-09-02，见
 * dev_docs/上下文分层治理方案-20260902.md §12 与 阶段C-基准执行说明-20260902.md）。
 *
 * 用法：
 *   bun run scripts/measure-p37f-benchmark.ts \
 *       --events <会话 events.jsonl 路径> \
 *       --usage-log <运行日志路径(可选，含每请求 usage)> \
 *       --rss <峰值 RSS(MB)(可选)>
 *
 * 输出三指标与 §12 判定：
 *   - 事件数：events.jsonl 行数（目标 ≤1.5K，A 阶段后）
 *   - inputTokens：usage-log 中单请求最大输入词元（目标 ≤40K，C 阶段后；
 *     采集来源为 unifiedTracker/请求日志，见执行说明 §3）
 *   - RSS 峰值：由运行期监控获得后传入（目标 ≤1.5GB，A/B/C 合力）
 */
import { existsSync, readFileSync, statSync } from 'node:fs';

function parseArgs(argv: string[]): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      out[a.slice(2)] = argv[i + 1];
      i++;
    }
  }
  return out;
}

function countEventLines(eventsPath: string): { lines: number; bytes: number } {
  if (!existsSync(eventsPath)) {
    throw new Error(`events 文件不存在: ${eventsPath}`);
  }
  const content = readFileSync(eventsPath, 'utf-8');
  const lines = content.split('\n').filter((l) => l.trim().length > 0).length;
  return { lines, bytes: statSync(eventsPath).size };
}

function maxInputTokensFromLog(logPath: string): number | null {
  if (!existsSync(logPath)) return null;
  const text = readFileSync(logPath, 'utf-8');
  let max = 0;
  for (const line of text.split('\n')) {
    for (const m of line.matchAll(/"inputTokens"\s*:\s*(\d+)/g)) {
      max = Math.max(max, Number(m[1]));
    }
    for (const m of line.matchAll(/"prompt_tokens"\s*:\s*(\d+)/g)) {
      max = Math.max(max, Number(m[1]));
    }
  }
  return max > 0 ? max : null;
}

function verdict(metric: string, value: number, cap: number): string {
  return value <= cap ? 'PASS' : 'FAIL';
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const eventsPath = args['events'];
  const usageLog = args['usage-log'];
  const rssMb = args['rss'] ? Number(args['rss']) : undefined;

  if (!eventsPath) {
    console.error(
      '用法: bun run scripts/measure-p37f-benchmark.ts --events <events.jsonl> [--usage-log <log>] [--rss <MB>]'
    );
    process.exit(1);
  }

  const { lines: eventLines, bytes } = countEventLines(eventsPath);
  const idxExists = existsSync(eventsPath.replace(/\.jsonl$/, '.idx'));
  const maxInput = usageLog ? maxInputTokensFromLog(usageLog) : null;
  const rss = rssMb;

  console.log('=== P3-7f 上下文治理基准度量 ===');
  console.log(`events: ${eventsPath}`);
  console.log(`  事件数: ${eventLines}  (判定 ≤1500 → ${verdict('events', eventLines, 1500)})`);
  console.log(`  字节数: ${bytes}`);
  console.log(`  events.idx 存在: ${idxExists}`);
  if (maxInput !== null) {
    console.log(`inputTokens 单请求最大: ${maxInput}  (判定 ≤40000 → ${verdict('input', maxInput, 40000)})`);
  } else {
    console.log('inputTokens: 未提供 usage-log（或未匹配到 inputTokens/prompt_tokens），请在运行期收集请求 usage 后传入');
  }
  if (rss !== undefined) {
    console.log(`RSS 峰值: ${rss} MB  (判定 ≤1536 MB → ${verdict('rss', rss, 1536)})`);
  } else {
    console.log('RSS: 未提供，请在任务峰值时经运行期监控记录后以 --rss <MB> 传入');
  }
}

try {
  main();
} catch (err) {
  console.error(`度量失败: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
