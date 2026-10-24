#!/usr/bin/env bun
/**
 * 内核纯净度门禁（P0 · `dev_docs/20261023/微内核-core-拆分方案.md` §5）
 *
 * 目的：把「`app/src/core/**` 只依赖 core 层」从**文档自觉**升级为**可执行断言**，
 * 为后续 `packages/kernel` 物理拆分（§4-P2）预留硬边界；即使不做拆分，也能阻止
 * 业务层被 IDE 自动补全"顺手"import 进内核。
 *
 * 断言集（阈值与取舍见方案 §5）：
 *   K01  静态 import（含 `import type`）的目标模块层必须为 `core`
 *   K02  动态 `import('…')` / `require('…')` 同上（R00-003 的动态盲区在此**硬拦**）
 *   K03  说明符不得解析到 `app/src/` 之外（工作区外，如 `../client/**`）
 *   K04  `core/spi/**` 不得 `export class`（端口目录只放契约，实现交给上层注入）
 *   K06  裸包说明符必须在白名单内（`scripts/kernel-allowed-deps.json`；目标：0 个 npm 依赖）
 *
 * **未登记层归属 ⇒ Error（fail-closed）**：`modules-to-layers.json` 里没有的模块，
 * 内核一旦引用就判红（此前只进 warning ⇒ 新增一个上层模块即可绕过门禁）。
 *
 * 为什么 K01 允许 `import type` 也算违规：物理拆分后内核必须能被独立安装，
 * **类型**跨层同样会拖入上层声明（建议稿 §一「Zero-Leakage」原话）。
 * 为什么需要 K06：内核对**第三方依赖**此前完全放行（`if (!spec.startsWith('.')) return null`）——
 * 而"内核可独立安装"最大的障碍正是 npm 依赖，不是层内 import（复审 A2）。
 *
 * 基线（棘轮，**只减不增**）：`.trae/architecture/kernel-purity-baseline.json`
 *   - 现存违规已登记 ⇒ 门禁为绿；新增违规 ⇒ 退出 1；
 *   - `maxEntries`：条目数硬上限。`--write-baseline` 只能**下调**该值 ⇒ 想加条目必须改 json，diff 一眼可见；
 *   - 已修复项未从基线删除 ⇒ 仅提示"可下调基线"（不判红，与 function-size 棘轮同口径）。
 *
 * 与 `scripts/lint-architecture.ts` 的关系：那里已有同源的 import 解析与层映射，但它是
 * 4527 行的单体类（解析器为实例方法、按 `srcPath` 绑定），直接复用需先做类抽取 ——
 * 属独立专项（方案 §5「复用或下沉」）。本脚本因此**自带最小扫描**，只解析说明符 + 查层表；
 * 收敛动作记录在方案 §11，不在本 PR 内做（避免顺带重构最敏感的门禁）。
 *
 * 覆盖点（自证见 `app/tests/gates/kernelPurityGate.test.ts`）：
 *   KP_REPO_ROOT / KP_BASELINE / KP_LAYERS / KP_KERNEL_ROOT 可覆盖 ⇒ 夹具工程可测。
 * 退出码：0 = 无新增泄漏；1 = 新增泄漏 / 基线不可读 / 扫描路径缺失。
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';

// ─────────────────────────── 纯函数（可离线断言） ───────────────────────────

/** 从源码文本里提取所有模块说明符（静态 / 类型 / 动态 / require） */
export interface SpecHit {
  spec: string;
  kind: 'static' | 'type' | 'dynamic' | 'require';
  /** 1-based 行号（供定位；按匹配位置换算） */
  line: number;
}

/**
 * 去注释（**只用于分析**，不保证语义级正确）：
 * 块注释与行注释都抹成等长空白（**保持行号与长度**，便于定位），
 * 从而避免"注释里写的 import 被当成依赖"（与 D-190 同类假阳性）。
 * 行注释排除 `://`，避免把 URL 之后的内容误判为注释。
 */
export function stripComments(text: string): string {
  const noBlock = text.replace(/\/\*[\s\S]*?\*\//g, (m) =>
    m.replace(/[^\n]/g, ' ')
  );
  return noBlock.replace(
    /(^|[^:\\])(\/\/[^\n]*)/g,
    (_m, pre: string, comment: string) => pre + ' '.repeat(comment.length)
  );
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === '\n') line++;
  }
  return line;
}

/** 提取说明符（注释已剥离） */
export function extractSpecifiers(rawText: string): SpecHit[] {
  const text = stripComments(rawText);
  const hits: SpecHit[] = [];
  const seen = new Set<string>();

  const push = (spec: string, kind: SpecHit['kind'], index: number): void => {
    const key = `${kind}:${spec}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push({ spec, kind, line: lineOf(text, index) });
  };

  // 静态：`… from 'x'`（import / export … from）
  // `\s+` 而非 `\s*`：避免把数组/对象里的字符串 `'from',` 误当成模块说明符
  //（2026-10-23 实测：`core/memory-host-sdk/query.ts` 的停用词数组即被误报为 `,\n  `）
  const fromRe = /\bfrom\s+['"]([^'"\n]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = fromRe.exec(text)) !== null) {
    const stmtStart = text.lastIndexOf('\n', m.index) + 1;
    const stmt = text.slice(stmtStart, m.index);
    push(
      m[1]!,
      /^\s*(import|export)\s+type\b/.test(stmt) ? 'type' : 'static',
      m.index
    );
  }

  // 副作用导入：`import 'x'`（无 from）
  const sideRe = /(^|[\n;])\s*import\s*['"]([^'"]+)['"]/g;
  while ((m = sideRe.exec(text)) !== null) {
    push(m[2]!, 'static', m.index);
  }

  // 动态：`import('x')` / `require('x')`
  const dynRe = /\b(import|require)\(\s*['"]([^'"]+)['"]/g;
  while ((m = dynRe.exec(text)) !== null) {
    push(m[2]!, m[1] === 'require' ? 'require' : 'dynamic', m.index);
  }

  return hits;
}

/** 内核内部相对引用的哨兵模块名（恒视为 core 层，不需进层表） */
export const KERNEL_SELF = '__kernel_self__';

/** 说明符 → 模块名（仅处理 `@modules/*` 与同源相对路径；裸包返回 null） */
export function resolveTargetModule(
  spec: string,
  filePath: string,
  srcRoot: string,
  kernelRoot?: string
): { module: string } | { outside: string } | null {
  const alias = /^@modules\/([^'"/]+)/.exec(spec);
  if (alias) return { module: alias[1]! };
  // P5：内核包名即自身（`@openliri/kernel` / `@openliri/kernel/<sub>`）⇒ 恒合法，
  // 与包内相对引用同口径。若不识别，它会被当成裸 npm 包误报 K06。
  if (spec === '@openliri/kernel' || spec.startsWith('@openliri/kernel/')) {
    return { module: KERNEL_SELF };
  }
  if (!spec.startsWith('.')) return null; // 裸包 / node: / bun:

  const resolved = resolve(dirname(filePath), spec);
  // 内核根优先（复审 B5）：内核搬到 `packages/kernel` 后，包内相对路径相对 `app/src`
  // 会是 `../..` ⇒ 若只以 srcRoot 判定，会被整片误判成 K03「工作区外」。
  if (kernelRoot && !relative(kernelRoot, resolved).startsWith('..')) {
    return { module: KERNEL_SELF };
  }
  const rel = relative(srcRoot, resolved);
  if (rel.startsWith('..') || rel.split(sep)[0] === '..')
    return { outside: spec };
  return { module: rel.split(sep)[0]! };
}

export type PurityRule = 'K01' | 'K02' | 'K03' | 'K04' | 'K06';

/** K06 白名单（`scripts/kernel-allowed-deps.json` 的形状） */
export interface AllowedDeps {
  /** 允许的运行时前缀（如 `node:` / `bun:`） */
  allowedPrefixes: string[];
  /** 是否允许裸写 Node 内建名（`fs` / `path` / `fs/promises`） */
  allowBareBuiltins: boolean;
  /** 显式允许的 npm 包（含作用域；`pkg/sub` 视为 `pkg` 允许） */
  allowedPackages: string[];
}

/** 默认白名单：零 npm 依赖 + 允许 Node/Bun 内建（内核当前的实测姿态） */
export const DEFAULT_ALLOWED_DEPS: AllowedDeps = {
  allowedPrefixes: ['node:', 'bun:'],
  allowBareBuiltins: true,
  allowedPackages: [],
};

const BARE_BUILTINS = new Set(
  builtinModules.map((m) => (m.startsWith('node:') ? m.slice(5) : m))
);

/**
 * 判定裸包说明符是否被白名单放行。
 *
 * - `node:*` / `bun:*`：命中 `allowedPrefixes` ⇒ 放行；
 * - 裸内建（`fs` / `path` / `fs/promises`）：`allowBareBuiltins` 且根名在内建集合 ⇒ 放行；
 * - 其余：命中 `allowedPackages` 才放行（`@scope/pkg/sub` 按 `@scope/pkg` 取根名）。
 */
export function isAllowedBareSpecifier(
  spec: string,
  allowed: AllowedDeps = DEFAULT_ALLOWED_DEPS
): boolean {
  if (allowed.allowedPrefixes.some((p) => spec.startsWith(p))) return true;

  const root = spec.startsWith('@')
    ? spec.split('/').slice(0, 2).join('/')
    : spec.split('/')[0]!;
  if (allowed.allowedPackages.includes(root)) return true;
  return allowed.allowBareBuiltins && BARE_BUILTINS.has(root);
}

export interface PurityViolation {
  rule: PurityRule;
  /** 仓库相对路径（正斜杠） */
  file: string;
  line: number;
  /** 违规目标：模块名 / 说明符（K04 为 `export class <Name>`） */
  target: string;
  message: string;
}

export interface AnalyzeInput {
  /** 绝对路径 + 源码文本 */
  files: ReadonlyArray<{ path: string; text: string }>;
  /** 模块名 → 层（来自 `scripts/modules-to-layers.json`） */
  layers: ReadonlyMap<string, string>;
  /** 绝对路径：`<repo>/app/src` */
  srcRoot: string;
  /** 绝对路径：`<repo>/app/src/core` */
  kernelRoot: string;
  /** 仓库根（用于输出相对路径） */
  repoRoot: string;
  /** K06 白名单（缺省 = 零 npm 依赖 + 允许 Node/Bun 内建） */
  allowedDeps?: AllowedDeps;
}

export interface AnalyzeResult {
  violations: PurityViolation[];
  /** 目标模块未在层表中登记 ⇒ **fail-closed**（main 里判红；不进基线） */
  unmapped: string[];
}

/** 纯分析：输入文件清单 ⇒ 违规列表（不做 IO） */
export function analyzeKernelPurity(input: AnalyzeInput): AnalyzeResult {
  const violations: PurityViolation[] = [];
  const unmapped = new Set<string>();
  const spiRoot = join(input.kernelRoot, 'spi') + sep;

  for (const file of input.files) {
    if (!file.path.startsWith(input.kernelRoot + sep)) continue;
    const relFile = relative(input.repoRoot, file.path).split(sep).join('/');
    const inSpi = file.path.startsWith(spiRoot);

    for (const hit of extractSpecifiers(file.text)) {
      const target = resolveTargetModule(
        hit.spec,
        file.path,
        input.srcRoot,
        input.kernelRoot
      );

      // K03：解析到 app/src 之外
      if (target && 'outside' in target) {
        violations.push({
          rule: 'K03',
          file: relFile,
          line: hit.line,
          target: hit.spec,
          message: `指向工作区外：${hit.spec}（内核不得 import app/src 之外的文件）`,
        });
        continue;
      }
      if (!target) {
        // 裸包：K06 白名单（`node:` / `bun:` / 内建 / 显式允许的 npm 包）
        const isAlias = hit.spec.startsWith('@modules/');
        const isRelative = hit.spec.startsWith('.');
        if (!isAlias && !isRelative) {
          const allowed = input.allowedDeps ?? DEFAULT_ALLOWED_DEPS;
          if (!isAllowedBareSpecifier(hit.spec, allowed)) {
            violations.push({
              rule: 'K06',
              file: relFile,
              line: hit.line,
              target: hit.spec,
              message:
                `内核引入第三方依赖「${hit.spec}」（白名单见 scripts/kernel-allowed-deps.json）` +
                ' —— 内核目标为 0 个 npm 依赖；确需引入须先评审并登记',
            });
          }
        }
        continue;
      }

      // 内核内部相对引用（拆分后 `packages/kernel` 内互相 import）⇒ 恒合法
      if (target.module === KERNEL_SELF) continue;

      const layer = input.layers.get(target.module);
      if (!layer) {
        unmapped.add(target.module);
        continue;
      }
      if (layer === 'core') continue;

      const rule: PurityRule =
        hit.kind === 'dynamic' || hit.kind === 'require' ? 'K02' : 'K01';
      violations.push({
        rule,
        file: relFile,
        line: hit.line,
        target: target.module,
        message:
          `内核引用上层模块「${target.module}」(layer=${layer})` +
          `（${hit.kind === 'type' ? 'import type' : hit.kind}）` +
          ' —— 应经 core/spi 端口由上层推送注入',
      });
    }

    // K04：端口目录只放契约，不放实现类
    // 口径收紧：只约束**真端口文件**（含 `export function resolve*`）——
    // `spi/` 下还放着 `CacheService.ts`（`TtlCache` 工具类，README 明确「不是端口」）等
    // 非端口文件，按"是否有 resolve 面"判定可避免用文件名白名单做例外。
    if (inSpi && /\bexport\s+function\s+resolve[A-Z]/.test(file.text)) {
      const classRe = /\bexport\s+class\s+([A-Za-z0-9_]+)/g;
      let cm: RegExpExecArray | null;
      while ((cm = classRe.exec(file.text)) !== null) {
        violations.push({
          rule: 'K04',
          file: relFile,
          line: lineOf(file.text, cm.index),
          target: `export class ${cm[1]}`,
          message: `core/spi 端口文件不得导出实现类「${cm[1]}」（只放 interface / type / 常量 / register / resolve）`,
        });
      }
    }
  }

  return { violations, unmapped: [...unmapped].sort() };
}

// ─────────────────────────────── CLI ───────────────────────────────

interface BaselineEntry {
  file: string;
  rule: PurityRule;
  target: string;
  /** 人读说明：为什么暂时登记（写基线时保留既有 note） */
  note?: string;
}
interface Baseline {
  version: number;
  /** 条目数硬上限（棘轮）：entries.length 不得超过它；`--write-baseline` 只能下调 */
  maxEntries?: number;
  entries: BaselineEntry[];
}

const repoRoot = process.env.KP_REPO_ROOT
  ? resolve(process.env.KP_REPO_ROOT)
  : resolve(import.meta.dir, '..');
const BASELINE = process.env.KP_BASELINE
  ? resolve(process.env.KP_BASELINE)
  : resolve(repoRoot, '.trae/architecture/kernel-purity-baseline.json');
const LAYERS_FILE = process.env.KP_LAYERS
  ? resolve(process.env.KP_LAYERS)
  : resolve(repoRoot, 'scripts/modules-to-layers.json');
const ALLOWED_DEPS_FILE = process.env.KP_ALLOWED_DEPS
  ? resolve(process.env.KP_ALLOWED_DEPS)
  : resolve(repoRoot, 'scripts/kernel-allowed-deps.json');
const srcRoot = resolve(repoRoot, 'app/src');
const kernelRoot = process.env.KP_KERNEL_ROOT
  ? resolve(process.env.KP_KERNEL_ROOT)
  : resolve(repoRoot, 'packages/kernel/src/core');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === '.git') continue;
      walk(full, out);
    } else if (name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

function loadLayers(): Map<string, string> {
  if (!existsSync(LAYERS_FILE)) {
    console.error(`层表不存在: ${LAYERS_FILE}`);
    process.exit(1);
  }
  const raw = JSON.parse(readFileSync(LAYERS_FILE, 'utf8')) as {
    modules?: Record<string, { layer?: string }>;
  };
  const map = new Map<string, string>();
  for (const [name, spec] of Object.entries(raw.modules ?? {})) {
    if (spec?.layer) map.set(name, spec.layer);
  }
  if (map.size === 0) {
    console.error('层表为空（解析失败？）');
    process.exit(1);
  }
  return map;
}

function loadBaseline(): Baseline {
  if (!existsSync(BASELINE)) return { version: 1, entries: [] };
  try {
    return JSON.parse(readFileSync(BASELINE, 'utf8')) as Baseline;
  } catch (err) {
    console.error(`基线 JSON 解析失败: ${String(err)}`);
    process.exit(1);
  }
}

/** K06 白名单（缺失 ⇒ fail-closed 到默认值，并提示） */
function loadAllowedDeps(): AllowedDeps {
  if (!existsSync(ALLOWED_DEPS_FILE)) {
    console.log(
      `ℹ️ 未找到 K06 白名单 ${relative(repoRoot, ALLOWED_DEPS_FILE)} ⇒ 使用默认（零 npm 依赖 + Node/Bun 内建）`
    );
    return DEFAULT_ALLOWED_DEPS;
  }
  try {
    const raw = JSON.parse(
      readFileSync(ALLOWED_DEPS_FILE, 'utf8')
    ) as Partial<AllowedDeps>;
    return {
      allowedPrefixes:
        raw.allowedPrefixes ?? DEFAULT_ALLOWED_DEPS.allowedPrefixes,
      allowBareBuiltins:
        raw.allowBareBuiltins ?? DEFAULT_ALLOWED_DEPS.allowBareBuiltins,
      allowedPackages:
        raw.allowedPackages ?? DEFAULT_ALLOWED_DEPS.allowedPackages,
    };
  } catch (err) {
    console.error(`K06 白名单 JSON 解析失败（fail-closed）: ${String(err)}`);
    process.exit(1);
  }
}

function main(): void {
  if (!existsSync(kernelRoot)) {
    console.error(`内核根目录不存在: ${kernelRoot}`);
    process.exit(1);
  }

  const layers = loadLayers();
  const allowedDeps = loadAllowedDeps();
  const files = walk(kernelRoot).map((path) => ({
    path,
    text: readFileSync(path, 'utf8'),
  }));
  const { violations, unmapped } = analyzeKernelPurity({
    files,
    layers,
    srcRoot,
    kernelRoot,
    repoRoot,
    allowedDeps,
  });

  const key = (v: { file: string; rule: string; target: string }): string =>
    `${v.file}|${v.rule}|${v.target}`;

  // `--write-baseline`：把**当前**违规写成基线（棘轮重新冻结；保留既有 note 便于人读）
  if (process.argv.includes('--write-baseline')) {
    const previousBaseline = loadBaseline();
    const previous = new Map(previousBaseline.entries.map((e) => [key(e), e]));
    const entries = violations
      .map((v) => ({
        file: v.file,
        rule: v.rule,
        target: v.target,
        ...(previous.get(key(v))?.note
          ? { note: previous.get(key(v))!.note }
          : {}),
      }))
      .sort((a, b) => key(a).localeCompare(key(b)));
    // 棘轮：maxEntries 只能下调（想放宽必须手改 json，diff 里一眼可见）
    const maxEntries =
      previousBaseline.maxEntries === undefined
        ? entries.length
        : Math.min(previousBaseline.maxEntries, entries.length);
    const payload: Baseline = { version: 1, maxEntries, entries };
    writeFileSync(BASELINE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    console.log(
      `已写入基线 ${entries.length} 条（maxEntries=${maxEntries}）: ${BASELINE}`
    );
    // K07 的基线独立成文件（消费方深路径 ≠ 内核自身泄漏），同一次 --write-baseline 一并冻结
    checkK07DeepPaths();
    return;
  }

  const baseline = loadBaseline();
  const baselined = new Set(baseline.entries.map(key));
  const current = new Set(violations.map(key));

  const added = violations.filter((v) => !baselined.has(key(v)));
  const shrinkable = baseline.entries.filter((e) => !current.has(key(e)));
  const overCap =
    baseline.maxEntries !== undefined &&
    baseline.entries.length > baseline.maxEntries;

  console.log('=== 内核纯净度门禁（P0 · K01–K04/K06）===');
  console.log(
    `内核根 ${relative(repoRoot, kernelRoot).split(sep).join('/')} · 扫描 ${files.length} 文件 · 基线 ${baseline.entries.length} 条` +
      (baseline.maxEntries !== undefined
        ? `（上限 ${baseline.maxEntries}）`
        : '')
  );
  console.log('----------------------------------------');

  if (shrinkable.length > 0) {
    console.log('ℹ️ 基线项已无违规（请下调基线锁定成果）:');
    for (const e of shrinkable)
      console.log(`  - ${e.file} :: ${e.rule} → ${e.target}`);
  }

  if (unmapped.length > 0) {
    console.error(
      `❌ 未登记层归属的目标模块 ${unmapped.length} 个（fail-closed；请在 scripts/modules-to-layers.json 补齐）：${unmapped.join(', ')}`
    );
    process.exit(1);
  }

  if (overCap) {
    console.error(
      `❌ 基线条目数超上限：${baseline.entries.length} > maxEntries=${baseline.maxEntries}（棘轮只允许下调）`
    );
    process.exit(1);
  }

  if (added.length > 0) {
    console.error(`❌ 新增内核泄漏 ${added.length} 处（基线只允许减少）:`);
    for (const v of added) {
      console.error(`  - ${v.rule} ${v.file}:${v.line} → ${v.target}`);
      console.error(`      ${v.message}`);
    }
    process.exit(1);
  }

  console.log(
    `✅ 未登记模块 0 · 三方依赖白名单内 · 无新增内核泄漏（违规合计 ${violations.length} 处，均已登记）`
  );

  checkK07DeepPaths();
}

/**
 * **内核公开子路径 —— 唯一事实源**（方案 §4-P5 补，2026-10-23/24 逐组实测后裁定）。
 *
 * 三处消费者必须与此一致（`tests/gates/kernelPurityGate.test.ts` 有断言防漂移）：
 *   ① 本文件的 K07 门禁（`ALLOWED`）；② `app/tsconfig.json` 的显式 path 映射；③ `packages/kernel/package.json` 的 `exports`。
 *
 * 入列标准：**实测「改走桶 / 改走 app 门面」的代价大于收益**，而不是「用得多」。
 * 每个条目的理由都必须可复现，否则就是静默放宽门禁（AR-3）：
 *
 *   - `paths` / `identity` / `external` / `spi` / `events` —— Q2 原始 5 项（用量 94%）；
 *   - `loggerFacade` —— 45 处消费方；改走 `@modules/monitoring` barrel 会把 ≈657KB
 *     依赖无条件拉进启动面（该文件注释的既有实测），改 `monitoring/logs/Logger` 是
 *     另一套实现 ⇒ 行为变更。它是**零依赖叶子门面**，本就该是公开入口。
 *   - `errors` / `errorHandler` / `errorCodes` —— app 侧 `error/*` 门面文件的**转出源**；
 *     门面本身必须保留深路径，否则「唯一入口」无处可转出。
 *   - `pricing` —— `@modules/cost` 桶含 React hooks + 20 余个成本类，且不导出
 *     `DEFAULT_MODEL_PRICING` / `projectRegistryPricing` / `BillingMode` / `TimeBasedPrice`；
 *     退到 `cost/ModelPricing` 会被 R03-002 判违规。
 *   - `sandboxPermission` —— `@modules/sandbox` 属 **app 层**，5 个 infra/service 消费方
 *     改走它会构成 `infra → app` 倒挂。
 *   - 批次 5/6 的 13 项见下方逐条注释（共同点：进桶会涨启动面，消费方又无法再下沉）。
 */
export const KERNEL_PUBLIC_SUBPATHS = [
  // Q2 原始五项
  'paths',
  'identity',
  'external',
  'spi',
  'events',
  // P5 补（实测无更优替代）
  'loggerFacade',
  'errors',
  'errorHandler',
  'errorCodes',
  'pricing',
  'sandboxPermission',
  // `http-server.ts` 明写「静态依赖仅限 core 的**零依赖**模块」，为**不与 repl.ts 形成循环依赖**；
  // 这两个模块自身零 import（`ports` 只有常量 + 纯函数，`httpPortFallback` 同），
  // 改走桶会把它拉进整条内核求值链，与该注释的约束直接冲突 ⇒ 合法公开子路径。
  'ports',
  'httpPortFallback',
  // `core/ids` 只依赖 `node:crypto`。两个消费方**都有明确的"不与内核求值链耦合"契约**：
  // `session/storage/SessionStoragePortable.ts` 要求"零 Liri 内部依赖"（可移植存储），
  // `utils/common.ts` 是极热底层工具（引桶＝把整条内核求值提前到它首次被 import 的时刻）。
  'ids',
  // 批次 5：以下模块**不进桶**，而是声明为公开子路径。
  // 理由（实测，2026-10-24）：把它们加进桶后 `lint:startup-graph` 从 281 涨到 **285（+4 eager 文件）**
  // —— 桶被启动期静态加载，进桶即提前求值。子路径则只在真正用到时才求值 ⇒ 同样收敛 K07、零启动成本。
  // 五者自身依赖都只到 core 内部（paths / spi / loggerFacade）或零 import，无 app 层倒挂。
  'taskStatus',
  'knowledge-types',
  'mediaRoots',
  'lazySingleton',
  'LazyModuleStrategy',
  // 批次 6（终局）：最后 9 个前缀。同样不能走桶，而消费方是 app 层的门面/接线点，无法再下沉。
  // 匹配粒度为**首段**（`idle/…` / `connections/…` 整目录随之公开），这是 K07 既有口径。
  'DependencyRegistry', // 依赖注册表单例：channels / permission / mcp 三处接线 + app 门面
  'SessionSpanTracer', // 会话级 span 追踪：通道链路 + app 门面
  'tracingFacade', // OTel 追踪门面（`resolveOTelTracing` 的薄封装）
  'idle', // 空转伸缩监视器（仅 ChatOrchestrator 动态导入）
  'connections', // 连接注册表（main 启动期动态导入）
  'instanceLock', // 单实例锁：main 解析/写入/发布端点
  'profilerFacade', // 启动剖析门面（`resolveStartupProfiler` 的薄封装）
  'abortReason', // 中断原因契约（app `error/abortReason` 门面的转出源）
  'orchestrationEvents', // 编排事件契约（app `types/orchestrationEvents` 门面的转出源）
  // 弃用告警工具：内核叶子（`process.emitWarning` 薄封装）。当前唯一消费方是
  // `tests/core/deprecatedCoreModules.test.ts`（自证「接线不丢」）；不进桶是因为它没有任何生产消费方，
  // 进桶会让每次启动都求值一个用不到的模块。
  'deprecationNotice',
] as const;

/**
 * **K07 深路径禁令**（方案 §4-P5，复审 B3 编号归属）。
 *
 * 判据：消费方（`app/src` + `app/packages`）对内核的导入**只允许**
 * ① 桶 `@openliri/kernel`；② `KERNEL_PUBLIC_SUBPATHS` 里的公开子路径（**首段匹配**）。
 * 其余 `@openliri/kernel/<sub>` 一律记违规，存量进棘轮（只减不增；当前 0）。
 *
 * 为什么必须开这条门禁：`exports` 只声明公开子路径，其余深路径在**独立发布后**会直接解析失败；
 * 而 `tsconfig paths` 若留通配，会让它在仓内**看起来一直可用**（假绿）。
 * 棘轮语义与 K01–K06 一致：新增即红，想放宽必须手改基线 json（diff 可见）。
 */
function checkK07DeepPaths(): void {
  const DEEP_BASELINE = resolve(
    repoRoot,
    '.trae/architecture/kernel-deep-path-baseline.json'
  );
  // 白名单唯一事实源见模块级 `KERNEL_PUBLIC_SUBPATHS`（不在函数内维护第二份清单）
  const ALLOWED = new Set<string>(KERNEL_PUBLIC_SUBPATHS);
  /** 消费方源码根（生产面；不含 npm 包外壳与历史归档） */
  const consumerRoots = [
    resolve(repoRoot, 'app/src'),
    resolve(repoRoot, 'app/packages'),
  ];
  const DEEP_IMPORT =
    /(?:from\s+|import\(\s*|require\(\s*)['"]@openliri\/kernel\/([^'"]+)['"]/g;
  /**
   * **相对路径直连内核源码**（2026-10-24 补漏）：K07 原先只匹配 `@openliri/kernel/…`，
   * 于是 `import x from '../../packages/kernel/src/core/paths'` 这种写法**完全绕过门禁**
   * —— 它既不受白名单约束，也不随 `exports` 收敛而失效。生产面实测 0 处，此处把口子封上。
   */
  const REL_IMPORT = /(?:from\s+|import\(\s*|require\(\s*)['"](\.[^'"]+)['"]/g;
  const KERNEL_SRC = resolve(repoRoot, 'packages/kernel/src');

  const hits: Array<{ file: string; subpath: string }> = [];
  for (const abs of consumerRoots.flatMap((root) =>
    existsSync(root) ? walk(root) : []
  )) {
    if (!abs.endsWith('.ts') && !abs.endsWith('.tsx')) continue;
    const text = readFileSync(abs, 'utf8');
    let m: RegExpExecArray | null;
    DEEP_IMPORT.lastIndex = 0;
    while ((m = DEEP_IMPORT.exec(text)) !== null) {
      // 说明符可能带 `.js`（ESM 写法）⇒ 先去后缀再取首段
      const subpath = m[1].replace(/\.js$/, '').split('/')[0];
      if (ALLOWED.has(subpath)) continue;
      hits.push({
        file: relative(repoRoot, abs).split(sep).join('/'),
        subpath: m[1],
      });
    }
    // 相对路径直连内核源码 ⇒ 同样判违规（绕过白名单 / exports）
    REL_IMPORT.lastIndex = 0;
    let r: RegExpExecArray | null;
    while ((r = REL_IMPORT.exec(text)) !== null) {
      const spec = r[1];
      const kernel = KERNEL_SRC.split(sep).join('/');
      const target = resolve(dirname(abs), spec).split(sep).join('/');
      if (!target.startsWith(`${kernel}/`)) continue;
      hits.push({
        file: relative(repoRoot, abs).split(sep).join('/'),
        subpath: `[相对] ${spec}`,
      });
    }
  }

  const key = (h: { file: string; subpath: string }): string =>
    `${h.file}|${h.subpath}`;
  const sorted = hits
    .filter((h, i) => hits.findIndex((x) => key(x) === key(h)) === i)
    .sort((a, b) => key(a).localeCompare(key(b)));

  const loadDeep = (): {
    maxEntries?: number;
    entries: Array<{ file: string; subpath: string }>;
  } =>
    existsSync(DEEP_BASELINE)
      ? (JSON.parse(readFileSync(DEEP_BASELINE, 'utf8')) as {
          maxEntries?: number;
          entries: Array<{ file: string; subpath: string }>;
        })
      : { entries: [] };

  if (process.argv.includes('--write-baseline')) {
    const prev = loadDeep();
    const maxEntries =
      prev.maxEntries === undefined
        ? sorted.length
        : Math.min(prev.maxEntries, sorted.length);
    writeFileSync(
      DEEP_BASELINE,
      `${JSON.stringify({ version: 1, maxEntries, entries: sorted }, null, 2)}\n`,
      'utf8'
    );
    console.log(
      `已写入 K07 深路径基线 ${sorted.length} 条（maxEntries=${maxEntries}）`
    );
    return;
  }

  const baseline = loadDeep();
  const baselined = new Set(baseline.entries.map(key));
  const added = sorted.filter((h) => !baselined.has(key(h)));
  const shrinkable = baseline.entries.filter(
    (e) => !sorted.some((h) => key(h) === key(e))
  );

  console.log(
    `K07 深路径：${sorted.length} 处（基线 ${baseline.entries.length}）· 白名单 ${[...ALLOWED].join('/')}`
  );
  if (shrinkable.length > 0) {
    console.log(
      `ℹ️ K07 基线项已不存在（请下调锁定成果）: ${shrinkable.length} 条`
    );
  }
  // 与 K01–K06 同口径的硬上限：entries 不得多于 maxEntries（想放宽必须手改 json）。
  // 少了这一条，`--write-baseline` 之后仍可能停在「条目 > 上限」的矛盾态而静默放行。
  if (
    baseline.maxEntries !== undefined &&
    baseline.entries.length > baseline.maxEntries
  ) {
    console.error(
      `❌ K07 基线条目数超上限：${baseline.entries.length} > maxEntries=${baseline.maxEntries}（棘轮只允许下调）`
    );
    process.exit(1);
  }
  if (added.length > 0) {
    console.error(
      `❌ K07 新增内核深路径 ${added.length} 处（应改走桶或白名单子路径）:`
    );
    for (const h of added)
      console.error(
        `  - ${h.file} → ${
          h.subpath.startsWith('[相对]')
            ? h.subpath
            : `@openliri/kernel/${h.subpath}`
        }`
      );
    process.exit(1);
  }
}

// 仅在被当作脚本执行时跑 main（测试通过 import 复用纯函数）
if (import.meta.main) {
  main();
}
