#!/usr/bin/env bun
/**
 * lint-infra-boundary.ts — **infra 层边界契约门禁**（R1–R4）
 *
 * 依据：`.trae/specs/infra-layer-boundary-contract.md` §5 / §8 —— 把四条"建议门禁"落为可执行断言。
 * 规则实现（纯逻辑）在 `scripts/infraBoundaryCore.ts`；本文件只做模块发现、配置加载与报告。
 *
 *   R1 模块顶层禁止 I/O（AST；函数/类体内不算）
 *   R2 security / permission 不得运行时引用上层模块（审批编排留在 app）
 *   R3 infra 动态导入上层 —— 逐条白名单，清零目标（补 R00-003 盲区）
 *   R4 common / utils 同名导出 —— infra 双包只允许一份实现
 *   R5 `bun:sqlite` 只允许包装本体直连（`@modules/external` 是唯一驱动入口）
 *   R6 `packages/infra/src` 物理包边界（包内不得依赖上层 / 相对路径不得逃逸到 `app/`；
 *      app 侧 `@openliri/infra/<m>` 必须是登记为 infra 的模块，且 core 不得依赖 infra）
 *   R7 层内**环棘轮**（infra→infra 的 SCC 只许缩小；基线 `.trae/architecture/infra-cycle-baseline.json`）
 *
 * 扫描面：`scripts/modules-to-layers.json` 里 `layer === "infra"` 的模块，取其
 * `app/src/<module>/**` 下的生产 `.ts`（排除 `*.test.ts` / `*.spec.ts` / `*ModuleTest.ts` / `__tests__`）。
 * 未登记分层的顶层目录由 `lint:arch` R00-002 负责，此处不重复。
 *
 * 白名单：`.trae/architecture/infra-boundary-allowlist.json`（每条必须带理由）。
 * 退出口径：0 = 合规；1 = 违规 / 配置缺失或非法 / 扫描路径缺失（AR-3：崩溃不得当成通过）。
 *
 * 可覆盖（仅测试用）：`INFRA_REPO_ROOT` / `INFRA_LAYERS` / `INFRA_ALLOWLIST`。
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import type { SourceFile } from './architectureBoundaryCore';
import {
  compareApprovalOrchestration,
  compareCommonUtilsDuplicates,
  compareDirectSqliteImports,
  compareDynamicInfraToApp,
  compareInfraCycles,
  compareInfraPackageBoundary,
  compareTopLevelIo,
  findInfraCycleMembers,
  parseFileImports,
  type BoundaryReport,
  type InfraBoundaryAllowlist,
  type InfraCycleBaseline,
} from './infraBoundaryCore';

const APP_DIR = resolve(import.meta.dir, '..');
const REPO_ROOT = process.env['INFRA_REPO_ROOT']
  ? resolve(process.env['INFRA_REPO_ROOT'])
  : resolve(APP_DIR, '..');
const SRC_DIR = join(REPO_ROOT, 'app', 'src');
/** 2026-11-01：infra 物理包根（R6 扫描面 + 模块目录优先解析；可覆盖以便测试/负向自证） */
const PACKAGE_SRC = process.env['INFRA_PACKAGE_SRC']
  ? resolve(process.env['INFRA_PACKAGE_SRC'])
  : join(REPO_ROOT, 'packages', 'infra', 'src');
const LAYERS_FILE = process.env['INFRA_LAYERS']
  ? resolve(process.env['INFRA_LAYERS'])
  : join(REPO_ROOT, 'scripts', 'modules-to-layers.json');
const ALLOWLIST_FILE = process.env['INFRA_ALLOWLIST']
  ? resolve(process.env['INFRA_ALLOWLIST'])
  : join(REPO_ROOT, '.trae', 'architecture', 'infra-boundary-allowlist.json');
/** R7 环基线（2026-11-01；只许缩小） */
const CYCLE_BASELINE_FILE = process.env['INFRA_CYCLE_BASELINE']
  ? resolve(process.env['INFRA_CYCLE_BASELINE'])
  : join(REPO_ROOT, '.trae', 'architecture', 'infra-cycle-baseline.json');

function fail(message: string): never {
  console.error(`❌ ${message}`);
  process.exit(1);
}

/** 生产源码判定：排除测试与手工验证夹具（它们不在运行时模块求值路径上） */
function isProductionSource(name: string): boolean {
  if (!name.endsWith('.ts')) return false;
  if (name.endsWith('.d.ts')) return false;
  if (name.endsWith('.test.ts') || name.endsWith('.spec.ts')) return false;
  if (name.endsWith('ModuleTest.ts')) return false;
  return true;
}

function collect(dir: string, out: SourceFile[], base: string = SRC_DIR): void {
  for (const name of readdirSync(dir).sort()) {
    if (name === 'node_modules' || name === '__tests__' || name === 'tests')
      continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      collect(full, out, base);
      continue;
    }
    if (!isProductionSource(name)) continue;
    out.push({
      path: relative(base, full).split(sep).join('/'),
      content: readFileSync(full, 'utf-8'),
    });
  }
}

function loadLayers(): Map<string, string> {
  if (!existsSync(LAYERS_FILE)) fail(`分层事实源不存在: ${LAYERS_FILE}`);
  let raw: { modules?: Record<string, { layer?: string }> };
  try {
    raw = JSON.parse(readFileSync(LAYERS_FILE, 'utf-8')) as typeof raw;
  } catch (err) {
    fail(`分层事实源解析失败（fail-closed）: ${String(err)}`);
  }
  const map = new Map<string, string>();
  for (const [name, spec] of Object.entries(raw.modules ?? {})) {
    if (spec?.layer) map.set(name, spec.layer);
  }
  if (map.size === 0) fail('分层事实源为空（解析失败？）');
  return map;
}

function loadAllowlist(): InfraBoundaryAllowlist {
  if (!existsSync(ALLOWLIST_FILE)) {
    // 白名单缺失 ⇒ 无法核对豁免，且 R1 存在真实命中 ⇒ 必须 fail-closed
    fail(
      `白名单不存在: ${ALLOWLIST_FILE}（fail-closed；新增需带理由的四类豁免）`
    );
  }
  let parsed: Partial<InfraBoundaryAllowlist>;
  try {
    parsed = JSON.parse(readFileSync(ALLOWLIST_FILE, 'utf-8')) as typeof parsed;
  } catch (err) {
    fail(`白名单解析失败（fail-closed）: ${String(err)}`);
  }
  const sections = [
    'topLevelIo',
    'approvalOrchestration',
    'dynamicInfraToApp',
    'commonUtilsDuplicates',
    'sqliteDirectImports',
  ] as const;
  for (const key of sections) {
    if (!Array.isArray(parsed[key]))
      fail(`白名单缺少 ${key} 数组（fail-closed）`);
  }
  return {
    version: parsed.version ?? 1,
    note: parsed.note,
    topLevelIo: parsed.topLevelIo!,
    approvalOrchestration: parsed.approvalOrchestration!,
    dynamicInfraToApp: parsed.dynamicInfraToApp!,
    commonUtilsDuplicates: parsed.commonUtilsDuplicates!,
    sqliteDirectImports: parsed.sqliteDirectImports!,
  };
}

/** 从 infra 生产文件抽取 `infra → infra` 边（AST 解析；注释里的同名字样不算） */
function buildInfraEdges(
  files: readonly SourceFile[]
): Array<{ from: string; to: string }> {
  const edges: Array<{ from: string; to: string }> = [];
  for (const file of files) {
    const from = file.path.split('/')[0] ?? '';
    for (const ref of parseFileImports(file)) {
      if (!ref.specifier.startsWith('@modules/')) continue;
      const to = ref.specifier.slice('@modules/'.length).split('/')[0] ?? '';
      edges.push({ from, to });
    }
  }
  return edges;
}

function loadCycleBaseline(): InfraCycleBaseline | null {
  if (!existsSync(CYCLE_BASELINE_FILE)) return null;
  try {
    return JSON.parse(
      readFileSync(CYCLE_BASELINE_FILE, 'utf-8')
    ) as InfraCycleBaseline;
  } catch (err) {
    fail(`环基线解析失败（fail-closed）: ${String(err)}`);
  }
}

function main(): number {
  if (!existsSync(SRC_DIR)) fail(`源码根不存在: ${SRC_DIR}`);

  const layers = loadLayers();
  const allowlist = loadAllowlist();

  const infraModules = [...layers.entries()]
    .filter(([, layer]) => layer === 'infra')
    .map(([name]) => name)
    .sort();

  const infraFiles: SourceFile[] = [];
  const missing: string[] = [];
  for (const module of infraModules) {
    // 2026-11-01：模块目录优先取物理包（`packages/infra/src/<m>`），回退 `app/src/<m>`
    const inPackage = join(PACKAGE_SRC, module);
    const inApp = join(SRC_DIR, module);
    const dir = [inPackage, inApp].find(
      (d) => existsSync(d) && statSync(d).isDirectory()
    );
    if (!dir) {
      // 逻辑模块 id（无同名目录，如 `logger`）属正常；只记录不判红
      missing.push(module);
      continue;
    }
    collect(dir, infraFiles);
  }

  // R6 扫描面：infra 物理包（未建包时为空数组；app 侧的 @openliri/infra/* 仍会被 R6 检查）
  const packageFiles: SourceFile[] = [];
  if (existsSync(PACKAGE_SRC) && statSync(PACKAGE_SRC).isDirectory()) {
    // 包内文件用**包内相对路径**（R6 的相对逃逸判定以此为准，与仓库布局解耦）
    collect(PACKAGE_SRC, packageFiles, PACKAGE_SRC);
  }

  const commonFiles = infraFiles.filter((f) => f.path.startsWith('common/'));
  const utilsFiles = infraFiles.filter((f) => f.path.startsWith('utils/'));

  // R5 的扫描面是**全 src**（驱动唯一入口属于全局约束，不限 infra 目录）
  const allSrcFiles: SourceFile[] = [];
  collect(SRC_DIR, allSrcFiles);

  const reports: BoundaryReport[] = [
    compareTopLevelIo(infraFiles, allowlist),
    compareApprovalOrchestration(infraFiles, layers, allowlist),
    compareDynamicInfraToApp(infraFiles, layers, allowlist),
    compareCommonUtilsDuplicates(commonFiles, utilsFiles, allowlist),
    compareDirectSqliteImports(allSrcFiles, allowlist),
    compareInfraPackageBoundary({
      packageFiles,
      appFiles: allSrcFiles,
      layerOf: layers,
    }),
    compareInfraCycles(
      findInfraCycleMembers(buildInfraEdges(infraFiles), infraModules),
      loadCycleBaseline()
    ),
  ];

  console.log('=== infra 层边界契约门禁（R1–R7）===');
  console.log(
    `infra 模块 ${infraModules.length} 个（无目录 ${missing.length}）· 生产源文件 ${infraFiles.length} 个` +
      ` · common ${commonFiles.length} / utils ${utilsFiles.length}` +
      ` · 物理包 ${packageFiles.length} 个文件`
  );
  console.log('----------------------------------------');

  for (const report of reports) {
    console.log(
      `--- ${report.rule} ${report.title}（检查 ${report.checked} 处）---`
    );
    for (const hint of report.hints) console.log(`ℹ️ ${hint}`);
    for (const violation of report.violations)
      console.error(`  ❌ ${violation}`);
  }

  const total = reports.reduce((sum, r) => sum + r.violations.length, 0);
  if (total > 0) {
    console.error(
      `\n❌ 共 ${total} 条违规（规范见 .trae/specs/infra-layer-boundary-contract.md）`
    );
    return 1;
  }
  console.log('\n✅ 合规（R1–R7 无未登记违规）');
  return 0;
}

try {
  process.exit(main());
} catch (err) {
  console.error(`❌ infra 边界门禁执行失败（不视为通过）: ${String(err)}`);
  process.exit(1);
}
