/**
 * architectureBoundaryCore.ts — **架构边界**纯逻辑核心（演进方案 W2 / W4）
 *
 * 与 `kernelSurfaceCore.ts` / `criticalModulesCore.ts` 同分工：只做解析与比较、无 IO，
 * 供 `scripts/lint-architecture-boundaries.ts`（CI 门禁）与
 * `tests/gates/architectureBoundaries.test.ts` 共用。
 *
 * 两条规则（`演进方案-极简内核与分层循环.md` §3）：
 *
 * 1. **W2 分层循环边界**：L1（`agent/**`、`query/TAORLoop.ts`、`query/taor/**`）是循环内核，
 *    只应向上暴露能力，**不得运行时依赖** L2/L3（`chat/`、`tasks/`、`workspace/`）。
 *    - 只判**运行时** import：`import type` / `export type` 是编译期契约，放行；
 *    - 别名（`@modules/x`）与相对路径（`../tasks/x`）**同一口径**解析后再判 ——
 *      只查别名会让 `../tasks/x` 成为绕过通道；
 *    - 存量例外必须逐条登记理由（当前 2 条均为「纯文案模板」依赖，见 JSON）。
 *
 * 2. **W4 工具面单一事实源**：工具实现文件内**禁止**用 `feature('TOOL_*')` 自审
 *    （"我自己这个工具是否开启"）。变体可见性只能由装配点（`variant-matrix.ts`）决定，
 *    否则同一能力出现两份判定，矩阵漂移无法发现。
 *    - `tools/sidecar/**` 豁免：那里判的是**旁路生命周期**（sidecar 进程要不要起），
 *      不是"某工具是否可见"，属装配/基础设施而非工具实现自审。
 */

import { posix } from 'node:path';

/** 待扫描的源文件（路径统一为相对 `app/src` 的 posix 形式） */
export interface SourceFile {
  path: string;
  content: string;
}

/** 一条 import / export-from 引用 */
export interface ImportRef {
  path: string;
  specifier: string;
  /** 相对 `src/` 的规范化模块路径；外部包为 null */
  resolved: string | null;
  typeOnly: boolean;
  line: number;
}

/** 分层边界的一条存量例外（必须写明理由） */
export interface LoopBoundaryException {
  path: string;
  specifier: string;
  reason: string;
}

/** `.trae/architecture/architecture-boundaries.json` 的结构 */
export interface ArchitectureBoundaries {
  version: number;
  recordedAt?: string;
  note?: string;
  loopBoundary: {
    /** 逻辑层目标（相对 `src/` 的顶层目录名） */
    targets: string[];
    exceptions: LoopBoundaryException[];
  };
  toolSelfCheck: {
    exemptDirs: Array<{ dir: string; reason: string }>;
  };
}

export interface BoundaryComparison {
  violations: string[];
  hints: string[];
  /** 实际检查的引用 / 调用条数（便于在输出里给出量级） */
  checked: number;
}

/** 去掉块注释与行注释，保留换行以维持行号；字符串内的 `//` 会误伤，但本仓 import 不会出现在字符串里 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, (m, p1: string) => p1 + ' '.repeat(m.length - p1.length));
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

/** 把 specifier 规范化为相对 `src/` 的路径；外部包返回 null */
export function resolveSpecifier(filePath: string, specifier: string): string | null {
  if (specifier.startsWith('@modules/')) return specifier.slice('@modules/'.length);
  if (specifier.startsWith('src/')) return specifier.slice(4);
  if (specifier.startsWith('.')) {
    return posix.normalize(posix.join(posix.dirname(filePath), specifier));
  }
  return null;
}

/**
 * 解析源码里的 import / export-from。
 * 以分号切语句：本仓统一带分号；无分号的多行导入不会被误拼到下一条语句。
 */
export function parseImports(file: SourceFile): ImportRef[] {
  const cleaned = stripComments(file.content);
  const refs: ImportRef[] = [];
  const statement = /(?:^|\n)[ \t]*(import|export)\s+([\s\S]*?);/g;
  let match: RegExpExecArray | null;
  while ((match = statement.exec(cleaned)) !== null) {
    const body = match[2] ?? '';
    const fromMatch = /\bfrom\s*['"]([^'"]+)['"]/.exec(body);
    const bareMatch = /^\s*['"]([^'"]+)['"]/.exec(body);
    const specifier = fromMatch?.[1] ?? bareMatch?.[1];
    if (!specifier) continue;
    refs.push({
      path: file.path,
      specifier,
      resolved: resolveSpecifier(file.path, specifier),
      typeOnly: /^\s*type\s/.test(body),
      // 正则以 `(?:^|\n)` 起头 ⇒ 命中位置可能落在上一行的换行符上，补回 1 才是语句真实行号
      line: lineOf(cleaned, match.index + (match[0].startsWith('\n') ? 1 : 0)),
    });
  }
  return refs;
}

function hitsTarget(resolved: string | null, targets: string[]): boolean {
  if (!resolved) return false;
  return targets.some((t) => resolved === t || resolved.startsWith(`${t}/`));
}

/** W2：L1 文件里**运行时**依赖 L2/L3 ⇒ 违规（例外需逐条登记） */
export function compareLoopBoundary(
  refs: ImportRef[],
  config: ArchitectureBoundaries['loopBoundary']
): BoundaryComparison {
  const violations: string[] = [];
  const hints: string[] = [];
  const exempt = new Set(
    config.exceptions.map((e) => `${e.path}::${e.specifier}`)
  );
  let checked = 0;

  for (const ref of refs) {
    if (ref.typeOnly) continue;
    if (!hitsTarget(ref.resolved, config.targets)) continue;
    checked += 1;
    if (exempt.has(`${ref.path}::${ref.specifier}`)) continue;
    violations.push(
      `${ref.path}:${ref.line} 运行时依赖 L2/L3 \`${ref.specifier}\`（循环内核只允许向上暴露能力）`
    );
  }

  if (violations.length === 0) {
    hints.push(
      checked === 0
        ? '未发现 L1 → L2/L3 运行时依赖'
        : `跨层运行时引用 ${checked} 条，均已登记例外`
    );
  }
  for (const exception of config.exceptions) {
    if (exception.reason.trim().length < 2) {
      violations.push(`例外缺少理由：${exception.path} → ${exception.specifier}`);
    }
  }
  return { violations, hints, checked };
}

/** 一条工具自审调用 */
export interface ToolSelfCheck {
  path: string;
  line: number;
  raw: string;
}

/** W4：找出 `feature('TOOL_*')` 调用（注释已剥离，注释里的说明不算） */
export function findToolSelfChecks(file: SourceFile): ToolSelfCheck[] {
  const cleaned = stripComments(file.content);
  const re = /feature\(\s*['"](TOOL_[A-Za-z0-9_]*)['"]/g;
  const out: ToolSelfCheck[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(cleaned)) !== null) {
    out.push({
      path: file.path,
      line: lineOf(cleaned, match.index),
      raw: match[0],
    });
  }
  return out;
}

/** W4：豁免目录（`tools/sidecar/`）之外的命中 ⇒ 违规 */
export function compareToolSelfChecks(
  files: SourceFile[],
  config: ArchitectureBoundaries['toolSelfCheck']
): BoundaryComparison {
  const violations: string[] = [];
  const hints: string[] = [];
  const exemptDirs = config.exemptDirs.map((e) => e.dir);
  let checked = 0;

  for (const file of files) {
    for (const call of findToolSelfChecks(file)) {
      checked += 1;
      const exempt = exemptDirs.some(
        (dir) => file.path === dir || file.path.startsWith(`${dir.replace(/\/$/, '')}/`)
      );
      if (exempt) continue;
      violations.push(
        `${call.path}:${call.line} 工具实现内出现 \`${call.raw}\` —— 可见性只能由装配点（variant-matrix）决定`
      );
    }
  }

  for (const dir of config.exemptDirs) {
    if (dir.reason.trim().length < 2) {
      violations.push(`工具自审豁免目录缺少理由：${dir.dir}`);
    }
  }
  if (violations.length === 0) {
    hints.push(`工具面自审命中 ${checked} 处，全部落在已登记豁免目录内`);
  }
  return { violations, hints, checked };
}
