#!/usr/bin/env bun
/**
 * lint-architecture-boundaries.ts — **架构边界双规则门禁**（演进方案 W2 + W4）
 *
 * 规则一（W2 分层循环边界）：`agent/**`、`query/TAORLoop.ts`、`query/taor/**` 是 L1 循环内核，
 *   不得**运行时**依赖 L2/L3（`chat/`、`tasks/`、`workspace/`）。`import type` 放行；
 *   别名与相对路径同一口径解析，避免 `../tasks/x` 成为绕过通道。
 *
 * 规则二（W4 工具面单一事实源）：`tools/**` 的工具实现内禁止 `feature('TOOL_*')` 自审；
 *   `tools/sidecar/**` 登记豁免（判的是旁路进程生命周期，不是工具可见性）。
 *
 * 白名单：`.trae/architecture/architecture-boundaries.json`（每条必须带理由）。
 *
 * 用法：
 *   bun run lint:architecture-boundaries
 *
 * 退出码：0 = 合规；1 = 违规 / 白名单非法 / 检查器自身失败（AR-3：崩溃不得当成通过）。
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import {
  compareLoopBoundary,
  compareToolSelfChecks,
  parseImports,
  type ArchitectureBoundaries,
  type SourceFile,
} from './architectureBoundaryCore';

const APP_DIR = resolve(import.meta.dir, '..');
const SRC_DIR = join(APP_DIR, 'src');
const DEFAULT_CONFIG = resolve(
  APP_DIR,
  '../.trae/architecture/architecture-boundaries.json'
);

/** L1 循环内核的扫描入口（相对 src） */
const LOOP_ENTRIES = ['agent', 'query/TAORLoop.ts', 'query/taor'];
/** W4 扫描根（相对 src） */
const TOOL_ROOT = 'tools';

function isSourceFile(name: string): boolean {
  if (!name.endsWith('.ts')) return false;
  if (name.endsWith('.d.ts') || name.endsWith('.test.ts') || name.endsWith('.spec.ts')) {
    return false;
  }
  return true;
}

function collect(target: string, out: SourceFile[]): void {
  const full = join(SRC_DIR, target);
  if (!existsSync(full)) return;
  if (statSync(full).isFile()) {
    if (!isSourceFile(full)) return;
    out.push({
      path: relative(SRC_DIR, full).split(sep).join('/'),
      content: readFileSync(full, 'utf-8'),
    });
    return;
  }
  for (const name of readdirSync(full).sort()) {
    if (name === '__tests__' || name === 'node_modules') continue;
    collect(join(target, name).split(sep).join('/'), out);
  }
}

function loadConfig(path: string): ArchitectureBoundaries {
  if (!existsSync(path)) {
    console.error(`白名单不存在: ${path}`);
    process.exit(1);
  }
  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as ArchitectureBoundaries;
  if (
    !Array.isArray(parsed.loopBoundary?.targets) ||
    !Array.isArray(parsed.loopBoundary?.exceptions) ||
    !Array.isArray(parsed.toolSelfCheck?.exemptDirs) ||
    (parsed.toolSelfCheck?.exemptFiles !== undefined &&
      !Array.isArray(parsed.toolSelfCheck.exemptFiles))
  ) {
    throw new Error(
      '白名单结构不完整：loopBoundary.targets / exceptions、toolSelfCheck.exemptDirs（exemptFiles 若存在须为数组）'
    );
  }
  return parsed;
}

function report(title: string, violations: string[], hints: string[]): void {
  console.log(`--- ${title} ---`);
  for (const hint of hints) console.log(`ℹ️ ${hint}`);
  for (const violation of violations) console.error(`  ❌ ${violation}`);
}

function main(): number {
  const configPath = process.env['ARCHITECTURE_BOUNDARIES']
    ? resolve(APP_DIR, process.env['ARCHITECTURE_BOUNDARIES'])
    : DEFAULT_CONFIG;
  const config = loadConfig(configPath);

  const loopFiles: SourceFile[] = [];
  for (const entry of LOOP_ENTRIES) collect(entry, loopFiles);
  const loopRefs = loopFiles.flatMap((f) => parseImports(f));
  const loop = compareLoopBoundary(loopRefs, config.loopBoundary);

  const toolFiles: SourceFile[] = [];
  collect(TOOL_ROOT, toolFiles);
  const tool = compareToolSelfChecks(toolFiles, config.toolSelfCheck);

  console.log('=== 架构边界门禁（W2 分层循环 / W4 工具面） ===');
  console.log(
    `L1 文件 ${loopFiles.length} 个 · import 引用 ${loopRefs.length} 条 · 工具文件 ${toolFiles.length} 个`
  );
  report('W2 分层循环边界', loop.violations, loop.hints);
  report('W4 工具面单一事实源', tool.violations, tool.hints);

  const violations = [...loop.violations, ...tool.violations];
  if (violations.length > 0) {
    console.error(`\n❌ 共 ${violations.length} 条违规`);
    return 1;
  }
  console.log('\n✅ 合规（无未登记的跨层运行时依赖，无工具实现内自审）');
  return 0;
}

try {
  process.exit(main());
} catch (err) {
  console.error(`❌ 架构边界门禁执行失败（不视为通过）: ${String(err)}`);
  process.exit(1);
}
