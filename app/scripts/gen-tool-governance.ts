/**
 * gen-tool-governance.ts — 工具**安全治理矩阵**与**执行入口台账**（P0，2026-11-22）
 *
 * 背景：`.trae/specs/tool-security-governance-plan.md`。工具治理的基础设施已齐备
 * （`TOOL_EFFECTS` / `sandboxLevel` / `deriveToolRiskClass` / `PermissionChecker`），
 * 但「每个工具的最终治理结论」与「直调 `tool.execute()` 的授权证据」没有固化成可 diff 的产物
 * ⇒ 新增工具或改一行声明，风险档可能静默变化而无人复核。
 *
 * 本脚本做两件事（**只读 + 生成**，不参与执行）：
 * 1. 生成矩阵：`.trae/architecture/tool-governance-matrix.json` + 同名 `.md`
 *    —— 逐工具记录声明、派生风险、资源上限、缺口与结论；
 * 2. 校验执行入口台账：`.trae/architecture/tool-execution-entrypoints.json`
 *    —— `app/src/**` 里每一处 `tool.execute(` 都必须登记（status / authorizedBy / note）。
 *
 * 用法：
 *   bun run gen:tool-governance        # 重新生成矩阵（人工复核 diff 后提交）
 *   bun run lint:tool-governance       # CI/预提交：矩阵逐字节比对 + 台账校验（不写盘）
 *
 * 判据（fail-closed）：
 * - 矩阵：`gap`（未被 exceptions 接受）⇒ exit 1；acceptedGap 只打印；
 * - 台账：未登记文件 / occurrences 与源码不符 / status 非法 / needs-review 无 note ⇒ exit 1；
 * - 例外表引用不存在的工具 ⇒ exit 1（防僵尸登记）；
 * - 任何输入缺失 / JSON 解析失败 ⇒ exit 1（AR-3：不得静默降级为“通过”）。
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// 变体层必须最先注入（同 gen-tool-names / lint-tool-risk：实例化工具会触发顶层 feature()）
import '../src/bootstrap/initVariantFlags';
import { ToolFactory } from '../src/tools/ToolFactory';
import {
  getAllBuiltinToolLoaders,
  getBuiltinToolLoaders,
  loadTools,
} from '../src/tools/utils/ToolManagerUtils';
import { deriveToolRiskClass } from '../src/tools/toolRiskClass';
import { resolveToolEffect } from '../src/tools/toolEffects';
import { BaseTool } from '../src/tools/BaseTool';
import { TOOL_NAME_CONSTANTS } from '../src/tools/toolNameConstants';
import {
  getCapabilityPackOf,
  getToolCategory,
} from '../src/tools/toolCategories';
// P0（2026-11-22）：判据是纯函数，单测直接 import 本模块（不实例化工具）
import {
  computeGaps,
  validateAcceptedGaps,
  validateEntrypoints,
  validateExceptions,
  type EntrypointsFile,
  type ExceptionsFile,
} from './lib/toolGovernanceRules';

const HERE = dirname(fileURLToPath(import.meta.url)); // app/scripts
const APP_DIR = resolve(HERE, '..');
const REPO_ROOT = resolve(APP_DIR, '..');
const ARCH_DIR = join(REPO_ROOT, '.trae', 'architecture');
const MATRIX_JSON = join(ARCH_DIR, 'tool-governance-matrix.json');
const MATRIX_MD = join(ARCH_DIR, 'tool-governance-matrix.md');
const EXCEPTIONS_JSON = join(ARCH_DIR, 'tool-governance-exceptions.json');
const ENTRYPOINTS_JSON = join(ARCH_DIR, 'tool-execution-entrypoints.json');

const CHECK = process.argv.includes('--check');

export interface ToolRow {
  name: string;
  pack: string | null;
  category: string;
  runtimeRegistered: boolean;
  effects: {
    sideEffect: 'none' | 'local' | 'external' | 'undeclared';
    idempotent: boolean | null;
    discriminator: 'op' | 'mode' | null;
  };
  sandboxLevel: string;
  risk: {
    declared: string | null;
    derived: string;
    source: string;
  };
  readOnly: boolean | null;
  destructive: boolean | null;
  concurrencySafe: boolean | null;
  maxResultSizeChars: number | null;
  approvalFingerprint: boolean;
  checkPermissions: boolean;
  checkPermissionsOverridden: boolean;
  getPath: boolean;
  getPathOverridden: boolean;
  resolveFileIoRoot: boolean;
  gaps: string[];
  acceptedBy: string | null;
  verdict: 'pass' | 'accepted-gap' | 'gap';
}

function fail(msg: string): never {
  console.error(`❌ [tool-governance] ${msg}`);
  process.exit(1);
}

function readJson<T>(file: string, label: string): T {
  if (!existsSync(file)) fail(`缺少 ${label}：${file}`);
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch (e) {
    fail(
      `${label} 不是合法 JSON：${file}（${e instanceof Error ? e.message : String(e)}）`
    );
  }
}

/** 安全调用工具的可选方法（抛错视为未声明） */
function safeBool(fn: (() => boolean) | undefined): boolean | null {
  if (typeof fn !== 'function') return null;
  try {
    return Boolean(fn());
  } catch {
    return null;
  }
}

/** 风险声明来源（与 `deriveToolRiskClass` 的优先级同口径，仅用于归因展示） */
function riskSource(
  name: string,
  tool: {
    riskClass?: string;
    riskClassFor?: (input: Record<string, unknown>) => string;
    sandboxLevel?: string;
    getRiskClass?: (input?: Record<string, unknown>) => string;
    isReadOnly?: (input?: Record<string, unknown>) => boolean;
  },
  derived: string
): string {
  try {
    if (typeof tool.riskClassFor === 'function' && tool.riskClassFor({})) {
      return 'declared:dynamic';
    }
  } catch {
    // 声明实现异常 ⇒ 继续降级
  }
  if (tool.riskClass) return 'declared:static';
  if (tool.sandboxLevel === 'execution' && derived === 'shell') {
    return 'derived:sandboxLevel';
  }
  if (resolveToolEffect(name as never)) return 'derived:effects';
  if (safeBool(tool.isReadOnly?.bind(tool)) === true) {
    return 'derived:self-readonly';
  }
  return 'undeclared';
}

function buildRows(exceptions: ExceptionsFile): {
  rows: ToolRow[];
  declaredNotInstantiated: string[];
} {
  const factory = new ToolFactory();
  const all = loadTools(factory, getAllBuiltinToolLoaders());
  const runtime = loadTools(factory, getBuiltinToolLoaders());
  const runtimeNames = new Set(runtime.map((t) => t.name));

  const byName = new Map<string, (typeof all)[number]>();
  for (const tool of all) {
    if (!byName.has(tool.name)) byName.set(tool.name, tool);
  }

  const accepted = new Map<string, string>();
  for (const gap of exceptions.acceptedGaps) {
    for (const g of gap.gaps) accepted.set(`${gap.tool}::${g}`, gap.riskId);
  }

  const rows: ToolRow[] = [];
  for (const name of [...byName.keys()].sort()) {
    const tool = byName.get(name)!;
    const effect = resolveToolEffect(name as never);
    const derived = deriveToolRiskClass(tool, {});
    const declared =
      tool.riskClass ??
      (() => {
        try {
          return tool.riskClassFor?.({}) ?? null;
        } catch {
          return null;
        }
      })();
    const readOnly = safeBool(tool.isReadOnly.bind(tool));
    const base: Omit<ToolRow, 'gaps' | 'acceptedBy' | 'verdict'> = {
      name,
      pack: getCapabilityPackOf(name) ?? null,
      category: getToolCategory(name),
      runtimeRegistered: runtimeNames.has(name),
      effects: {
        sideEffect: effect?.sideEffect ?? 'undeclared',
        idempotent: effect?.idempotent ?? null,
        discriminator: effect?.discriminator ?? null,
      },
      sandboxLevel: tool.sandboxLevel ?? 'none',
      risk: {
        declared: declared ?? null,
        derived,
        source: riskSource(name, tool, derived),
      },
      readOnly,
      destructive: safeBool(tool.isDestructive?.bind(tool)),
      concurrencySafe: safeBool(tool.isConcurrencySafe.bind(tool)),
      maxResultSizeChars: tool.maxResultSizeChars ?? null,
      approvalFingerprint: typeof tool.approvalFingerprint === 'function',
      checkPermissions: typeof tool.checkPermissions === 'function',
      // BaseTool 提供默认实现（直接 allow）⇒ 只有**子类覆盖**才算工具级治理声明
      checkPermissionsOverridden:
        tool.checkPermissions !== BaseTool.prototype.checkPermissions,
      getPath: typeof tool.getPath === 'function',
      getPathOverridden: tool.getPath !== BaseTool.prototype.getPath,
      resolveFileIoRoot:
        typeof (tool as { resolveFileIoRoot?: unknown }).resolveFileIoRoot ===
        'function',
    };
    const gaps = computeGaps(base);
    const acceptedIds = gaps
      .map((g) => accepted.get(`${name}::${g}`) ?? null)
      .filter((v): v is string => Boolean(v));
    const row: ToolRow = {
      ...base,
      gaps,
      acceptedBy:
        gaps.length > 0 && acceptedIds.length === gaps.length
          ? acceptedIds.join(',')
          : null,
      verdict:
        gaps.length === 0
          ? 'pass'
          : acceptedIds.length === gaps.length
            ? 'accepted-gap'
            : 'gap',
    };
    rows.push(row);
  }

  const declared = new Set(Object.values(TOOL_NAME_CONSTANTS) as string[]);
  const declaredNotInstantiated = [...declared]
    .filter((n) => !byName.has(n))
    .sort();

  return { rows, declaredNotInstantiated };
}

function buildMatrixJson(
  rows: ToolRow[],
  declaredNotInstantiated: string[]
): string {
  const counts = {
    total: rows.length,
    runtime: rows.filter((r) => r.runtimeRegistered).length,
    pass: rows.filter((r) => r.verdict === 'pass').length,
    acceptedGap: rows.filter((r) => r.verdict === 'accepted-gap').length,
    gap: rows.filter((r) => r.verdict === 'gap').length,
    riskUndeclared: rows.filter((r) => r.risk.derived === 'undeclared').length,
  };
  const payload = {
    schemaVersion: 1,
    generatedBy: 'app/scripts/gen-tool-governance.ts',
    note: '由 gen:tool-governance 生成，勿手改；矩阵是派生结论的快照，不是新的事实源。',
    counts,
    declaredNotInstantiated,
    tools: rows,
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function buildMatrixMd(rows: ToolRow[]): string {
  const groups: Array<[string, ToolRow[]]> = [
    ['shell', rows.filter((r) => r.risk.derived === 'shell')],
    ['external', rows.filter((r) => r.risk.derived === 'external')],
    ['write', rows.filter((r) => r.risk.derived === 'write')],
    ['read', rows.filter((r) => r.risk.derived === 'read')],
    ['discuss', rows.filter((r) => r.risk.derived === 'discuss')],
    ['undeclared', rows.filter((r) => r.risk.derived === 'undeclared')],
  ];
  const lines: string[] = [
    '# 工具治理矩阵（自动生成）',
    '',
    '> 由 `bun run gen:tool-governance` 生成，**请勿手改**。规范见 `.trae/specs/tool-security-governance-plan.md`。',
    `> 实测工具 **${rows.length}** 个 · pass ${rows.filter((r) => r.verdict === 'pass').length} · accepted-gap ${rows.filter((r) => r.verdict === 'accepted-gap').length} · gap ${rows.filter((r) => r.verdict === 'gap').length}`,
    '',
  ];
  for (const [title, group] of groups) {
    if (group.length === 0) continue;
    lines.push(`## ${title}（${group.length}）`, '');
    lines.push(
      '| 工具 | effects | sandbox | risk（声明 / 派生 / 来源） | 只读 | 上限 | 指纹 | 自定义权限 | verdict |',
      '|---|---|---|---|---|---|---|---|---|'
    );
    for (const r of group) {
      lines.push(
        `| \`${r.name}\` | ${r.effects.sideEffect}${r.effects.discriminator ? `(${r.effects.discriminator})` : ''} | ${r.sandboxLevel} | ${r.risk.declared ?? '—'} / ${r.risk.derived} / ${r.risk.source} | ${r.readOnly === null ? '?' : r.readOnly ? 'yes' : 'no'} | ${r.maxResultSizeChars ?? '—'} | ${r.approvalFingerprint ? 'yes' : '—'} | ${r.checkPermissionsOverridden ? 'yes' : '—'} | ${r.verdict}${r.acceptedBy ? `（${r.acceptedBy}）` : ''} |`
      );
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

/** 逐行扫描 `tool.execute(`（跳过注释与测试目录） */
function scanEntrypoints(
  roots: string[]
): Array<{ file: string; occurrences: number }> {
  const out: Array<{ file: string; occurrences: number }> = [];
  for (const root of roots) {
    const abs = join(APP_DIR, root);
    if (!existsSync(abs)) fail(`执行入口扫描根不存在：${root}`);
    for (const file of walk(abs)) {
      const rel = relative(APP_DIR, file).replace(/\\/g, '/');
      if (rel.includes('__tests__') || /\.test\.ts$/.test(rel)) continue;
      const text = readFileSync(file, 'utf8');
      let count = 0;
      for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (
          line.startsWith('//') ||
          line.startsWith('/*') ||
          line.startsWith('*')
        ) {
          continue;
        }
        // F25（2026-11-22）：扫描面扩到 `xxxTool.execute(`（此前只认 `tool.execute(`，
        // 懒加载包装器 / 插件直调 / 命令直调等入口不会被登记与复核）。
        // `(?!\s*\))` 排除日志文案里的 `FooTool.execute()`（空参数形态，非真实调用）。
        if (/(?:\w*[Tt]ool|tool)\.execute\((?!\s*\))/.test(raw)) count += 1;
      }
      if (count > 0) out.push({ file: rel, occurrences: count });
    }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      out.push(...walk(p));
    } else if (entry.isFile() && p.endsWith('.ts')) {
      out.push(p);
    }
  }
  return out;
}

function main(): number {
  const exceptions = readJson<ExceptionsFile>(EXCEPTIONS_JSON, '治理例外表');
  const entrypoints = readJson<EntrypointsFile>(
    ENTRYPOINTS_JSON,
    '执行入口台账'
  );

  const { rows, declaredNotInstantiated } = buildRows(exceptions);
  const matrixJson = buildMatrixJson(rows, declaredNotInstantiated);
  const matrixMd = buildMatrixMd(rows);

  const errors = [
    ...validateExceptions(
      exceptions,
      rows.map((r) => r.name)
    ),
    ...validateAcceptedGaps(exceptions, rows),
    ...validateEntrypoints(entrypoints, scanEntrypoints(entrypoints.scanRoots)),
  ];

  const gapRows = rows.filter((r) => r.verdict === 'gap');
  if (gapRows.length > 0) {
    errors.push(
      `存在未接受的治理缺口：${gapRows
        .map((r) => `${r.name}[${r.gaps.join('|')}]`)
        .join(', ')}`
    );
  }

  if (!CHECK) {
    mkdirSync(ARCH_DIR, { recursive: true });
    writeFileSync(MATRIX_JSON, matrixJson, 'utf8');
    writeFileSync(MATRIX_MD, matrixMd, 'utf8');
    console.log(
      `[tool-governance] 已生成矩阵：${rows.length} 工具（pass ${rows.filter((r) => r.verdict === 'pass').length} / accepted ${rows.filter((r) => r.verdict === 'accepted-gap').length} / gap ${gapRows.length}）`
    );
  } else {
    const currentJson = existsSync(MATRIX_JSON)
      ? readFileSync(MATRIX_JSON, 'utf8')
      : '';
    const currentMd = existsSync(MATRIX_MD)
      ? readFileSync(MATRIX_MD, 'utf8')
      : '';
    if (currentJson !== matrixJson) {
      errors.push(
        'tool-governance-matrix.json 与事实源不一致（运行 gen:tool-governance）'
      );
    }
    if (currentMd !== matrixMd) {
      errors.push(
        'tool-governance-matrix.md 与事实源不一致（运行 gen:tool-governance）'
      );
    }
  }

  console.log('=== 工具安全治理（P0：矩阵 + 执行入口台账） ===');
  console.log(
    `实测工具 ${rows.length} 个 · pass ${rows.filter((r) => r.verdict === 'pass').length} · accepted-gap ${rows.filter((r) => r.verdict === 'accepted-gap').length} · gap ${gapRows.length}`
  );
  if (declaredNotInstantiated.length > 0) {
    console.warn(
      `[WARN] 常量表有 ${declaredNotInstantiated.length} 个名字未实例化（flag-gated / 影子工具）：${declaredNotInstantiated.join(', ')}`
    );
  }
  const accepted = rows.filter((r) => r.verdict === 'accepted-gap');
  if (accepted.length > 0) {
    console.log(
      `accepted-gap: ${accepted.map((r) => `${r.name}(${r.acceptedBy})`).join(', ')}`
    );
  }

  if (errors.length > 0) {
    console.error(`❌ [tool-governance] ${errors.length} 项失败：`);
    for (const e of errors) console.error(`  - ${e}`);
    return 1;
  }
  console.log('✅ 矩阵与事实源一致；执行入口台账完整');
  return 0;
}

// 仅作为脚本直接运行时执行（被单测 import 时不触发 `process.exit`）
if (import.meta.main) {
  process.exit(main());
}
