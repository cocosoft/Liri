#!/usr/bin/env bun
/**
 * lint-startup-graph.ts — **启动面静态图棘轮门禁**（静态导入图瘦身 P1）
 *
 * 做什么：现场构建一次 metafile（`write: false`，不落盘），算 eager 图规模，
 * 与基线 `.trae/architecture/startup-graph-baseline.json` 比较 —— **只允许减少**。
 *
 * 为什么用"文件数"而不是耗时：文件数是**确定性计数**（同机两次构建逐字段一致，P0 已验证），
 * 耗时受 GC / 调度 / 磁盘缓存影响，不能当门禁判据（与 `内核瘦身-方案.md` D1 同口径）。
 *
 * 基线覆盖（供测试负向自证）：
 *   - `STARTUP_GRAPH_BASELINE`：基线 JSON 路径
 *   - `STARTUP_GRAPH_METAFILE`：直接读现成 metafile，跳过构建（测试用，秒级）
 *
 * 用法：
 *   bun run lint:startup-graph            # CI：比对基线，增长即 exit 1
 *   bun run lint:startup-graph --update   # 缩小后下调基线以锁定成果
 *
 * 退出码：0 = 未增长（或已更新）；1 = 增长 / 构建失败 / 基线非法。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  compareStartupGraph,
  summarizeEager,
  toBaseline,
  type StartupGraphBaseline,
  type StartupMeta,
} from './startupGraphCore';

const APP_DIR = resolve(import.meta.dir, '..');
const DEFAULT_BASELINE = resolve(
  APP_DIR,
  '../.trae/architecture/startup-graph-baseline.json'
);
const ENTRY = 'src/pyapp.ts';
/** 与 `build:*` 脚本一致的 external（只影响是否打包依赖，不影响 app/src 静态图） */
const EXTERNALS = ['sharp', 'pdfjs-dist', 'yoga-layout'];

const argUpdate = process.argv.includes('--update');

/** Bun 全局的 `build` 在部分 bun-types 版本里未声明 ⇒ 局部收敛类型（不做全局 any） */
interface BunBuildResult {
  success: boolean;
  metafile?: unknown;
  logs?: unknown[];
}
type BunBuildFn = (options: {
  entrypoints: string[];
  target: 'bun';
  external: string[];
  metafile: true;
  write: false;
}) => Promise<BunBuildResult>;

/** 读取 metafile：优先环境变量（测试），否则现场构建（内存态，不落盘） */
async function loadMeta(): Promise<StartupMeta> {
  const override = process.env['STARTUP_GRAPH_METAFILE'];
  if (override) {
    const path = resolve(APP_DIR, override);
    if (!existsSync(path)) {
      console.error(`STARTUP_GRAPH_METAFILE 不存在: ${path}`);
      process.exit(1);
    }
    return JSON.parse(readFileSync(path, 'utf-8')) as StartupMeta;
  }

  const bunBuild = (Bun as unknown as { build?: BunBuildFn }).build;
  if (!bunBuild) {
    console.error('❌ 当前 Bun 运行时未提供 Bun.build，无法评估启动面（不视为通过）');
    process.exit(1);
  }

  // Bun.build 的路径解析以 cwd 为基准；门禁可能在仓库根/子目录被调用 ⇒ 显式切到 app/
  process.chdir(APP_DIR);
  const result = await bunBuild({
    entrypoints: [ENTRY],
    target: 'bun',
    external: EXTERNALS,
    metafile: true,
    write: false,
  });

  // 构建失败**不得**当成通过（AR-3：检查器崩溃 ≠ 通过）
  if (!result.success || !result.metafile) {
    console.error('❌ metafile 构建失败，无法评估启动面（不视为通过）');
    for (const log of result.logs ?? []) console.error(`  - ${String(log)}`);
    process.exit(1);
  }
  const raw: unknown = result.metafile;
  return typeof raw === 'string'
    ? (JSON.parse(raw) as StartupMeta)
    : (raw as StartupMeta);
}

function loadBaseline(path: string): StartupGraphBaseline {
  if (!existsSync(path)) {
    console.error(
      `基线不存在: ${path}（首次生成：bun run lint:startup-graph --update）`
    );
    process.exit(1);
  }
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as StartupGraphBaseline;
  } catch (err) {
    console.error(`基线 JSON 解析失败: ${String(err)}`);
    process.exit(1);
  }
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}

async function main(): Promise<number> {
  const baselinePath = process.env['STARTUP_GRAPH_BASELINE']
    ? resolve(APP_DIR, process.env['STARTUP_GRAPH_BASELINE'])
    : DEFAULT_BASELINE;

  const meta = await loadMeta();
  if (!meta.inputs[ENTRY]) {
    console.error(`metafile 中找不到入口 ${ENTRY}（构建配置变化？）`);
    return 1;
  }
  const summary = summarizeEager(meta, ENTRY);

  if (argUpdate) {
    // 保留分析器附加字段（declaredOnDemandInEager / nodeModulesByPackage），只更新数值
    const existing = existsSync(baselinePath)
      ? (JSON.parse(readFileSync(baselinePath, 'utf-8')) as StartupGraphBaseline)
      : undefined;
    const next = toBaseline(summary, {
      declaredOnDemandInEager: existing?.declaredOnDemandInEager,
      nodeModulesByPackage: existing?.nodeModulesByPackage,
    });
    writeFileSync(
      baselinePath,
      `${JSON.stringify(next, null, 2)}\n`,
      'utf-8'
    );
    console.log(
      `✅ 基线已更新: ${baselinePath}（eager ${summary.total} 文件）`
    );
    return 0;
  }

  const baseline = loadBaseline(baselinePath);
  const comparison = compareStartupGraph(summary, baseline);

  console.log('=== 启动面静态图棘轮（eager graph） ===');
  console.log(
    `实测 ${summary.total} 文件（app/src ${summary.app.files} / ${mb(summary.app.bytes)}；` +
      `node_modules ${summary.nodeModules.files} / ${mb(summary.nodeModules.bytes)}）` +
      ` · 基线 ${baseline.eager.total}`
  );
  console.log('----------------------------------------');

  if (comparison.problems.length > 0) {
    console.error('❌ 启动面静态图**增长**（棘轮只允许减少）：');
    for (const problem of comparison.problems) console.error(`  - ${problem}`);
    console.error(
      '（请把新增的启动期依赖改为动态导入，或先确认它必须进启动面并 --update 基线）'
    );
    return 1;
  }
  if (comparison.shrink) console.log(`ℹ️ ${comparison.shrink}`);
  console.log('✅ 未增长（启动面棘轮维持）');
  return 0;
}

process.exit(await main());
