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
 *   K06  裸包说明符必须在白名单内（`scripts/kernel-allowed-deps.json`；目标：**零 I/O + 0 个 npm 依赖**）
 *        —— 判据自 v0.4.x 起由「可独立安装」收紧为「零 I/O」：只放行 `node:path` / `node:crypto` /
 *        `node:async_hooks` 三个**零 I/O** 内建；`fs` / `fs/promises` / `child_process` / `os` 等
 *        一律判违规（存量登记见 `scripts/kernel-io-allowlist.json`，只减不增）。
 *   K07  消费方深路径禁令（只允许桶 + `KERNEL_PUBLIC_SUBPATHS`；基线 0）
 *   K08  内核体量棘轮（`.ts` 文件数 / 非空行数 / 顶层子目录数，只减不增）
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

  // 动态：`import('x')` / `require('x')` / 模板拼接 `` import(`./x/${n}`) ``
  // 模板一种**必须**能被看见：它是 R00-003 动态盲区里最容易被用来绕 K02 的写法
  // （复审 B1："含拼接"若匹配不到，K02 的宣称就落空）。
  const dynRe =
    /\b(import|require)\(\s*(?:'([^'\n]+)'|"([^"\n]+)"|`([^`\n]*)`)/g;
  while ((m = dynRe.exec(text)) !== null) {
    const spec = m[2] ?? m[3] ?? m[4] ?? '';
    push(spec, m[1] === 'require' ? 'require' : 'dynamic', m.index);
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

/** 默认白名单：零 npm 依赖 + 仅零 I/O 的 Node 内建（K06 收紧后的实测姿态） */
export const DEFAULT_ALLOWED_DEPS: AllowedDeps = {
  allowedPrefixes: ['node:path', 'node:crypto', 'node:async_hooks'],
  allowBareBuiltins: false,
  allowedPackages: [],
};

/**
 * **内核 I/O 根名（AC-21 永久禁止面）**：说明符去掉 `node:` / `bun:` 前缀后取根名，
 * 命中本表即判「内核 I/O 违规」。裸内建与带前缀写法同罪（`fs` ≡ `node:fs`）。
 */
export const FORBIDDEN_IO_ROOTS: ReadonlySet<string> = new Set([
  'fs',
  'child_process',
  'os',
  'net',
  'http',
  'https',
  'dgram',
  'worker_threads',
  'sqlite',
]);

/** 说明符的 I/O 根名；非 I/O 返回 null */
export function ioRootOf(spec: string): string | null {
  const bare = spec.replace(/^(node|bun):/, '');
  const root = bare.split('/')[0] ?? '';
  return FORBIDDEN_IO_ROOTS.has(root) ? root : null;
}

/**
 * **逐文件 I/O 白名单**（`scripts/kernel-io-allowlist.json`，AC-02/AC-05）。
 *
 * 与纯度基线的分工（双账本，`§12 指标假达成`）：
 *   - 本表 = **意图账本**：「这个文件为什么可以有 I/O、P1 迁去哪」；只减不增；
 *   - 纯度基线 = **存量账本**：把当前 (file, rule, target) 冻住，只允许减少。
 *
 * 二者缺一都会失真：只有基线 ⇒ 新增 I/O 只要手改基线就能进；只有本表 ⇒ 存量违规无法消化。
 */
export interface KernelIoAllowlistEntry {
  /** 仓库相对路径（正斜杠，含 `.ts`） */
  file: string;
  /** 该文件被登记的 I/O 说明符（逐条，`fs` 与 `fs/promises` 分别登记） */
  specifiers: string[];
  /** P1 迁移目标落点（如 `infra/runtime-host`） */
  target: string;
  /** 为什么暂时留存 */
  note?: string;
}

const BARE_BUILTINS = new Set(
  builtinModules.map((m) => (m.startsWith('node:') ? m.slice(5) : m))
);

/**
 * K04 **显式豁免表**：`spi/` 下确属**工具**（而非端口契约）的文件。
 *
 * 键 = 相对内核根（`packages/kernel/src/core`）的 POSIX 路径；值 = 为什么它可以有实现类。
 *
 * 为什么改成点名豁免（复审 B2）：旧口径用「文件里有 `export function resolve*`」判断
 * "是不是端口"，于是**把 resolve 改名、或把实现类挪进没有 resolve 的文件**即可绕过
 * K04。现在 `spi/**` 一律无条件检查 `export class`，确属工具的文件必须在此**显式登记**
 * —— 新增豁免在 diff 里一眼可见，且必须写理由。
 */
export const K04_EXEMPTIONS: Readonly<Record<string, string>> = {
  'spi/CacheService.ts':
    'TtlCache 是纯工具类（`spi/README.md` 明确「不是端口」），不参与注入；端口契约在其它 spi 文件',
};

/**
 * 找出**幽灵豁免**（登记了但文件已不存在）—— 只告警不判红：
 * 文件改名后新文件仍会被 K04 正常检查（不会因此放宽），但残留条目会误导后来者。
 */
export function findDanglingExemptions(
  existingKernelRelativePaths: readonly string[],
  exemptions: Readonly<Record<string, string>> = K04_EXEMPTIONS
): string[] {
  const seen = new Set(existingKernelRelativePaths);
  return Object.keys(exemptions)
    .filter((key) => !seen.has(key))
    .sort();
}

/**
 * 判定裸包说明符是否被白名单放行。
 *
 * - 命中 `allowedPrefixes`（如 `node:path`）⇒ 放行；裸写同根名（`path`）等价放行；
 * - `allowBareBuiltins` + 根名在内建集合 ⇒ 放行（**当前配置为 false**：不再"全部裸内建放行"）；
 * - 其余：命中 `allowedPackages` 才放行（`@scope/pkg/sub` 按 `@scope/pkg` 取根名）。
 */
export function isAllowedBareSpecifier(
  spec: string,
  allowed: AllowedDeps = DEFAULT_ALLOWED_DEPS
): boolean {
  if (allowed.allowedPrefixes.some((p) => spec.startsWith(p))) return true;

  // 裸内建与带前缀写法**同权**：白名单登记了 `node:path` 即等价放行裸写 `path`（同一模块，
  // Bun/Node 两种写法可互换）。反向不成立 —— 未登记的根名（`fs` / `os` / `child_process`）
  // 即使裸写也照样判红，`allowBareBuiltins` 不再提供"全部裸内建放行"的后门。
  const bareRoot = spec.split('/')[0] ?? '';
  if (
    !spec.startsWith('@') &&
    allowed.allowedPrefixes.includes(`node:${bareRoot}`)
  )
    return true;

  const root = spec.startsWith('@')
    ? spec.split('/').slice(0, 2).join('/')
    : bareRoot;
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
      // K02 补盲（复审 B1）：模板拼接的动态导入 ⇒ 说明符静态不可证 ⇒ fail-closed
      if (hit.spec.includes('${')) {
        violations.push({
          rule: 'K02',
          file: relFile,
          line: hit.line,
          target: hit.spec,
          message: `动态导入含模板拼接（静态不可证）：${hit.spec} —— 请改为字面量说明符，或经 core/spi 端口由上层注入`,
        });
        continue;
      }

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
        // 裸包：K06 白名单（零 I/O 内建前缀 / 显式允许的 npm 包；裸内建默认**不放行**）
        const isAlias = hit.spec.startsWith('@modules/');
        const isRelative = hit.spec.startsWith('.');
        if (!isAlias && !isRelative) {
          const allowed = input.allowedDeps ?? DEFAULT_ALLOWED_DEPS;
          if (!isAllowedBareSpecifier(hit.spec, allowed)) {
            const ioRoot = ioRootOf(hit.spec);
            violations.push({
              rule: 'K06',
              file: relFile,
              line: hit.line,
              target: hit.spec,
              message: ioRoot
                ? `内核 I/O 违规「${hit.spec}」（根名 ${ioRoot}）—— 内核判据为零 I/O；` +
                  '存量须登记 scripts/kernel-io-allowlist.json，P1 迁出内核'
                : `内核引入第三方依赖「${hit.spec}」（白名单见 scripts/kernel-allowed-deps.json）` +
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

    // K04：端口目录只放契约，不放实现类。
    //
    // **无条件扫全体 `spi/**`**（复审 B2）：旧口径以「文件里有 `export function resolve*`」
    // 作为"是不是端口"的前置判据 ⇒ 把 resolve 改名、或把实现类挪进没有 resolve 的文件，
    // 即可让 K04 失效。现在不再前置判定，`export class` 出现在 `spi/` 下**一律报**；
    // 确属工具（非端口）的文件走**显式豁免表**（见 K04_EXEMPTIONS），理由写在表里。
    const relFromKernel = relative(input.kernelRoot, file.path)
      .split(sep)
      .join('/');
    if (inSpi && !(relFromKernel in K04_EXEMPTIONS)) {
      const classRe = /\bexport\s+class\s+([A-Za-z0-9_]+)/g;
      let cm: RegExpExecArray | null;
      while ((cm = classRe.exec(file.text)) !== null) {
        violations.push({
          rule: 'K04',
          file: relFile,
          line: lineOf(file.text, cm.index),
          target: `export class ${cm[1]}`,
          message: `core/spi 不得导出实现类「${cm[1]}」（只放 interface / type / 常量 / register / resolve；确属工具请登记 K04_EXEMPTIONS）`,
        });
      }
    }
  }

  return { violations, unmapped: [...unmapped].sort() };
}

/** `checkKernelIoAllowlist` 的结果 */
export interface KernelIoAllowlistReport {
  /** 有 I/O 违规但未被 allowlist 登记 ⇒ **fail-closed**（即使已在基线里也不行） */
  unregistered: PurityViolation[];
  /** 登记了但没有对应违规 ⇒ 幽灵条目（只告警；同 K04 豁免表卫生） */
  dangling: string[];
  /** 已登记且实际存在的 I/O 违规数 */
  registered: number;
}

/**
 * **I/O 台账校验**：把「实际 I/O 违规」与「逐文件白名单」对上账。
 *
 * 为什么不能在基线之外只靠 allowlist：基线是按 `(file, rule, target)` 冻结的存量，
 * 只保证「不新增」，不保证「新增的 I/O 有人评审过」。本函数补上后者：
 * 任何未登记的 I/O 违规**即使写进基线也判红**（防「手改基线即放行」，§12 指标假达成）。
 */
export function checkKernelIoAllowlist(
  violations: readonly PurityViolation[],
  entries: readonly KernelIoAllowlistEntry[]
): KernelIoAllowlistReport {
  const declared = new Set(
    entries.flatMap((e) => e.specifiers.map((s) => `${e.file}|${s}`))
  );
  const ioViolations = violations.filter((v) => ioRootOf(v.target) !== null);
  const actual = new Set(ioViolations.map((v) => `${v.file}|${v.target}`));
  const unregistered = ioViolations.filter(
    (v) => !declared.has(`${v.file}|${v.target}`)
  );
  const dangling = [...declared].filter((k) => !actual.has(k)).sort();
  return {
    unregistered,
    dangling,
    registered: ioViolations.length - unregistered.length,
  };
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
const IO_ALLOWLIST_FILE = process.env.KP_IO_ALLOWLIST
  ? resolve(process.env.KP_IO_ALLOWLIST)
  : resolve(repoRoot, 'scripts/kernel-io-allowlist.json');
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

/** 逐文件 I/O 白名单（缺失 ⇒ 空表；有 I/O 违规时由 `enforceIoAllowlist` 判红） */
function loadIoAllowlist(): {
  entries: KernelIoAllowlistEntry[];
  found: boolean;
} {
  if (!existsSync(IO_ALLOWLIST_FILE)) return { entries: [], found: false };
  try {
    const raw = JSON.parse(readFileSync(IO_ALLOWLIST_FILE, 'utf8')) as {
      entries?: KernelIoAllowlistEntry[];
    };
    if (!Array.isArray(raw.entries)) {
      throw new Error('缺少 entries 数组');
    }
    return { entries: raw.entries, found: true };
  } catch (err) {
    console.error(`I/O 白名单 JSON 解析失败（fail-closed）: ${String(err)}`);
    process.exit(1);
  }
}

/**
 * I/O 台账强制（AC-02）：未登记即判红 —— **在写基线之前**执行，
 * 否则「加一处 I/O → `--write-baseline`」就能把它合法化（§12 指标假达成）。
 */
function enforceIoAllowlist(violations: readonly PurityViolation[]): void {
  const allowlist = loadIoAllowlist();
  const report = checkKernelIoAllowlist(violations, allowlist.entries);
  for (const d of report.dangling) {
    console.warn(
      `⚠️ kernel-io-allowlist 登记项已无对应违规（请清理）: ${d.replace('|', ' → ')}`
    );
  }
  if (report.unregistered.length > 0) {
    console.error(
      `❌ 内核 I/O 未登记 ${report.unregistered.length} 处（fail-closed；登记表 scripts/kernel-io-allowlist.json）:`
    );
    for (const v of report.unregistered) {
      console.error(`  - ${v.file}:${v.line} → ${v.target}`);
    }
    if (!allowlist.found) {
      console.error(
        `   未找到 ${relative(repoRoot, IO_ALLOWLIST_FILE)} —— I/O 判据（零 I/O）要求逐文件登记，缺表不得当成零违规`
      );
    }
    process.exit(1);
  }
  if (report.registered > 0) {
    console.log(
      `内核 I/O 台账：${report.registered} 处已登记（scripts/kernel-io-allowlist.json，P1 迁出后应归零）`
    );
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

  enforceIoAllowlist(violations);

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
    checkK08Size(files);
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

  checkK04ExemptionHygiene(files);
  checkK07DeepPaths();
  checkK08Size(files);
}

/**
 * K04 豁免表卫生（**只告警**）：登记的文件必须真实存在。
 *
 * 为什么只告警：豁免失效不会放宽门禁（文件不存在 ⇒ 没有 class 可漏），
 * 但残留条目会让人误以为"某文件仍被豁免"。文件改名后新文件仍会被 K04 正常检查。
 */
function checkK04ExemptionHygiene(
  files: ReadonlyArray<{ path: string }>
): void {
  const rels = files.map((f) =>
    relative(kernelRoot, f.path).split(sep).join('/')
  );
  const dangling = findDanglingExemptions(rels);
  if (dangling.length > 0) {
    console.warn(
      `⚠️ K04 豁免指向不存在的文件：${dangling.join(', ')} —— 请清理 K04_EXEMPTIONS`
    );
  }
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
  // Q2 原始五项（`paths` / `external` 已随 P1 去 I/O 迁出内核 ⇒ `@modules/environment` / `@modules/external`）
  'identity',
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
  'lazySingleton',
  'LazyModuleStrategy',
  // 批次 6（终局）：最后 9 个前缀。同样不能走桶，而消费方是 app 层的门面/接线点，无法再下沉。
  // 匹配粒度为**首段**（`connections/…` 整目录随之公开），这是 K07 既有口径。
  'DependencyRegistry', // 依赖注册表单例：channels / permission / mcp 三处接线 + app 门面
  'SessionSpanTracer', // 会话级 span 追踪：通道链路 + app 门面
  'tracingFacade', // OTel 追踪门面（`resolveOTelTracing` 的薄封装）
  'connections', // 连接注册表（main 启动期动态导入）
  'profilerFacade', // 启动剖析门面（`resolveStartupProfiler` 的薄封装）
  'abortReason', // 中断原因契约（app `error/abortReason` 门面的转出源）
  'orchestrationEvents', // 编排事件契约（app `types/orchestrationEvents` 门面的转出源）
  // 弃用告警工具：内核叶子（`process.emitWarning` 薄封装）。当前唯一消费方是
  // `packages/kernel/tests/deprecatedCoreModules.test.ts`（自证「接线不丢」；2026-10-25 迁入包内）；
  // 不进桶是因为它没有任何生产消费方，
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

/**
 * **K08 体量棘轮**（`dev_docs/20261023/core-减重盘点清单.md` §6，2026-10-24 落码）。
 *
 * 为什么需要：K01–K07 只管「内核不许依赖上层、不许开深路径」，**不管内核自己越长越大**。
 * 减重（方案 A 18 文件 + 方案 B 10 文件 + auto-reply 6 文件）之后若没有硬上限，
 * 下一次「顺手把新子模块塞进 core」会静默回涨 —— 与 `lint:startup-graph` 同属"只减不增"。
 *
 * 指标：`core` 树内 ① `.ts` 文件数 ② 非空行数 ③ **顶层**子目录数。
 * 三方向各管一类回涨：拆分出更多文件 / 文件本身膨胀 / 新增子系统。
 * 三方依赖数**不在此重复计**：K06 白名单已把它硬控在 1 个（`@opentelemetry/api`）。
 *
 * 语义与既有棘轮一致：`--write-baseline` 只能把上限**下调**（`Math.min`）；
 * 想放宽必须手改 `.trae/architecture/kernel-size-baseline.json`，让 diff 里一眼可见。
 * 基线缺失 ⇒ **fail-closed**（AR-3：不得把"没有基线"当成"零违规"）。
 */
const SIZE_BASELINE = resolve(
  repoRoot,
  '.trae/architecture/kernel-size-baseline.json'
);

interface SizeMetrics {
  files: number;
  loc: number;
  dirs: number;
}

function collectSizeMetrics(
  files: Array<{ path: string; text: string }>
): SizeMetrics {
  const loc = files.reduce(
    (sum, f) =>
      sum + f.text.split('\n').filter((line) => line.trim() !== '').length,
    0
  );
  const dirs = readdirSync(kernelRoot, { withFileTypes: true }).filter((e) =>
    e.isDirectory()
  ).length;
  return { files: files.length, loc, dirs };
}

function checkK08Size(files: Array<{ path: string; text: string }>): void {
  const current = collectSizeMetrics(files);
  const writing = process.argv.includes('--write-baseline');

  let previous: { version: number; metrics?: SizeMetrics } | null = null;
  if (existsSync(SIZE_BASELINE)) {
    try {
      previous = JSON.parse(readFileSync(SIZE_BASELINE, 'utf8')) as {
        version: number;
        metrics?: SizeMetrics;
      };
    } catch (err) {
      console.error(
        `K08 体量基线 JSON 解析失败（fail-closed）: ${String(err)}`
      );
      process.exit(1);
    }
  } else if (!writing) {
    console.error(
      `❌ K08 体量基线缺失: ${relative(repoRoot, SIZE_BASELINE)}（fail-closed；首次冻结用 --write-baseline）`
    );
    process.exit(1);
  }

  if (writing) {
    const prev = previous?.metrics;
    const cap = (key: keyof SizeMetrics): number =>
      Math.min(prev?.[key] ?? current[key], current[key]);
    const metrics: SizeMetrics = {
      files: cap('files'),
      loc: cap('loc'),
      dirs: cap('dirs'),
    };
    writeFileSync(
      SIZE_BASELINE,
      `${JSON.stringify({ version: 1, metrics }, null, 2)}\n`,
      'utf8'
    );
    console.log(
      `已写入 K08 体量基线 files=${metrics.files} · loc=${metrics.loc} · dirs=${metrics.dirs}`
    );
    return;
  }

  const caps = previous!.metrics;
  if (!caps) {
    console.error('❌ K08 基线缺少 metrics 字段（fail-closed）');
    process.exit(1);
  }

  const keys: Array<keyof SizeMetrics> = ['files', 'loc', 'dirs'];
  console.log(
    `K08 体量：files=${current.files}（≤${caps.files}）· loc=${current.loc}（≤${caps.loc}）· dirs=${current.dirs}（≤${caps.dirs}）`
  );

  const over = keys.filter((k) => current[k] > caps[k]);
  if (over.length > 0) {
    console.error(
      `❌ K08 内核体量超上限（棘轮只允许下调）：${over
        .map((k) => `${k} ${current[k]} > ${caps[k]}`)
        .join(' · ')}`
    );
    console.error(
      '   处置：① 把新增能力移出 core（优先）；② 确属内核原语 ⇒ 手改基线 json 并在 PR 说明理由'
    );
    process.exit(1);
  }

  const shrink = keys.filter((k) => current[k] < caps[k]);
  if (shrink.length > 0) {
    console.log(
      `ℹ️ K08 体量已低于上限（可 --write-baseline 下调锁定）: ${shrink
        .map((k) => `${k} ${current[k]} < ${caps[k]}`)
        .join(' · ')}`
    );
  }
}

// 仅在被当作脚本执行时跑 main（测试通过 import 复用纯函数）
if (import.meta.main) {
  main();
}
