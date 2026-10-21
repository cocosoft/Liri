#!/usr/bin/env bun
/**
 * analyze-cpu-profile.ts — **启动面 CPU 归因**分析器（静态导入图瘦身 P0 取证件）
 *
 * 输入：`bun --cpu-prof` 产出的 `.cpuprofile`
 * 输出：按文件 / 顶层目录聚合的 **self time**（含"无 JS 帧"的未归属占比）
 *
 * 为什么看"未归属"：Bun 的模块加载 / TS 转译发生在原生帧里，采样**没有 JS 帧**。
 * 若未归属占比高（本仓实测 ≈69%），说明时间花在**加载/转译**上 ⇒ 杠杆是减少启动加载的文件数，
 * 而不是优化某个业务函数（见 `dev_docs/20261020/静态导入图瘦身-方案.md` §1.4）。
 *
 * 用法：
 *   bun --cpu-prof --cpu-prof-md --cpu-prof-interval=200 \
 *     --cpu-prof-dir=<tmp> src/main.ts healthcheck
 *   bun run scripts/analyze-cpu-profile.ts <tmp>/CPU.*.cpuprofile [--top 20]
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface CallFrame {
  functionName: string;
  url?: string;
}

interface ProfileNode {
  id: number;
  callFrame: CallFrame;
}

interface CpuProfile {
  nodes: ProfileNode[];
  samples: number[];
  /** 与 samples 一一对应的微秒差（Chrome DevTools 格式） */
  timeDeltas: number[];
}

/** 一次采样归因结果 */
interface Attribution {
  /** 全部采样时长（微秒） */
  totalUs: number;
  /** 按 URL 聚合的 self time（已剔除单样本超长间隔） */
  byUrl: Map<string, number>;
  /** 从中剔除的单样本超长间隔总量（微秒） */
  cappedUs: number;
  /** 被剔除的帧（按其原始单样本 delta 降序），用于解释"原本会被误报成热点" */
  cappedFrames: Array<{ url: string; us: number }>;
  /** 单样本上限（微秒） */
  capUs: number;
}

/** 超长间隔的判据：单样本 delta 超过中位 tick 的 10 倍 */
const CAP_FACTOR = 10;
/** 上限下限：避免极小 / 空 profile 把上限压到 0 倍 */
const MIN_CAP_US = 1000;

function medianOf(values: number[]): number {
  // 非有限值（NaN/Infinity）不参与中位数：否则 median 变成 NaN/Infinity，
  // 再经 Math.max(NaN, MIN_CAP_US) = NaN 把单样本上限打成 NaN，全表皆 NaN
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return 0;
  const sorted = finite.sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function attribute(profile: CpuProfile): Attribution {
  const nodeById = new Map<number, ProfileNode>();
  for (const node of profile.nodes) nodeById.set(node.id, node);

  // 单样本上限：Bun 的采样器在**原生代码**（模块加载 / 转译）里无法打断，
  // 整段阻塞会作为一个超长 delta 记到"阻塞结束后栈顶的最后一个 JS 帧"上。
  // 实测两次误判（2026-10-21）：同一测法下"热点"先是 `core/spi/LoggerService.ts`、
  // 后来变成 `core/paths.ts`，而两者都只有 **1 个样本** 却各占 200+ms；
  // 换采样间隔（50/200/1000µs）该数字分别变成 0.1ms / 202ms / 未命中 ⇒ 不是 CPU 时间。
  // ⇒ 把超过 10× 中位 tick 的部分视为"原生阻塞"，不计入任何函数（否则每次都会报出假热点）。
  const deltas = profile.timeDeltas.filter((d) => Number.isFinite(d) && d > 0);
  const capUs = Math.max(medianOf(deltas) * CAP_FACTOR, MIN_CAP_US);

  const byUrl = new Map<string, number>();
  const cappedFrames: Array<{ url: string; us: number }> = [];
  let totalUs = 0;
  let cappedUs = 0;

  for (let i = 0; i < profile.samples.length; i++) {
    const deltaUs = profile.timeDeltas[i] ?? 0;
    // 正数过滤必须显式排除非有限值：NaN <= 0 为 false，朴素写法会把 NaN/Infinity 放进 totalUs
    if (!Number.isFinite(deltaUs) || deltaUs <= 0) continue;
    totalUs += deltaUs;

    const node = nodeById.get(profile.samples[i]);
    const url = node?.callFrame.url;
    // 无 url = 原生帧（加载 / 转译）⇒ 原样计入"未归属"，不做截断
    if (!url) continue;

    const chargeable = Math.min(deltaUs, capUs);
    if (deltaUs > capUs) {
      cappedUs += deltaUs - chargeable;
      cappedFrames.push({ url, us: deltaUs });
    }
    byUrl.set(url, (byUrl.get(url) ?? 0) + chargeable);
  }

  cappedFrames.sort((a, b) => b.us - a.us);
  return { totalUs, byUrl, cappedUs, cappedFrames, capUs };
}

function parseArgs(argv: string[]): { profilePath: string; top: number } {
  const positional = argv.filter((a) => !a.startsWith('--'));
  const profilePath = positional[0];
  if (!profilePath) {
    console.error(
      '用法：bun run scripts/analyze-cpu-profile.ts <cpuprofile> [--top 20]'
    );
    process.exit(1);
  }
  const topFlag = argv.indexOf('--top');
  const top = topFlag >= 0 ? Number(argv[topFlag + 1]) : 20;
  return { profilePath, top: Number.isFinite(top) && top > 0 ? top : 20 };
}

/** URL → 归属桶（app/src 顶层目录 / node_modules / runtime） */
function bucketOf(url: string): string {
  const norm = url
    .replace(/^file:\/\//, '')
    .split('\\')
    .join('/');
  const marker = '/app/src/';
  const idx = norm.indexOf(marker);
  if (idx >= 0) {
    const rel = norm.slice(idx + marker.length);
    return rel.includes('/')
      ? `app/src/${rel.split('/')[0]}`
      : 'app/src/(root)';
  }
  if (norm.includes('/node_modules/')) return 'node_modules';
  if (!norm.includes('/')) return 'runtime';
  return 'other';
}

/** 相对 app/src 的路径（便于阅读） */
function shortUrl(url: string): string {
  const norm = url
    .replace(/^file:\/\//, '')
    .split('\\')
    .join('/');
  const idx = norm.indexOf('/app/src/');
  return idx >= 0 ? norm.slice(idx + '/app/src/'.length) : norm;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const path = resolve(args.profilePath);
  if (!existsSync(path)) {
    console.error(`profile 不存在: ${path}`);
    process.exit(1);
  }

  const profile = JSON.parse(readFileSync(path, 'utf-8')) as CpuProfile;
  const { totalUs, byUrl, cappedUs, cappedFrames, capUs } = attribute(profile);

  let attributedUs = 0;
  const buckets = new Map<string, number>();
  for (const [url, us] of byUrl) {
    attributedUs += us;
    const bucket = bucketOf(url);
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + us);
  }

  const ms = (us: number): string => `${(us / 1000).toFixed(0)}ms`;
  // totalUs 为 0（空 profile / 无有效正样本）时避免 0/0 = NaN%
  const pct = (us: number): string =>
    totalUs > 0 ? `${((us / totalUs) * 100).toFixed(1)}%` : '0.0%';
  const nativeOnlyUs = totalUs - attributedUs - cappedUs;

  console.log(
    `采样总时长 ${ms(totalUs)}（samples=${profile.samples.length}，单样本上限 ${(capUs / 1000).toFixed(1)}ms）`
  );
  console.log(
    `未归属（无 JS 帧 = 模块加载/转译）${ms(nativeOnlyUs)} · ${pct(nativeOnlyUs)}`
  );
  if (cappedUs > 0) {
    console.log(
      `已剔除（单样本超长间隔 = 原生阻塞，原会记到栈顶 JS 帧）${ms(cappedUs)} · ${pct(cappedUs)}`
    );
    for (const frame of cappedFrames.slice(0, 3)) {
      console.log(
        `  - ${(frame.us / 1000).toFixed(1).padStart(7)}ms  ${shortUrl(frame.url)}（原本会被误报为热点）`
      );
    }
  }

  console.log('\n=== 按归属（self time）===');
  for (const [bucket, us] of [...buckets.entries()].sort(
    (a, b) => b[1] - a[1]
  )) {
    console.log(`${ms(us).padStart(8)}  ${pct(us).padStart(6)}  ${bucket}`);
  }

  const appFiles = [...byUrl.entries()]
    .filter(([url]) => bucketOf(url).startsWith('app/src/'))
    .sort((a, b) => b[1] - a[1])
    .slice(0, args.top);
  console.log(`\n=== app/src 单文件 Top ${args.top} ===`);
  for (const [url, us] of appFiles) {
    console.log(
      `${ms(us).padStart(8)}  ${pct(us).padStart(6)}  ${shortUrl(url)}`
    );
  }

  const nmFiles = [...byUrl.entries()]
    .filter(([url]) => bucketOf(url) === 'node_modules')
    .sort((a, b) => b[1] - a[1])
    .slice(0, args.top);
  console.log(`\n=== node_modules 单文件 Top ${args.top} ===`);
  for (const [url, us] of nmFiles) {
    const norm = url
      .replace(/^file:\/\//, '')
      .split('\\')
      .join('/');
    const idx = norm.indexOf('/node_modules/');
    console.log(
      `${ms(us).padStart(8)}  ${pct(us).padStart(6)}  ${idx >= 0 ? norm.slice(idx + '/node_modules/'.length) : norm}`
    );
  }
}

main();
