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
  /** 按 URL 聚合的 self time */
  byUrl: Map<string, number>;
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

function attribute(profile: CpuProfile): Attribution {
  const nodeById = new Map<number, ProfileNode>();
  for (const node of profile.nodes) nodeById.set(node.id, node);

  const byUrl = new Map<string, number>();
  let totalUs = 0;

  for (let i = 0; i < profile.samples.length; i++) {
    const deltaUs = profile.timeDeltas[i] ?? 0;
    if (deltaUs <= 0) continue;
    totalUs += deltaUs;

    const node = nodeById.get(profile.samples[i]);
    const url = node?.callFrame.url;
    if (!url) continue; // 原生帧（加载/转译）⇒ 记入"未归属"
    byUrl.set(url, (byUrl.get(url) ?? 0) + deltaUs);
  }
  return { totalUs, byUrl };
}

/** URL → 归属桶（app/src 顶层目录 / node_modules / runtime） */
function bucketOf(url: string): string {
  const norm = url.replace(/^file:\/\//, '').split('\\').join('/');
  const marker = '/app/src/';
  const idx = norm.indexOf(marker);
  if (idx >= 0) {
    const rel = norm.slice(idx + marker.length);
    return rel.includes('/') ? `app/src/${rel.split('/')[0]}` : 'app/src/(root)';
  }
  if (norm.includes('/node_modules/')) return 'node_modules';
  if (!norm.includes('/')) return 'runtime';
  return 'other';
}

/** 相对 app/src 的路径（便于阅读） */
function shortUrl(url: string): string {
  const norm = url.replace(/^file:\/\//, '').split('\\').join('/');
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
  const { totalUs, byUrl } = attribute(profile);

  let attributedUs = 0;
  const buckets = new Map<string, number>();
  for (const [url, us] of byUrl) {
    attributedUs += us;
    const bucket = bucketOf(url);
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + us);
  }

  const ms = (us: number): string => `${(us / 1000).toFixed(0)}ms`;
  const pct = (us: number): string => `${((us / totalUs) * 100).toFixed(1)}%`;

  console.log(`采样总时长 ${ms(totalUs)}（samples=${profile.samples.length}）`);
  console.log(
    `未归属（无 JS 帧 = 模块加载/转译）${ms(totalUs - attributedUs)} · ${pct(totalUs - attributedUs)}`
  );

  console.log('\n=== 按归属（self time）===');
  for (const [bucket, us] of [...buckets.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`${ms(us).padStart(8)}  ${pct(us).padStart(6)}  ${bucket}`);
  }

  const appFiles = [...byUrl.entries()]
    .filter(([url]) => bucketOf(url).startsWith('app/src/'))
    .sort((a, b) => b[1] - a[1])
    .slice(0, args.top);
  console.log(`\n=== app/src 单文件 Top ${args.top} ===`);
  for (const [url, us] of appFiles) {
    console.log(`${ms(us).padStart(8)}  ${pct(us).padStart(6)}  ${shortUrl(url)}`);
  }

  const nmFiles = [...byUrl.entries()]
    .filter(([url]) => bucketOf(url) === 'node_modules')
    .sort((a, b) => b[1] - a[1])
    .slice(0, args.top);
  console.log(`\n=== node_modules 单文件 Top ${args.top} ===`);
  for (const [url, us] of nmFiles) {
    const norm = url.replace(/^file:\/\//, '').split('\\').join('/');
    const idx = norm.indexOf('/node_modules/');
    console.log(
      `${ms(us).padStart(8)}  ${pct(us).padStart(6)}  ${idx >= 0 ? norm.slice(idx + '/node_modules/'.length) : norm}`
    );
  }
}

main();
