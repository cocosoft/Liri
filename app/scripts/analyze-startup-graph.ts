#!/usr/bin/env bun
/**
 * analyze-startup-graph.ts — **启动面静态图**分析器（静态导入图瘦身 P0/取证）
 *
 * 输入：`bun build --metafile` 产物（`meta.json`）
 * 输出：① 人类可读摘要；② `--json <path>` 写基线（供 `lint:startup-graph` 棘轮消费）
 *
 * 口径见 `startupGraphCore.ts` 头注（eager = 只走非 `dynamic-import` 边）。
 * 这是**静态分析**结论，与运行时实际求值可能存差异；与 `preLaunchOffsetMs` 同步对照，
 * 背离时以运行时数据为准（方案 §6 边界声明）。
 *
 * 用法：
 *   bun build --target=bun --external sharp --external pdfjs-dist --external yoga-layout \
 *     --metafile=<tmp>/meta.json --outdir=<tmp> src/pyapp.ts
 *   bun run scripts/analyze-startup-graph.ts <tmp>/meta.json [--json <out>] [--entry src/pyapp.ts]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { getOnDemandModuleIds } from '../../packages/kernel/src/core/LazyModuleStrategy';
import {
  bucketOf,
  buildEagerGraph,
  summarizeEager,
  toBaseline,
  type EagerSummary,
  type SizeStat,
  type StartupGraphBaseline,
  type StartupMeta,
} from './startupGraphCore';

const DEFAULT_ENTRY = 'src/pyapp.ts';
const TOP_N = 12;

/** 解析 CLI 参数（位置参数 + `--flag value`） */
function parseArgs(argv: string[]): {
  metaPath: string;
  entry: string;
  jsonOut?: string;
} {
  const positional = argv.filter((a) => !a.startsWith('--'));
  const metaPath = positional[0];
  if (!metaPath) {
    console.error(
      '用法：bun run scripts/analyze-startup-graph.ts <meta.json> [--json <out>] [--entry src/pyapp.ts]'
    );
    process.exit(1);
  }
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    metaPath,
    entry: flag('entry') ?? DEFAULT_ENTRY,
    jsonOut: flag('json'),
  };
}

/** 该目录的外部**静态**入口（按来源目录聚合） */
function upstreamOf(
  eager: ReadonlySet<string>,
  meta: StartupMeta,
  targetDir: string
): Array<{ fromDir: string; count: number }> {
  const counts = new Map<string, number>();
  for (const from of eager) {
    const info = meta.inputs[from];
    if (!info) continue;
    for (const imp of info.imports ?? []) {
      if (imp.kind === 'dynamic-import') continue;
      if (bucketOf(imp.path) !== targetDir) continue;
      const fromDir = bucketOf(from);
      if (fromDir === targetDir) continue;
      counts.set(fromDir, (counts.get(fromDir) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([fromDir, count]) => ({ fromDir, count }));
}

/** eager 中 node_modules 按包聚合（Top N） */
function packagesOf(
  eager: ReadonlySet<string>,
  meta: StartupMeta
): Array<{ name: string; bytes: number }> {
  const pkgBytes = new Map<string, number>();
  for (const path of eager) {
    const norm = path.split('\\').join('/');
    if (!norm.includes('node_modules/')) continue;
    const rest = norm.slice(
      norm.indexOf('node_modules/') + 'node_modules/'.length
    );
    const name = rest.startsWith('@')
      ? rest.split('/').slice(0, 2).join('/')
      : rest.split('/')[0];
    pkgBytes.set(
      name,
      (pkgBytes.get(name) ?? 0) + (meta.inputs[path]?.bytes ?? 0)
    );
  }
  return [...pkgBytes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_N)
    .map(([name, bytes]) => ({ name, bytes }));
}

function renderText(
  summary: EagerSummary,
  declaredOnDemand: StartupGraphBaseline['declaredOnDemandInEager'],
  packages: Array<{ name: string; bytes: number }>
): string {
  const kb = (b: number): string => `${(b / 1024).toFixed(0)}KB`;
  const mb = (b: number): string => `${(b / 1024 / 1024).toFixed(2)}MB`;
  const lines: string[] = [];

  lines.push('# 启动面静态图（eager）');
  lines.push(
    `入口 ${summary.entry} · eager 合计 ${summary.total} 文件` +
      `（app/src ${summary.app.files} / ${mb(summary.app.bytes)}，` +
      `node_modules ${summary.nodeModules.files} / ${mb(summary.nodeModules.bytes)}）`
  );
  lines.push('');
  lines.push('| 顶层目录 | 文件 | 字节 |');
  lines.push('|---|---:|---:|');
  const dirs = Object.entries(summary.byTopDir).sort(
    (a, b) => b[1].bytes - a[1].bytes
  );
  for (const [dir, stat] of dirs) {
    lines.push(`| \`${dir}\` | ${stat.files} | ${mb(stat.bytes)} |`);
  }

  const od = Object.entries(declaredOnDemand ?? {});
  if (od.length > 0) {
    lines.push('');
    lines.push('## 声明 ON_DEMAND 却仍在 eager（结构性缺陷）');
    lines.push('');
    lines.push('| 模块 | 文件 | 字节 | 上游静态入口 |');
    lines.push('|---|---:|---:|---|');
    for (const [dir, raw] of od) {
      const stat = raw as SizeStat & {
        upstream: Array<{ fromDir: string; count: number }>;
      };
      const up = stat.upstream.map((u) => `${u.fromDir}×${u.count}`).join('、');
      lines.push(`| \`${dir}\` | ${stat.files} | ${kb(stat.bytes)} | ${up} |`);
    }
  }

  lines.push('');
  lines.push(`## eager node_modules 按包 Top ${TOP_N}`);
  lines.push('');
  lines.push('| 包 | 字节 |');
  lines.push('|---|---:|');
  for (const pkg of packages) {
    lines.push(`| \`${pkg.name}\` | ${kb(pkg.bytes)} |`);
  }
  return lines.join('\n');
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const metaPath = resolve(args.metaPath);
  if (!existsSync(metaPath)) {
    console.error(`metafile 不存在: ${metaPath}`);
    process.exit(1);
  }
  const meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as StartupMeta;
  if (!meta.inputs) {
    console.error('metafile 结构异常：缺少 inputs');
    process.exit(1);
  }
  if (!meta.inputs[args.entry]) {
    console.error(
      `入口 ${args.entry} 不在 metafile 中（用 --entry 指定相对 app/ 的路径）`
    );
    process.exit(1);
  }

  const summary = summarizeEager(meta, args.entry);
  const eager = buildEagerGraph(meta, args.entry);

  // 声明 ON_DEMAND 的模块：用策略表自身判定（不在此再抄一份名单）
  const appDirs = Object.keys(summary.byTopDir).filter((d) => d !== '(root)');
  const declaredOnDemandInEager: Record<string, SizeStat & { upstream: unknown }> =
    {};
  for (const dir of [...getOnDemandModuleIds(appDirs)].sort()) {
    const stat = summary.byTopDir[dir];
    if (!stat) continue;
    declaredOnDemandInEager[dir] = {
      ...stat,
      upstream: upstreamOf(eager, meta, dir),
    };
  }

  const packages = packagesOf(eager, meta);
  console.log(renderText(summary, declaredOnDemandInEager, packages));

  if (args.jsonOut) {
    const out = resolve(args.jsonOut);
    if (!existsSync(dirname(out))) mkdirSync(dirname(out), { recursive: true });
    const baseline = toBaseline(summary, {
      declaredOnDemandInEager,
      nodeModulesByPackage: packages,
    });
    writeFileSync(out, `${JSON.stringify(baseline, null, 2)}\n`, 'utf-8');
    console.log(`\n基线已写入: ${out}`);
  }
}

main();
