#!/usr/bin/env bun
/**
 * analyze-startup-graph.ts — **启动面静态图**分析器（静态导入图瘦身 P0 取证件）
 *
 * 输入：`bun build --metafile` 产物（`meta.json`）
 * 输出：① 人类可读摘要；② `--json <path>` 写基线（供 P1 棘轮门禁消费）
 *
 * 口径（重要）：
 * - **eager 图** = 从入口出发，**只走非 `dynamic-import` 边**可达的文件集合；
 *   `dynamic-import` 目标及其整条子图**不计入**（这正是"启动时不加载"的语义）。
 * - 统计以 **metafile 的 `bytes`**（源码字节）为准，不是运行时内存。
 * - 这是**静态分析**结论，与运行时实际求值可能存差异；与 P0 的 `preLaunchOffsetMs`
 *   同步对照，背离时以运行时数据为准（方案 §6 边界声明）。
 *
 * 用法：
 *   bun build --target=bun --external sharp --external pdfjs-dist --external yoga-layout \
 *     --metafile=<tmp>/meta.json --outdir=<tmp> src/pyapp.ts
 *   bun run scripts/analyze-startup-graph.ts <tmp>/meta.json [--json <out>] [--entry src/pyapp.ts]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { getOnDemandModuleIds } from '../src/core/LazyModuleStrategy';

const DEFAULT_ENTRY = 'src/pyapp.ts';
const TOP_N = 12;

interface MetaImport {
  path: string;
  kind: string;
}

interface MetaInput {
  bytes?: number;
  imports?: MetaImport[];
}

interface MetaFile {
  inputs: Record<string, MetaInput>;
}

interface SizeStat {
  files: number;
  bytes: number;
}

interface BaselineJson {
  version: number;
  recordedAt: string;
  entry: string;
  eager: { total: number; app: SizeStat; nodeModules: SizeStat };
  byTopDir: Record<string, SizeStat>;
  declaredOnDemandInEager: Record<
    string,
    SizeStat & { upstream: Array<{ fromDir: string; count: number }> }
  >;
  nodeModulesByPackage: Array<{ name: string; bytes: number }>;
}

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

/** 从入口做 BFS，只走非动态边 */
function buildEagerGraph(meta: MetaFile, entry: string): Set<string> {
  const eager = new Set<string>([entry]);
  const queue: string[] = [entry];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    const info = meta.inputs[current];
    if (!info) continue;
    for (const imp of info.imports ?? []) {
      if (imp.kind === 'dynamic-import') continue;
      if (!meta.inputs[imp.path]) continue; // external / 未打包
      if (eager.has(imp.path)) continue;
      eager.add(imp.path);
      queue.push(imp.path);
    }
  }
  return eager;
}

/** 路径 → 归属：`src/<top>/…` ⇒ `<top>`；node_modules ⇒ `node_modules` */
function bucketOf(path: string): string {
  const norm = path.split('\\').join('/');
  if (norm.startsWith('src/')) {
    const rest = norm.slice('src/'.length);
    return rest.includes('/') ? rest.split('/')[0] : '(root)';
  }
  if (norm.includes('node_modules/')) return 'node_modules';
  return 'other';
}

/** 排序后的 [dir, size]（输出确定性） */
function sortedEntries(
  record: Record<string, SizeStat>
): Array<[string, SizeStat]> {
  return Object.entries(record).sort((a, b) => b[1].bytes - a[1].bytes);
}

function sumSize(
  eager: ReadonlySet<string>,
  meta: MetaFile,
  predicate: (path: string) => boolean
): SizeStat {
  const stat: SizeStat = { files: 0, bytes: 0 };
  for (const path of eager) {
    if (!predicate(path)) continue;
    stat.files++;
    stat.bytes += meta.inputs[path]?.bytes ?? 0;
  }
  return stat;
}

/** 该目录的外部**静态**入口：谁把它拉进 eager（按来源目录聚合 + 样例文件） */
function upstreamOf(
  eager: ReadonlySet<string>,
  meta: MetaFile,
  targetDir: string,
  samples = 3
): { upstream: Array<{ fromDir: string; count: number }>; samples: string[] } {
  const counts = new Map<string, number>();
  const files: string[] = [];
  for (const from of eager) {
    const info = meta.inputs[from];
    if (!info) continue;
    for (const imp of info.imports ?? []) {
      if (imp.kind === 'dynamic-import') continue;
      if (bucketOf(imp.path) !== targetDir) continue;
      if (bucketOf(from) === targetDir) continue;
      const fromDir = bucketOf(from);
      counts.set(fromDir, (counts.get(fromDir) ?? 0) + 1);
      if (files.length < samples) files.push(from);
    }
  }
  return {
    upstream: [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([fromDir, count]) => ({ fromDir, count })),
    samples: files,
  };
}

function renderText(baseline: BaselineJson): string {
  const kb = (b: number): string => `${(b / 1024).toFixed(0)}KB`;
  const mb = (b: number): string => `${(b / 1024 / 1024).toFixed(2)}MB`;
  const lines: string[] = [];

  lines.push('# 启动面静态图（eager）');
  lines.push(
    `入口 ${baseline.entry} · eager 合计 ${baseline.eager.total} 文件` +
      `（app/src ${baseline.eager.app.files} / ${mb(baseline.eager.app.bytes)}，` +
      `node_modules ${baseline.eager.nodeModules.files} / ${mb(baseline.eager.nodeModules.bytes)}）`
  );
  lines.push('');
  lines.push('| 顶层目录 | 文件 | 字节 |');
  lines.push('|---|---:|---:|');
  for (const [dir, stat] of sortedEntries(baseline.byTopDir)) {
    lines.push(`| \`${dir}\` | ${stat.files} | ${mb(stat.bytes)} |`);
  }

  const od = Object.entries(baseline.declaredOnDemandInEager);
  if (od.length > 0) {
    lines.push('');
    lines.push('## 声明 ON_DEMAND 却仍在 eager（结构性缺陷）');
    lines.push('');
    lines.push('| 模块 | 文件 | 字节 | 上游静态入口 |');
    lines.push('|---|---:|---:|---|');
    for (const [dir, stat] of od) {
      const up = stat.upstream
        .map((u) => `${u.fromDir}×${u.count}`)
        .join('、');
      lines.push(`| \`${dir}\` | ${stat.files} | ${kb(stat.bytes)} | ${up} |`);
    }
  }

  lines.push('');
  lines.push(`## eager node_modules 按包 Top ${TOP_N}`);
  lines.push('');
  lines.push('| 包 | 字节 |');
  lines.push('|---|---:|');
  for (const pkg of baseline.nodeModulesByPackage) {
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
  const meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as MetaFile;
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

  const eager = buildEagerGraph(meta, args.entry);

  const byTopDir: Record<string, SizeStat> = {};
  for (const path of eager) {
    const dir = bucketOf(path);
    if (dir === 'node_modules' || dir === 'other') continue;
    const stat = byTopDir[dir] ?? { files: 0, bytes: 0 };
    stat.files++;
    stat.bytes += meta.inputs[path]?.bytes ?? 0;
    byTopDir[dir] = stat;
  }

  // 声明 ON_DEMAND 的模块：用策略表自身判定（避免在此再抄一份名单）
  const appDirs = Object.keys(byTopDir).filter((d) => d !== '(root)');
  const onDemand = new Set(getOnDemandModuleIds(appDirs));
  const declaredOnDemandInEager: BaselineJson['declaredOnDemandInEager'] = {};
  for (const dir of [...onDemand].sort()) {
    const stat = byTopDir[dir];
    if (!stat) continue; // 已正确隔离
    const { upstream } = upstreamOf(eager, meta, dir);
    declaredOnDemandInEager[dir] = { ...stat, upstream };
  }

  const pkgBytes = new Map<string, number>();
  for (const path of eager) {
    const norm = path.split('\\').join('/');
    if (!norm.includes('node_modules/')) continue;
    const rest = norm.slice(norm.indexOf('node_modules/') + 'node_modules/'.length);
    const name = rest.startsWith('@')
      ? rest.split('/').slice(0, 2).join('/')
      : rest.split('/')[0];
    pkgBytes.set(name, (pkgBytes.get(name) ?? 0) + (meta.inputs[path]?.bytes ?? 0));
  }

  const baseline: BaselineJson = {
    version: 1,
    recordedAt: new Date().toISOString(),
    entry: args.entry,
    eager: {
      total: eager.size,
      app: sumSize(eager, meta, (p) => p.startsWith('src/')),
      nodeModules: sumSize(eager, meta, (p) => p.includes('node_modules/')),
    },
    byTopDir,
    declaredOnDemandInEager,
    nodeModulesByPackage: [...pkgBytes.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_N)
      .map(([name, bytes]) => ({ name, bytes })),
  };

  console.log(renderText(baseline));

  if (args.jsonOut) {
    const out = resolve(args.jsonOut);
    if (!existsSync(dirname(out))) mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(baseline, null, 2)}\n`, 'utf-8');
    console.log(`\n基线已写入: ${out}`);
  }
}

main();
