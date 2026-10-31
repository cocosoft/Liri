/**
 * infraBoundaryCore.ts — **infra 层边界契约**纯逻辑核心
 *
 * 依据：`.trae/specs/infra-layer-boundary-contract.md` §5（出入口与实现规范）
 * 与 §8（四条待触发建议门禁，本文件把它们落为可断言规则）。
 *
 * 四条规则：
 *   R1 模块顶层禁止 I/O —— 模块求值期只允许声明，副作用必须落在 `init()` / 工厂函数内。
 *   R2 security / permission 不得下沉审批编排 —— 这两个 infra 模块不得运行时引用上层模块，
 *      审批流程（该不该弹卡、何时放行、与 UI/会话交互）留在 app。
 *   R3 infra → 上层**动态导入**白名单 —— R00-003 的动态盲区，只减不增。
 *   R4 common / utils 重复导出 —— 同为 infra 的"无状态工具"双包，同名导出即双轨实现。
 *
 * 与 `lint-architecture.ts` 的分工：那里按事实源判**静态**跨层（R00-001/002）、动态只上报（R00-003）；
 * 本文件只补 infra 层这四条，不重复判静态跨层。
 *
 * 只做解析与比较、无 IO，供 `scripts/lint-infra-boundary.ts`（门禁）与
 * `tests/gates/infraBoundary.test.ts` 共用（与 `architectureBoundaryCore.ts` 同分工）。
 */

import * as ts from 'typescript';
import { resolveSpecifier, type SourceFile } from './architectureBoundaryCore';

export type { SourceFile };

// ─────────────────────────────── 公共结构 ───────────────────────────────

/** 一条 import / export-from / 动态导入引用（路径相对 `app/src`，posix 形式） */
export interface ImportRef {
  path: string;
  /** 源码里书写的说明符（白名单按此精确匹配，与 architecture-boundaries 同口径） */
  specifier: string;
  /** 相对 `app/src` 的规范化路径；裸包 / 不可解析的动态表达式为 null */
  resolved: string | null;
  kind: 'static' | 'type' | 'dynamic';
  /** 动态导入的参数不是字面量（模板拼接 / 变量）⇒ 静态不可证 */
  unresolvable: boolean;
  line: number;
}

/** `.trae/architecture/infra-boundary-allowlist.json` 的结构（每条必须带理由） */
export interface InfraBoundaryAllowlist {
  version: number;
  note?: string;
  /** R1：允许在模块顶层做 I/O 的存量文件 */
  topLevelIo: Array<{ path: string; reason: string }>;
  /** R2：security / permission 引用上层的存量例外 */
  approvalOrchestration: Array<{
    path: string;
    specifier: string;
    reason: string;
  }>;
  /** R3：infra 动态导入上层的存量例外（清零目标） */
  dynamicInfraToApp: Array<{
    path: string;
    specifier: string;
    reason: string;
  }>;
  /** R4：common / utils 同名导出的存量例外 */
  commonUtilsDuplicates: Array<{ name: string; reason: string }>;
}

/** 单条规则的检查结论 */
export interface BoundaryReport {
  rule: 'R1' | 'R2' | 'R3' | 'R4';
  title: string;
  violations: string[];
  hints: string[];
  checked: number;
}

/** R1 的一条顶层 I/O 命中 */
export interface TopLevelIoHit {
  path: string;
  line: number;
  /** 命中形态，如 `process.env` / `fs.readFileSync` */
  raw: string;
}

/** 层名 ⇒ 是否属于 infra 之上的层（infra 不得引用） */
const UPPER_LAYERS = new Set(['entry', 'ui', 'app', 'service']);

function reasonMissing(reason: string | undefined): boolean {
  return !reason || reason.trim().length < 2;
}

function createSource(file: SourceFile): ts.SourceFile {
  return ts.createSourceFile(
    file.path,
    file.content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
}

function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

// ─────────────────────────── 引用解析（R2 / R3 共用） ───────────────────────────

/**
 * 解析源码里的全部跨模块引用：静态 import / export-from / `import()` / `require()`。
 *
 * 动态导入的**非字面量参数**（模板拼接、变量）静态不可证 ⇒ `specifier` 记 `<动态表达式>`、
 * `resolved` 为 null，由 R3 按 fail-closed 报出（与 `lint-kernel-purity` 的 K02 同口径）。
 */
export function parseFileImports(file: SourceFile): ImportRef[] {
  const sf = createSource(file);
  const refs: ImportRef[] = [];
  const push = (
    specifier: string,
    node: ts.Node,
    kind: ImportRef['kind'],
    resolvable = true
  ): void => {
    refs.push({
      path: file.path,
      specifier,
      resolved: resolvable ? resolveSpecifier(file.path, specifier) : null,
      kind,
      unresolvable: !resolvable,
      line: lineOf(sf, node),
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const spec = node.moduleSpecifier;
      if (ts.isStringLiteral(spec)) {
        push(spec.text, node, node.importClause?.isTypeOnly ? 'type' : 'static');
      }
      return;
    }
    if (ts.isExportDeclaration(node)) {
      const spec = node.moduleSpecifier;
      if (spec && ts.isStringLiteral(spec)) {
        push(spec.text, node, node.isTypeOnly ? 'type' : 'static');
      }
      return;
    }
    if (ts.isImportEqualsDeclaration(node)) {
      // `import x = require('…')` 走的是 require 分支，这里不重复计入
      return;
    }
    if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire =
        ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if ((isDynamicImport || isRequire) && node.arguments.length > 0) {
        const arg = node.arguments[0]!;
        if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
          push(arg.text, node, 'dynamic');
        } else {
          push('<动态表达式>', node, 'dynamic', false);
        }
        return;
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return refs;
}

/** 说明符解析到的模块层；裸包 / 未登记模块返回 null */
function layerOf(
  resolved: string | null,
  layers: ReadonlyMap<string, string>
): { module: string; layer: string } | null {
  if (!resolved) return null;
  const module = resolved.split('/')[0]!;
  const layer = layers.get(module);
  return layer ? { module, layer } : null;
}

// ───────────────────────────── R1 模块顶层 I/O ─────────────────────────────

/**
 * 被视为"求值即触达 I/O"的内建模块根名。
 *
 * 判据取**绑定**而非函数名表：从这些模块导入的名字，只要在顶层被调用/实例化即算 I/O。
 * 这样 `readFile` / `open` / `execFile` 等新增 API 不会因漏登记而假绿。
 */
const IO_MODULE_ROOTS = new Set([
  'fs',
  'fs/promises',
  'child_process',
  'net',
  'http',
  'https',
  'dgram',
  'worker_threads',
  'sqlite',
]);

/** 延迟求值作用域：函数 / 类的方法与构造器 ⇒ 其内部不是"模块顶层" */
function isDeferredScope(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isClassExpression(node)
  );
}

interface IoBindings {
  /** 具名导入 / 默认导入的本地名 */
  names: Set<string>;
  /** 命名空间导入（`import * as fs`） */
  namespaces: Set<string>;
}

function collectIoBindings(sf: ts.SourceFile): IoBindings {
  const names = new Set<string>();
  const namespaces = new Set<string>();
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    const spec = stmt.moduleSpecifier;
    if (!ts.isStringLiteral(spec)) continue;
    const bare = spec.text.replace(/^(node|bun):/, '');
    if (!IO_MODULE_ROOTS.has(bare.split('/')[0]!)) continue;
    const clause = stmt.importClause;
    if (!clause) continue;
    if (clause.name) names.add(clause.name.text);
    const bindings = clause.namedBindings;
    if (!bindings) continue;
    if (ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
    } else {
      for (const el of bindings.elements) names.add(el.name.text);
    }
  }
  return { names, namespaces };
}

/** 调用的本地名是否来自 I/O 模块（`readFileSync` / `fs.readFileSync`） */
function ioCallee(
  expr: ts.Expression,
  bindings: IoBindings
): string | null {
  if (ts.isIdentifier(expr) && bindings.names.has(expr.text)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) {
    const left = expr.expression;
    if (ts.isIdentifier(left) && bindings.namespaces.has(left.text)) {
      return `${left.text}.${expr.name.text}`;
    }
  }
  return null;
}

/**
 * R1：找出模块**顶层**的 I/O（函数 / 类体内不算）。
 *
 * 命中面：① `process.env` 成员访问；② 来自 fs / child_process / net / http(s) / dgram /
 * worker_threads / sqlite 的导入在顶层被调用或实例化。
 * 类体整体视为延迟求值（静态属性初始化亦不计），与 `lint-kernel-purity` 的"遇函数/类不下钻"一致。
 */
export function findTopLevelIo(file: SourceFile): TopLevelIoHit[] {
  const sf = createSource(file);
  const bindings = collectIoBindings(sf);
  const hits = new Map<string, TopLevelIoHit>();
  const add = (node: ts.Node, raw: string): void => {
    const line = lineOf(sf, node);
    const key = `${line}|${raw}`;
    if (!hits.has(key)) hits.set(key, { path: file.path, line, raw });
  };

  const visit = (node: ts.Node): void => {
    if (isDeferredScope(node)) return;
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'process' &&
      node.name.text === 'env'
    ) {
      add(node, 'process.env');
    } else if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = node.expression;
      if (callee) {
        const name = ioCallee(callee, bindings);
        if (name) add(node, name);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return [...hits.values()];
}

/** R1：未登记的顶层 I/O ⇒ 违规；登记了但已不存在的 ⇒ 提示清理 */
export function compareTopLevelIo(
  files: readonly SourceFile[],
  allowlist: InfraBoundaryAllowlist
): BoundaryReport {
  const violations: string[] = [];
  const hints: string[] = [];
  const allowed = new Map(allowlist.topLevelIo.map((e) => [e.path, e]));
  const hitPaths = new Set<string>();
  let checked = 0;

  for (const file of files) {
    for (const hit of findTopLevelIo(file)) {
      checked += 1;
      hitPaths.add(hit.path);
      if (allowed.has(hit.path)) continue;
      violations.push(
        `${hit.path}:${hit.line} 模块顶层执行 I/O \`${hit.raw}\` —— 副作用须移入显式 init() / 工厂函数` +
          '（确需留存请登记 .trae/architecture/infra-boundary-allowlist.json 的 topLevelIo）'
      );
    }
  }

  for (const entry of allowlist.topLevelIo) {
    if (reasonMissing(entry.reason)) {
      violations.push(`R1 白名单条目缺少理由：${entry.path}`);
      continue;
    }
    if (!hitPaths.has(entry.path)) {
      hints.push(`R1 白名单已无对应命中（请清理）：${entry.path}`);
    }
  }
  if (violations.length === 0) {
    hints.push(`顶层 I/O 命中 ${checked} 处，均已登记`);
  }
  return { rule: 'R1', title: '模块顶层禁止 I/O', violations, hints, checked };
}

// ─────────────────────── R2 security / permission 审批编排 ───────────────────────

/** R2 的扫描根（相对 `app/src`）：审批/安全原语模块 */
export const APPROVAL_MODULE_PREFIXES = ['security/', 'permission/'] as const;

/**
 * R2：security / permission 不得**运行时**引用上层模块。
 *
 * 只判运行时（`import type` 放行）：该边界防的是"审批流程编排下沉到 infra"，
 * 类型契约不影响运行时行为。静态与动态同一口径（隐藏的动态通道是 R00-003 的盲区）。
 */
export function compareApprovalOrchestration(
  files: readonly SourceFile[],
  layers: ReadonlyMap<string, string>,
  allowlist: InfraBoundaryAllowlist
): BoundaryReport {
  const violations: string[] = [];
  const hints: string[] = [];
  const allowed = new Set(
    allowlist.approvalOrchestration.map((e) => `${e.path}|${e.specifier}`)
  );
  let checked = 0;

  for (const file of files) {
    if (!APPROVAL_MODULE_PREFIXES.some((p) => file.path.startsWith(p))) continue;
    for (const ref of parseFileImports(file)) {
      if (ref.kind === 'type') continue;
      const target = layerOf(ref.resolved, layers);
      if (!target || !UPPER_LAYERS.has(target.layer)) continue;
      checked += 1;
      if (allowed.has(`${ref.path}|${ref.specifier}`)) continue;
      violations.push(
        `${ref.path}:${ref.line} 引用上层模块「${target.module}」(layer=${target.layer}) —— ` +
          '审批编排属 app（chat/services/ToolExecutionService）；infra 只保留判定原语'
      );
    }
  }

  for (const entry of allowlist.approvalOrchestration) {
    if (reasonMissing(entry.reason)) {
      violations.push(`R2 白名单条目缺少理由：${entry.path} → ${entry.specifier}`);
    }
  }
  if (violations.length === 0) {
    hints.push(
      checked === 0
        ? 'security / permission 未引用上层模块'
        : `security / permission 的上层引用 ${checked} 条，均已登记`
    );
  }
  return {
    rule: 'R2',
    title: '审批编排不得下沉（security / permission）',
    violations,
    hints,
    checked,
  };
}

// ───────────────────────── R3 infra 动态导入上层 ─────────────────────────

/**
 * R3：infra 动态导入上层模块 —— 白名单清零目标。
 *
 * 静态跨层由 `lint:arch` R00-001 硬拦；动态导入是它的盲区（R00-003 只上报）。
 * 本规则把 infra 侧**可解析的上层目标**冻结为逐条白名单：新增必红，清掉一条就该删一条。
 * 参数非字面量（模板拼接 / 变量）的动态导入无法定位层，归 `lint:arch` R00-003 观测，此处只计数提示。
 */
export function compareDynamicInfraToApp(
  files: readonly SourceFile[],
  layers: ReadonlyMap<string, string>,
  allowlist: InfraBoundaryAllowlist
): BoundaryReport {
  const violations: string[] = [];
  const hints: string[] = [];
  const allowed = new Set(
    allowlist.dynamicInfraToApp.map((e) => `${e.path}|${e.specifier}`)
  );
  const seen = new Set<string>();
  let checked = 0;
  let unresolvable = 0;

  for (const file of files) {
    for (const ref of parseFileImports(file)) {
      if (ref.kind !== 'dynamic') continue;
      // 非字面量参数：静态不可证，无法定位层 ⇒ 只计数（由 lint:arch R00-003 观测）
      if (ref.unresolvable) {
        unresolvable += 1;
        continue;
      }
      const target = layerOf(ref.resolved, layers);
      if (!target || !UPPER_LAYERS.has(target.layer)) continue;
      checked += 1;
      const key = `${ref.path}|${ref.specifier}`;
      if (allowed.has(key)) {
        seen.add(key);
        continue;
      }
      violations.push(
        `${ref.path}:${ref.line} 动态导入上层模块「${target.module}」(layer=${target.layer}) \`${ref.specifier}\` —— ` +
          '应改为经 spi 端口或由上层注入（R00-003 盲区）'
      );
    }
  }

  if (unresolvable > 0) {
    hints.push(
      `动态导入参数静态不可证 ${unresolvable} 处（不在本规则判定面，见 lint:arch R00-003）`
    );
  }

  for (const entry of allowlist.dynamicInfraToApp) {
    if (reasonMissing(entry.reason)) {
      violations.push(`R3 白名单条目缺少理由：${entry.path} → ${entry.specifier}`);
      continue;
    }
    if (!seen.has(`${entry.path}|${entry.specifier}`)) {
      hints.push(
        `R3 白名单已无对应导入（请清理，清零目标）：${entry.path} → ${entry.specifier}`
      );
    }
  }
  if (violations.length === 0 && checked > 0) {
    hints.push(`infra 动态上层导入 ${checked} 处，均已登记（目标归零）`);
  }
  return {
    rule: 'R3',
    title: 'infra 动态导入上层（白名单清零）',
    violations,
    hints,
    checked,
  };
}

// ────────────────────── R4 common / utils 重复导出 ──────────────────────

/**
 * 收集一个文件导出的名字（含 `export { a as b }` 与**导出命名空间内的**导出；
 * `export default` / `export … from` 不计 —— 后者是 barrel 转出，不构成第二份实现）。
 */
export function collectExportedNames(file: SourceFile): Set<string> {
  const sf = createSource(file);
  const names = new Set<string>();

  const exported = (node: ts.Node): boolean => {
    const modifiers = (node as ts.Node & { modifiers?: ts.NodeArray<ts.ModifierLike> })
      .modifiers;
    return !!modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  };

  const scan = (statements: ts.NodeArray<ts.Statement>): void => {
    for (const stmt of statements) {
      if (
        (ts.isFunctionDeclaration(stmt) ||
          ts.isClassDeclaration(stmt) ||
          ts.isInterfaceDeclaration(stmt) ||
          ts.isTypeAliasDeclaration(stmt) ||
          ts.isEnumDeclaration(stmt)) &&
        stmt.name &&
        exported(stmt)
      ) {
        names.add(stmt.name.text);
        continue;
      }
      if (ts.isVariableStatement(stmt) && exported(stmt)) {
        for (const decl of stmt.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) names.add(decl.name.text);
        }
        continue;
      }
      if (ts.isExportDeclaration(stmt) && !stmt.moduleSpecifier) {
        const clause = stmt.exportClause;
        if (clause && ts.isNamedExports(clause)) {
          for (const el of clause.elements) names.add(el.name.text);
        }
        continue;
      }
      // `export namespace StringUtils { export function trim() {} }`：
      // 命名空间内的导出同样可从模块外触达（`StringUtils.trim`），必须计入
      if (ts.isModuleDeclaration(stmt) && exported(stmt)) {
        const body = stmt.body;
        if (body && ts.isModuleBlock(body)) scan(body.statements);
      }
    }
  };

  scan(sf.statements);
  return names;
}

/** R4：common 与 utils 的同名顶层导出 ⇒ 双轨实现（新增必红） */
export function compareCommonUtilsDuplicates(
  commonFiles: readonly SourceFile[],
  utilsFiles: readonly SourceFile[],
  allowlist: InfraBoundaryAllowlist
): BoundaryReport {
  const violations: string[] = [];
  const hints: string[] = [];
  const allowed = new Map(allowlist.commonUtilsDuplicates.map((e) => [e.name, e]));

  const index = (files: readonly SourceFile[]): Map<string, string[]> => {
    const map = new Map<string, string[]>();
    for (const file of files) {
      for (const name of collectExportedNames(file)) {
        const list = map.get(name) ?? [];
        list.push(file.path);
        map.set(name, list);
      }
    }
    return map;
  };
  const common = index(commonFiles);
  const utils = index(utilsFiles);

  const duplicated = [...common.keys()]
    .filter((name) => utils.has(name))
    .sort();

  for (const name of duplicated) {
    if (allowed.has(name)) continue;
    violations.push(
      `同名导出「${name}」同时存在于 ${common.get(name)!.join(', ')} 与 ${utils.get(name)!.join(', ')}` +
        ' —— infra 双包只允许一份实现（CS01 归一化；确需并存请登记 commonUtilsDuplicates）'
    );
  }

  for (const entry of allowlist.commonUtilsDuplicates) {
    if (reasonMissing(entry.reason)) {
      violations.push(`R4 白名单条目缺少理由：${entry.name}`);
      continue;
    }
    if (!duplicated.includes(entry.name)) {
      hints.push(`R4 白名单已无同名导出（请清理）：${entry.name}`);
    }
  }
  if (violations.length === 0) {
    hints.push(
      duplicated.length === 0
        ? 'common / utils 无同名导出'
        : `同名导出 ${duplicated.length} 个，均已登记`
    );
  }
  return {
    rule: 'R4',
    title: 'common / utils 重复导出',
    violations,
    hints,
    checked: duplicated.length,
  };
}
