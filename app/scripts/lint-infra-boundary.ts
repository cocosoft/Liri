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
 *   R5 `bun:sqlite` 只允许包装本体直连（`@openliri/infra/external` 是唯一驱动入口）
 *   R6 `packages/infra/src` 物理包边界（包内不得依赖上层 / 相对路径不得逃逸到 `app/`；
 *      app 侧 `@openliri/infra/<m>` 必须是登记为 infra 的模块，且 core 不得依赖 infra）
 *   R7 层内**环棘轮**（infra→infra 的 SCC 只许缩小；基线 `.trae/architecture/infra-cycle-baseline.json`）
 *   R8 `packages/service/src` 物理包边界（判据同 R6，层为 service）
 *   R9 `packages/sandbox/src` 物理包边界（判据同 R6，层为 app）
 *   R10 `packages/channels/src` 物理包边界（判据同 R8，层为 service）
 *   R11 `packages/query/src` 物理包边界（判据同 R9，层为 app）
 *   R12 `packages/skills/src` 物理包边界（判据同 R11，层为 app）
 *   R13 `packages/tokenBudget/src` 物理包边界（判据同 R12，层为 app）
 *   R14 `packages/vfs/src` 物理包边界（判据同 R13，层为 app）
 *   R15 `packages/compaction/src` 物理包边界（判据同 R14，层为 app）
 *   R16 `packages/workspaces/src` 物理包边界（判据同 R15，层为 app）
 *   R17 `packages/docs/src` 物理包边界（判据同 R16，层为 app）
 *   R18 `packages/plugin-sdk/src` 物理包边界（判据同 R17，层为 app）
 *   R19 `packages/governance/src` 物理包边界（判据同 R18，层为 app）
 *   R20 `packages/dream/src` 物理包边界（判据同 R19，层为 app）
 *   R21 `packages/evals/src` 物理包边界（判据同 R20，层为 app）
 *   R22 `packages/proactive/src` 物理包边界（判据同 R21，层为 app）
 *   R23 `packages/project/src` 物理包边界（判据同 R22，层为 app）
 *   R24 `packages/subagent/src` 物理包边界（判据同 R23，层为 app）
 *   R25 `packages/resourceGovernor/src` 物理包边界（判据同 R24，层为 app）
 *   R26 `packages/tool/src` 物理包边界（判据同 R25，层为 app）
 *   R27 `packages/context-engine/src` 物理包边界（判据同 R26，层为 app）
 *   R28 `packages/buddy/src` 物理包边界（判据同 R27，层为 app）
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
import { dirname, join, posix, relative, resolve, sep } from 'node:path';

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
/** 2026-11-02：service 物理包根（R8 扫描面；与 R6 同判据，层不同） */
const SERVICE_PACKAGE_SRC = process.env['SERVICE_PACKAGE_SRC']
  ? resolve(process.env['SERVICE_PACKAGE_SRC'])
  : join(REPO_ROOT, 'packages', 'service', 'src');
/** service 包可依赖 service / infra / core；entry/ui/app 为倒挂 */
const SERVICE_FORBIDDEN_TARGET_LAYERS = new Set(['entry', 'ui', 'app']);
/**
 * P1（2026-11-12）：sandbox 物理包根（R9 扫描面）。
 *
 * 沙箱**层归属仍是 app**（`modules-to-layers.json`），但物理独立成包后
 * `lint:arch` 的相对路径解析只在各自根内生效（`lint-architecture.ts` 相对导入分支），
 * 因此"包内相对路径逃逸到 app/"这条必须由本门禁显式守（AR-3：不得因搬目录而失焦）。
 */
const SANDBOX_PACKAGE_SRC = process.env['SANDBOX_PACKAGE_SRC']
  ? resolve(process.env['SANDBOX_PACKAGE_SRC'])
  : join(REPO_ROOT, 'packages', 'sandbox', 'src');
/** app 层包可依赖 app / service / infra / core；entry / ui 为倒挂（R9 / R11–R19 共用） */
const APP_LAYER_PACKAGE_FORBIDDEN_TARGET_LAYERS = new Set(['entry', 'ui']);
/**
 * P1（2026-11-13）：channels 物理包根（R10 扫描面）。
 *
 * 层归属是 service（`modules-to-layers.json`），但物理独立后 `lint:arch` 的相对路径解析
 * 只在各自根内生效 ⇒ "包内相对路径逃逸到 app/" 与 "包内依赖 app 层" 必须由本门禁显式守
 * （AR-3：不得因搬目录而失焦）。
 */
const CHANNELS_PACKAGE_SRC = process.env['CHANNELS_PACKAGE_SRC']
  ? resolve(process.env['CHANNELS_PACKAGE_SRC'])
  : join(REPO_ROOT, 'packages', 'channels', 'src');
/**
 * P1（2026-11-13）：query 物理包根（R11 扫描面）。
 *
 * 层归属仍是 app（`modules-to-layers.json`），与 sandbox 同口径：物理独立后
 * `lint:arch` 只在各自根内解析相对路径 ⇒ "包内相对路径逃逸到 app/" 与
 * "包内依赖 entry / ui" 必须由本门禁显式守（AR-3：不得因搬目录而失焦）。
 */
const QUERY_PACKAGE_SRC = process.env['QUERY_PACKAGE_SRC']
  ? resolve(process.env['QUERY_PACKAGE_SRC'])
  : join(REPO_ROOT, 'packages', 'query', 'src');
/**
 * P1（2026-11-13）：skills 物理包根（R12 扫描面）。
 *
 * 层归属仍是 app（`modules-to-layers.json`），与 sandbox / query 同口径：
 * 物理独立后 `lint:arch` 只在各自根内解析相对路径 ⇒ 逃逸与跨层依赖必须由本门禁显式守。
 */
const SKILLS_PACKAGE_SRC = process.env['SKILLS_PACKAGE_SRC']
  ? resolve(process.env['SKILLS_PACKAGE_SRC'])
  : join(REPO_ROOT, 'packages', 'skills', 'src');
/**
 * P1（2026-11-13）：tokenBudget 物理包根（R13 扫描面）。
 *
 * 层归属仍是 app（`modules-to-layers.json`），与 sandbox / query / skills 同口径：
 * 物理独立后 `lint:arch` 只在各自根内解析相对路径 ⇒ 逃逸与跨层依赖必须由本门禁显式守。
 */
const TOKEN_BUDGET_PACKAGE_SRC = process.env['TOKEN_BUDGET_PACKAGE_SRC']
  ? resolve(process.env['TOKEN_BUDGET_PACKAGE_SRC'])
  : join(REPO_ROOT, 'packages', 'tokenBudget', 'src');
/**
 * P1（2026-11-13）：vfs 物理包根（R14 扫描面）。
 *
 * 层归属仍是 app（`modules-to-layers.json`），与 sandbox / query / skills / tokenBudget 同口径。
 */
const VFS_PACKAGE_SRC = process.env['VFS_PACKAGE_SRC']
  ? resolve(process.env['VFS_PACKAGE_SRC'])
  : join(REPO_ROOT, 'packages', 'vfs', 'src');
/**
 * P1（2026-11-13）：compaction 物理包根（R15 扫描面）。
 *
 * 层归属仍是 app（`modules-to-layers.json`），与前述 app 层包同口径。
 */
const COMPACTION_PACKAGE_SRC = process.env['COMPACTION_PACKAGE_SRC']
  ? resolve(process.env['COMPACTION_PACKAGE_SRC'])
  : join(REPO_ROOT, 'packages', 'compaction', 'src');
/**
 * P1（2026-11-13）：workspaces 物理包根（R16 扫描面）。
 *
 * 层归属仍是 app（`modules-to-layers.json`），与前述 app 层包同口径。
 */
const WORKSPACES_PACKAGE_SRC = process.env['WORKSPACES_PACKAGE_SRC']
  ? resolve(process.env['WORKSPACES_PACKAGE_SRC'])
  : join(REPO_ROOT, 'packages', 'workspaces', 'src');
/**
 * P1（2026-11-13）：docs 物理包根（R17 扫描面）。
 *
 * 层归属仍是 app（`modules-to-layers.json`），与前述 app 层包同口径。
 */
const DOCS_PACKAGE_SRC = process.env['DOCS_PACKAGE_SRC']
  ? resolve(process.env['DOCS_PACKAGE_SRC'])
  : join(REPO_ROOT, 'packages', 'docs', 'src');
/**
 * P1（2026-11-13）：plugin-sdk 物理包根（R18 扫描面）。
 *
 * 层归属仍是 app（`modules-to-layers.json`），与前述 app 层包同口径。
 */
const PLUGIN_SDK_PACKAGE_SRC = process.env['PLUGIN_SDK_PACKAGE_SRC']
  ? resolve(process.env['PLUGIN_SDK_PACKAGE_SRC'])
  : join(REPO_ROOT, 'packages', 'plugin-sdk', 'src');
/**
 * P1（2026-11-14）：governance 物理包根（R19 扫描面）。
 *
 * 层归属仍是 app（`modules-to-layers.json`），与前述 app 层包同口径。
 */
const GOVERNANCE_PACKAGE_SRC = process.env['GOVERNANCE_PACKAGE_SRC']
  ? resolve(process.env['GOVERNANCE_PACKAGE_SRC'])
  : join(REPO_ROOT, 'packages', 'governance', 'src');
/**
 * P1（2026-11-14）：dream 物理包根（R20 扫描面）。
 *
 * 层归属仍是 app（`modules-to-layers.json`），与前述 app 层包同口径。
 */
const DREAM_PACKAGE_SRC = process.env['DREAM_PACKAGE_SRC']
  ? resolve(process.env['DREAM_PACKAGE_SRC'])
  : join(REPO_ROOT, 'packages', 'dream', 'src');
/**
 * P1（2026-11-14）：evals 物理包根（R21 扫描面）。
 *
 * 层归属仍是 app（`modules-to-layers.json`），与前述 app 层包同口径。
 */
const EVALS_PACKAGE_SRC = process.env['EVALS_PACKAGE_SRC']
  ? resolve(process.env['EVALS_PACKAGE_SRC'])
  : join(REPO_ROOT, 'packages', 'evals', 'src');
/**
 * P1（2026-11-14）：proactive 物理包根（R22 扫描面）。
 *
 * 层归属仍是 app（`modules-to-layers.json`），与前述 app 层包同口径。
 */
const PROACTIVE_PACKAGE_SRC = process.env['PROACTIVE_PACKAGE_SRC']
  ? resolve(process.env['PROACTIVE_PACKAGE_SRC'])
  : join(REPO_ROOT, 'packages', 'proactive', 'src');
/**
 * P1（2026-11-14）：project 物理包根（R23 扫描面）。
 *
 * 层归属仍是 app（`modules-to-layers.json`），与前述 app 层包同口径。
 */
const PROJECT_PACKAGE_SRC = process.env['PROJECT_PACKAGE_SRC']
  ? resolve(process.env['PROJECT_PACKAGE_SRC'])
  : join(REPO_ROOT, 'packages', 'project', 'src');
/**
 * P1（2026-11-14）：subagent 物理包根（R24 扫描面）。
 *
 * 层归属仍是 app（`modules-to-layers.json`），与前述 app 层包同口径。
 */
const SUBAGENT_PACKAGE_SRC = process.env['SUBAGENT_PACKAGE_SRC']
  ? resolve(process.env['SUBAGENT_PACKAGE_SRC'])
  : join(REPO_ROOT, 'packages', 'subagent', 'src');
/**
 * P1（2026-11-14）：resourceGovernor 物理包根（R25 扫描面）。
 *
 * 层归属仍是 app（`modules-to-layers.json`），与前述 app 层包同口径。
 */
const RESOURCE_GOVERNOR_PACKAGE_SRC = process.env[
  'RESOURCE_GOVERNOR_PACKAGE_SRC'
]
  ? resolve(process.env['RESOURCE_GOVERNOR_PACKAGE_SRC'])
  : join(REPO_ROOT, 'packages', 'resourceGovernor', 'src');
/**
 * P1（2026-11-14）：tool 物理包根（R26 扫描面）。
 *
 * 层归属仍是 app（`modules-to-layers.json`），与前述 app 层包同口径。
 */
const TOOL_PACKAGE_SRC = process.env['TOOL_PACKAGE_SRC']
  ? resolve(process.env['TOOL_PACKAGE_SRC'])
  : join(REPO_ROOT, 'packages', 'tool', 'src');
/**
 * P1（2026-11-14）：context-engine 物理包根（R27 扫描面）。
 *
 * 层归属仍是 app（`modules-to-layers.json`），与前述 app 层包同口径。
 */
const CONTEXT_ENGINE_PACKAGE_SRC = process.env['CONTEXT_ENGINE_PACKAGE_SRC']
  ? resolve(process.env['CONTEXT_ENGINE_PACKAGE_SRC'])
  : join(REPO_ROOT, 'packages', 'context-engine', 'src');
/**
 * P1（2026-11-14）：buddy 物理包根（R28 扫描面）。
 *
 * 层归属仍是 app（`modules-to-layers.json`），与前述 app 层包同口径。
 */
const BUDDY_PACKAGE_SRC = process.env['BUDDY_PACKAGE_SRC']
  ? resolve(process.env['BUDDY_PACKAGE_SRC'])
  : join(REPO_ROOT, 'packages', 'buddy', 'src');
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
      if (ref.specifier.startsWith('@modules/')) {
        const to = ref.specifier.slice('@modules/'.length).split('/')[0] ?? '';
        edges.push({ from, to });
        continue;
      }
      // P5（2026-11-01）：模块物理迁入 `packages/infra` 后，同层引用改走 `@openliri/infra/<m>`；
      // 不解析该别名 ⇒ 迁包模块的边从环检测里消失（R7 对它们形同关闭）。
      if (ref.specifier.startsWith('@openliri/infra/')) {
        const to =
          ref.specifier
            .slice('@openliri/infra/'.length)
            .replace(/\.js$/, '')
            .split('/')[0] ?? '';
        if (to) edges.push({ from, to });
        continue;
      }
      // B8（2026-11-01）：**相对导入**同样产生 infra→infra 边。
      //
      // 此前只解析 `@modules/*` / `@openliri/infra/*` ⇒ 模块内部用 `../monitoring/...` 这类相对
      // 写法时，其**出边整块不可见**：`utils ↔ {config,monitoring,analytics,performance}` 的五元环
      // 一直被"藏"着（迁包把相对写法统一成别名后立刻暴露）。这里按文件所在模块解析相对路径。
      if (ref.specifier.startsWith('.')) {
        const joined = posix.normalize(
          posix.join(
            dirname(file.path),
            ref.specifier.replace(/\.jsx?$/, '')
          )
        );
        if (joined.startsWith('..')) continue; // 逃逸扫描根 ⇒ 不属于任何模块
        const to = joined.split('/')[0] ?? '';
        if (to) edges.push({ from, to });
      }
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
    // P5（2026-11-01）：物理包内的模块目录以**包根**为基准收集 —— 否则路径变成
    // `../../packages/infra/src/common/x.ts`，首段不是模块名 ⇒ R7 的 `from` 恒为 `..`、
    // 该模块的所有边整块丢失（环检测与 R2/R3 对包内文件形同关闭）。
    collect(dir, infraFiles, dir === inPackage ? PACKAGE_SRC : SRC_DIR);
  }

  // R6 扫描面：infra 物理包（未建包时为空数组；app 侧的 @openliri/infra/* 仍会被 R6 检查）
  const packageFiles: SourceFile[] = [];
  if (existsSync(PACKAGE_SRC) && statSync(PACKAGE_SRC).isDirectory()) {
    // 包内文件用**包内相对路径**（R6 的相对逃逸判定以此为准，与仓库布局解耦）
    collect(PACKAGE_SRC, packageFiles, PACKAGE_SRC);
  }

  // R8 扫描面：service 物理包（未建包时为空数组）
  const servicePackageFiles: SourceFile[] = [];
  if (
    existsSync(SERVICE_PACKAGE_SRC) &&
    statSync(SERVICE_PACKAGE_SRC).isDirectory()
  ) {
    collect(SERVICE_PACKAGE_SRC, servicePackageFiles, SERVICE_PACKAGE_SRC);
  }

  // R9 扫描面：sandbox 物理包（P1，2026-11-12；未建包时为空数组）
  const sandboxPackageFiles: SourceFile[] = [];
  if (
    existsSync(SANDBOX_PACKAGE_SRC) &&
    statSync(SANDBOX_PACKAGE_SRC).isDirectory()
  ) {
    collect(SANDBOX_PACKAGE_SRC, sandboxPackageFiles, SANDBOX_PACKAGE_SRC);
  }

  // R10 扫描面：channels 物理包（P1，2026-11-13；未建包时为空数组）
  const channelsPackageFiles: SourceFile[] = [];
  if (
    existsSync(CHANNELS_PACKAGE_SRC) &&
    statSync(CHANNELS_PACKAGE_SRC).isDirectory()
  ) {
    collect(CHANNELS_PACKAGE_SRC, channelsPackageFiles, CHANNELS_PACKAGE_SRC);
  }

  // R11 扫描面：query 物理包（P1，2026-11-13；未建包时为空数组）
  const queryPackageFiles: SourceFile[] = [];
  if (
    existsSync(QUERY_PACKAGE_SRC) &&
    statSync(QUERY_PACKAGE_SRC).isDirectory()
  ) {
    collect(QUERY_PACKAGE_SRC, queryPackageFiles, QUERY_PACKAGE_SRC);
  }

  // R12 扫描面：skills 物理包（P1，2026-11-13；未建包时为空数组）
  const skillsPackageFiles: SourceFile[] = [];
  if (
    existsSync(SKILLS_PACKAGE_SRC) &&
    statSync(SKILLS_PACKAGE_SRC).isDirectory()
  ) {
    collect(SKILLS_PACKAGE_SRC, skillsPackageFiles, SKILLS_PACKAGE_SRC);
  }

  // R13 扫描面：tokenBudget 物理包（P1，2026-11-13；未建包时为空数组）
  const tokenBudgetPackageFiles: SourceFile[] = [];
  if (
    existsSync(TOKEN_BUDGET_PACKAGE_SRC) &&
    statSync(TOKEN_BUDGET_PACKAGE_SRC).isDirectory()
  ) {
    collect(
      TOKEN_BUDGET_PACKAGE_SRC,
      tokenBudgetPackageFiles,
      TOKEN_BUDGET_PACKAGE_SRC
    );
  }

  // R14 扫描面：vfs 物理包（P1，2026-11-13；未建包时为空数组）
  const vfsPackageFiles: SourceFile[] = [];
  if (existsSync(VFS_PACKAGE_SRC) && statSync(VFS_PACKAGE_SRC).isDirectory()) {
    collect(VFS_PACKAGE_SRC, vfsPackageFiles, VFS_PACKAGE_SRC);
  }

  // R15 扫描面：compaction 物理包（P1，2026-11-13；未建包时为空数组）
  const compactionPackageFiles: SourceFile[] = [];
  if (
    existsSync(COMPACTION_PACKAGE_SRC) &&
    statSync(COMPACTION_PACKAGE_SRC).isDirectory()
  ) {
    collect(
      COMPACTION_PACKAGE_SRC,
      compactionPackageFiles,
      COMPACTION_PACKAGE_SRC
    );
  }

  // R16 扫描面：workspaces 物理包（P1，2026-11-13；未建包时为空数组）
  const workspacesPackageFiles: SourceFile[] = [];
  if (
    existsSync(WORKSPACES_PACKAGE_SRC) &&
    statSync(WORKSPACES_PACKAGE_SRC).isDirectory()
  ) {
    collect(
      WORKSPACES_PACKAGE_SRC,
      workspacesPackageFiles,
      WORKSPACES_PACKAGE_SRC
    );
  }

  // R17 扫描面：docs 物理包（P1，2026-11-13；未建包时为空数组）
  const docsPackageFiles: SourceFile[] = [];
  if (
    existsSync(DOCS_PACKAGE_SRC) &&
    statSync(DOCS_PACKAGE_SRC).isDirectory()
  ) {
    collect(DOCS_PACKAGE_SRC, docsPackageFiles, DOCS_PACKAGE_SRC);
  }

  // R18 扫描面：plugin-sdk 物理包（P1，2026-11-13；未建包时为空数组）
  const pluginSdkPackageFiles: SourceFile[] = [];
  if (
    existsSync(PLUGIN_SDK_PACKAGE_SRC) &&
    statSync(PLUGIN_SDK_PACKAGE_SRC).isDirectory()
  ) {
    collect(
      PLUGIN_SDK_PACKAGE_SRC,
      pluginSdkPackageFiles,
      PLUGIN_SDK_PACKAGE_SRC
    );
  }

  // R19 扫描面：governance 物理包（P1，2026-11-14；未建包时为空数组）
  const governancePackageFiles: SourceFile[] = [];
  if (
    existsSync(GOVERNANCE_PACKAGE_SRC) &&
    statSync(GOVERNANCE_PACKAGE_SRC).isDirectory()
  ) {
    collect(GOVERNANCE_PACKAGE_SRC, governancePackageFiles, GOVERNANCE_PACKAGE_SRC);
  }

  // R20 扫描面：dream 物理包（P1，2026-11-14；未建包时为空数组）
  const dreamPackageFiles: SourceFile[] = [];
  if (existsSync(DREAM_PACKAGE_SRC) && statSync(DREAM_PACKAGE_SRC).isDirectory()) {
    collect(DREAM_PACKAGE_SRC, dreamPackageFiles, DREAM_PACKAGE_SRC);
  }

  // R21 扫描面：evals 物理包（P1，2026-11-14；未建包时为空数组）
  const evalsPackageFiles: SourceFile[] = [];
  if (existsSync(EVALS_PACKAGE_SRC) && statSync(EVALS_PACKAGE_SRC).isDirectory()) {
    collect(EVALS_PACKAGE_SRC, evalsPackageFiles, EVALS_PACKAGE_SRC);
  }

  // R22 扫描面：proactive 物理包（P1，2026-11-14；未建包时为空数组）
  const proactivePackageFiles: SourceFile[] = [];
  if (
    existsSync(PROACTIVE_PACKAGE_SRC) &&
    statSync(PROACTIVE_PACKAGE_SRC).isDirectory()
  ) {
    collect(PROACTIVE_PACKAGE_SRC, proactivePackageFiles, PROACTIVE_PACKAGE_SRC);
  }

  // R23 扫描面：project 物理包（P1，2026-11-14；未建包时为空数组）
  const projectPackageFiles: SourceFile[] = [];
  if (
    existsSync(PROJECT_PACKAGE_SRC) &&
    statSync(PROJECT_PACKAGE_SRC).isDirectory()
  ) {
    collect(PROJECT_PACKAGE_SRC, projectPackageFiles, PROJECT_PACKAGE_SRC);
  }

  // R24 扫描面：subagent 物理包（P1，2026-11-14；未建包时为空数组）
  const subagentPackageFiles: SourceFile[] = [];
  if (
    existsSync(SUBAGENT_PACKAGE_SRC) &&
    statSync(SUBAGENT_PACKAGE_SRC).isDirectory()
  ) {
    collect(SUBAGENT_PACKAGE_SRC, subagentPackageFiles, SUBAGENT_PACKAGE_SRC);
  }

  // R25 扫描面：resourceGovernor 物理包（P1，2026-11-14；未建包时为空数组）
  const resourceGovernorPackageFiles: SourceFile[] = [];
  if (
    existsSync(RESOURCE_GOVERNOR_PACKAGE_SRC) &&
    statSync(RESOURCE_GOVERNOR_PACKAGE_SRC).isDirectory()
  ) {
    collect(
      RESOURCE_GOVERNOR_PACKAGE_SRC,
      resourceGovernorPackageFiles,
      RESOURCE_GOVERNOR_PACKAGE_SRC
    );
  }

  // R26 扫描面：tool 物理包（P1，2026-11-14；未建包时为空数组）
  const toolPackageFiles: SourceFile[] = [];
  if (existsSync(TOOL_PACKAGE_SRC) && statSync(TOOL_PACKAGE_SRC).isDirectory()) {
    collect(TOOL_PACKAGE_SRC, toolPackageFiles, TOOL_PACKAGE_SRC);
  }

  // R27 扫描面：context-engine 物理包（P1，2026-11-14；未建包时为空数组）
  const contextEnginePackageFiles: SourceFile[] = [];
  if (
    existsSync(CONTEXT_ENGINE_PACKAGE_SRC) &&
    statSync(CONTEXT_ENGINE_PACKAGE_SRC).isDirectory()
  ) {
    collect(
      CONTEXT_ENGINE_PACKAGE_SRC,
      contextEnginePackageFiles,
      CONTEXT_ENGINE_PACKAGE_SRC
    );
  }

  // R28 扫描面：buddy 物理包（P1，2026-11-14；未建包时为空数组）
  const buddyPackageFiles: SourceFile[] = [];
  if (
    existsSync(BUDDY_PACKAGE_SRC) &&
    statSync(BUDDY_PACKAGE_SRC).isDirectory()
  ) {
    collect(BUDDY_PACKAGE_SRC, buddyPackageFiles, BUDDY_PACKAGE_SRC);
  }

  const commonFiles = infraFiles.filter((f) => f.path.startsWith('common/'));
  const utilsFiles = infraFiles.filter((f) => f.path.startsWith('utils/'));

  // R5 的扫描面是**全 src**（驱动唯一入口属于全局约束，不限 infra 目录）
  const allSrcFiles: SourceFile[] = [];
  collect(SRC_DIR, allSrcFiles);

  // 2026-11-01（P2）：迁入 `packages/infra/src` 的文件同样是生产代码 —— R5 若不纳入，
  // 包装本体（唯一合法的 `bun:sqlite` 直连）会从扫描面里消失，规则静默变成"0 处"。
  // 包内文件沿用**包内相对路径**（与白名单口径 `external/sqlite3.ts` 一致）。

  const reports: BoundaryReport[] = [
    compareTopLevelIo(infraFiles, allowlist),
    compareApprovalOrchestration(infraFiles, layers, allowlist),
    compareDynamicInfraToApp(infraFiles, layers, allowlist),
    compareCommonUtilsDuplicates(commonFiles, utilsFiles, allowlist),
    compareDirectSqliteImports(
      [...allSrcFiles, ...packageFiles, ...servicePackageFiles],
      allowlist
    ),
    compareInfraPackageBoundary({
      packageFiles,
      appFiles: allSrcFiles,
      layerOf: layers,
    }),
    compareInfraPackageBoundary({
      packageFiles: servicePackageFiles,
      appFiles: allSrcFiles,
      layerOf: layers,
      rule: 'R8',
      packageName: 'service',
      packageLayer: 'service',
      forbiddenLayers: SERVICE_FORBIDDEN_TARGET_LAYERS,
    }),
    compareInfraPackageBoundary({
      packageFiles: sandboxPackageFiles,
      appFiles: allSrcFiles,
      layerOf: layers,
      rule: 'R9',
      packageName: 'sandbox',
      packageLayer: 'app',
      forbiddenLayers: APP_LAYER_PACKAGE_FORBIDDEN_TARGET_LAYERS,
    }),
    compareInfraPackageBoundary({
      packageFiles: channelsPackageFiles,
      appFiles: allSrcFiles,
      layerOf: layers,
      rule: 'R10',
      packageName: 'channels',
      packageLayer: 'service',
      forbiddenLayers: SERVICE_FORBIDDEN_TARGET_LAYERS,
    }),
    compareInfraPackageBoundary({
      packageFiles: queryPackageFiles,
      appFiles: allSrcFiles,
      layerOf: layers,
      rule: 'R11',
      packageName: 'query',
      packageLayer: 'app',
      forbiddenLayers: APP_LAYER_PACKAGE_FORBIDDEN_TARGET_LAYERS,
    }),
    compareInfraPackageBoundary({
      packageFiles: skillsPackageFiles,
      appFiles: allSrcFiles,
      layerOf: layers,
      rule: 'R12',
      packageName: 'skills',
      packageLayer: 'app',
      forbiddenLayers: APP_LAYER_PACKAGE_FORBIDDEN_TARGET_LAYERS,
    }),
    compareInfraPackageBoundary({
      packageFiles: tokenBudgetPackageFiles,
      appFiles: allSrcFiles,
      layerOf: layers,
      rule: 'R13',
      packageName: 'tokenBudget',
      packageLayer: 'app',
      forbiddenLayers: APP_LAYER_PACKAGE_FORBIDDEN_TARGET_LAYERS,
    }),
    compareInfraPackageBoundary({
      packageFiles: vfsPackageFiles,
      appFiles: allSrcFiles,
      layerOf: layers,
      rule: 'R14',
      packageName: 'vfs',
      packageLayer: 'app',
      forbiddenLayers: APP_LAYER_PACKAGE_FORBIDDEN_TARGET_LAYERS,
    }),
    compareInfraPackageBoundary({
      packageFiles: compactionPackageFiles,
      appFiles: allSrcFiles,
      layerOf: layers,
      rule: 'R15',
      packageName: 'compaction',
      packageLayer: 'app',
      forbiddenLayers: APP_LAYER_PACKAGE_FORBIDDEN_TARGET_LAYERS,
    }),
    compareInfraPackageBoundary({
      packageFiles: workspacesPackageFiles,
      appFiles: allSrcFiles,
      layerOf: layers,
      rule: 'R16',
      packageName: 'workspaces',
      packageLayer: 'app',
      forbiddenLayers: APP_LAYER_PACKAGE_FORBIDDEN_TARGET_LAYERS,
    }),
    compareInfraPackageBoundary({
      packageFiles: docsPackageFiles,
      appFiles: allSrcFiles,
      layerOf: layers,
      rule: 'R17',
      packageName: 'docs',
      packageLayer: 'app',
      forbiddenLayers: APP_LAYER_PACKAGE_FORBIDDEN_TARGET_LAYERS,
    }),
    compareInfraPackageBoundary({
      packageFiles: pluginSdkPackageFiles,
      appFiles: allSrcFiles,
      layerOf: layers,
      rule: 'R18',
      packageName: 'plugin-sdk',
      packageLayer: 'app',
      forbiddenLayers: APP_LAYER_PACKAGE_FORBIDDEN_TARGET_LAYERS,
    }),
    compareInfraPackageBoundary({
      packageFiles: governancePackageFiles,
      appFiles: allSrcFiles,
      layerOf: layers,
      rule: 'R19',
      packageName: 'governance',
      packageLayer: 'app',
      forbiddenLayers: APP_LAYER_PACKAGE_FORBIDDEN_TARGET_LAYERS,
    }),
    compareInfraPackageBoundary({
      packageFiles: dreamPackageFiles,
      appFiles: allSrcFiles,
      layerOf: layers,
      rule: 'R20',
      packageName: 'dream',
      packageLayer: 'app',
      forbiddenLayers: APP_LAYER_PACKAGE_FORBIDDEN_TARGET_LAYERS,
    }),
    compareInfraPackageBoundary({
      packageFiles: evalsPackageFiles,
      appFiles: allSrcFiles,
      layerOf: layers,
      rule: 'R21',
      packageName: 'evals',
      packageLayer: 'app',
      forbiddenLayers: APP_LAYER_PACKAGE_FORBIDDEN_TARGET_LAYERS,
    }),
    compareInfraPackageBoundary({
      packageFiles: proactivePackageFiles,
      appFiles: allSrcFiles,
      layerOf: layers,
      rule: 'R22',
      packageName: 'proactive',
      packageLayer: 'app',
      forbiddenLayers: APP_LAYER_PACKAGE_FORBIDDEN_TARGET_LAYERS,
    }),
    compareInfraPackageBoundary({
      packageFiles: projectPackageFiles,
      appFiles: allSrcFiles,
      layerOf: layers,
      rule: 'R23',
      packageName: 'project',
      packageLayer: 'app',
      forbiddenLayers: APP_LAYER_PACKAGE_FORBIDDEN_TARGET_LAYERS,
    }),
    compareInfraPackageBoundary({
      packageFiles: subagentPackageFiles,
      appFiles: allSrcFiles,
      layerOf: layers,
      rule: 'R24',
      packageName: 'subagent',
      packageLayer: 'app',
      forbiddenLayers: APP_LAYER_PACKAGE_FORBIDDEN_TARGET_LAYERS,
    }),
    compareInfraPackageBoundary({
      packageFiles: resourceGovernorPackageFiles,
      appFiles: allSrcFiles,
      layerOf: layers,
      rule: 'R25',
      packageName: 'resourceGovernor',
      packageLayer: 'app',
      forbiddenLayers: APP_LAYER_PACKAGE_FORBIDDEN_TARGET_LAYERS,
    }),
    compareInfraPackageBoundary({
      packageFiles: toolPackageFiles,
      appFiles: allSrcFiles,
      layerOf: layers,
      rule: 'R26',
      packageName: 'tool',
      packageLayer: 'app',
      forbiddenLayers: APP_LAYER_PACKAGE_FORBIDDEN_TARGET_LAYERS,
    }),
    compareInfraPackageBoundary({
      packageFiles: contextEnginePackageFiles,
      appFiles: allSrcFiles,
      layerOf: layers,
      rule: 'R27',
      packageName: 'context-engine',
      packageLayer: 'app',
      forbiddenLayers: APP_LAYER_PACKAGE_FORBIDDEN_TARGET_LAYERS,
    }),
    compareInfraPackageBoundary({
      packageFiles: buddyPackageFiles,
      appFiles: allSrcFiles,
      layerOf: layers,
      rule: 'R28',
      packageName: 'buddy',
      packageLayer: 'app',
      forbiddenLayers: APP_LAYER_PACKAGE_FORBIDDEN_TARGET_LAYERS,
    }),
    compareInfraCycles(
      findInfraCycleMembers(buildInfraEdges(infraFiles), infraModules),
      loadCycleBaseline()
    ),
  ];

  console.log('=== infra 层边界契约门禁（R1–R28）===');
  console.log(
    `infra 模块 ${infraModules.length} 个（无目录 ${missing.length}）· 生产源文件 ${infraFiles.length} 个` +
      ` · common ${commonFiles.length} / utils ${utilsFiles.length}` +
      ` · infra 包 ${packageFiles.length} 个文件 · service 包 ${servicePackageFiles.length} 个文件` +
      ` · sandbox 包 ${sandboxPackageFiles.length} 个文件` +
      ` · channels 包 ${channelsPackageFiles.length} 个文件`
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
  console.log('\n✅ 合规（R1–R28 无未登记违规）');
  return 0;
}

try {
  process.exit(main());
} catch (err) {
  console.error(`❌ infra 边界门禁执行失败（不视为通过）: ${String(err)}`);
  process.exit(1);
}
