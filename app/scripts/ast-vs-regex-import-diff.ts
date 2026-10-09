#!/usr/bin/env bun
/**
 * P1-b 取证（对应 `.trae/specs/ast-family-phased-plan.md` §3 P1 / §8.4）：
 * **量化**「`lint-architecture` 的正则式 import 提取」与「TS AST 提取」的**差异集**，
 * 以决定是否值得把门禁替换为真解析（B10 的触发条件 ③「先量化收益证据」）。
 *
 * 用法（app 目录下）：`bun run scripts/ast-vs-regex-import-diff.ts`
 * **不作为 CI 门禁**（`typescript` 属 devDependency；本脚本只读、不改门禁）。
 *
 * 对照公平性（重要）：
 * - **正则侧**：逐字复制门禁的 `stripComments`（`scripts/lint-architecture.ts:2595-2656`）与
 *   两条静态 import 正则（`parseModuleImports` `:2664` / `:2671`），保证对照的是**同一实现**；
 * - **AST 侧**：`typescript` 解析后遍历 ImportDeclaration / ExportDeclaration / ImportEqualsDeclaration；
 * - **归一化**：两侧都把 `@modules/a/b` 归到**模块根** `@modules/a`（门禁正则本就只取首段）；
 *   相对路径保留字面量（两侧一致，不引入解析器差异）；
 * - **范围**：**仅静态 import**（动态 `import('…')`/`require('…')` 由门禁另一路径上报，
 *   不属本项 P1 范围，两侧都不计）。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

const SRC = join(import.meta.dir, '..', 'src');

// ─── 正则侧：逐字复制门禁实现（见文件头「对照公平性」） ────────────────────────

/** 复制自 `scripts/lint-architecture.ts:2595-2656`（唯一事实源在门禁，此处仅为对照镜像） */
function stripComments(content: string): string {
  let out = '';
  let i = 0;
  let state: 'code' | 'line' | 'block' | 'single' | 'double' | 'template' =
    'code';
  while (i < content.length) {
    const ch = content[i];
    const next = content[i + 1];
    if (state === 'code') {
      if (ch === '/' && next === '/') {
        state = 'line';
        i += 2;
        continue;
      }
      if (ch === '/' && next === '*') {
        state = 'block';
        i += 2;
        continue;
      }
      if (ch === "'") state = 'single';
      else if (ch === '"') state = 'double';
      else if (ch === '`') state = 'template';
      out += ch;
      i++;
      continue;
    }
    if (state === 'line') {
      if (ch === '\n') {
        state = 'code';
        out += ch;
      }
      i++;
      continue;
    }
    if (state === 'block') {
      if (ch === '*' && next === '/') {
        state = 'code';
        i += 2;
        continue;
      }
      if (ch === '\n') out += ch;
      i++;
      continue;
    }
    out += ch;
    if (ch === '\\') {
      out += next ?? '';
      i += 2;
      continue;
    }
    if (
      (state === 'single' && ch === "'") ||
      (state === 'double' && ch === '"') ||
      (state === 'template' && ch === '`')
    ) {
      state = 'code';
    }
    i++;
  }
  return out;
}

/** 复制自门禁 `:2664` / `:2671`（`parseModuleImports` 静态面） */
const MODULE_REGEX = /from\s+['"]@modules\/([^'"/]+)/g;
const REL_IMPORT_REGEX = /from\s+['"](\.[^'"]+)['"]/g;

function normalizeSpecifier(spec: string): string {
  if (spec.startsWith('@modules/')) {
    return `@modules/${spec.slice('@modules/'.length).split('/')[0]}`;
  }
  return spec;
}

/**
 * **门禁的追踪口径**：只关心 `@modules/*` 与相对路径（`./`、`../`）。
 * 裸包 / Node 内建（`fs`、`node:path`、`crypto`…）门禁**有意不追踪**（它们不是"模块分层"的边）
 * ⇒ 对照必须收窄到此口径，否则会把"门禁本就不看的面"误算成"漏判"。
 */
function isTracked(spec: string): boolean {
  return spec.startsWith('@modules/') || spec.startsWith('.');
}

interface Hit {
  spec: string;
  line: number;
  typeOnly: boolean;
}

function regexHits(content: string): Hit[] {
  const stripped = stripComments(content);
  const hits: Hit[] = [];
  const lineAt = (idx: number): number =>
    stripped.slice(0, idx).split('\n').length;
  const collect = (re: RegExp, build: (m: RegExpExecArray) => string): void => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(stripped)) !== null) {
      // 类型语句判据与门禁 parseValueModuleImports 同构（粗判，仅用于区分口径展示）
      const upto = stripped.slice(0, m.index);
      const start = Math.max(
        upto.lastIndexOf('\nimport'),
        upto.lastIndexOf('\nexport')
      );
      const typeOnly = /^\s*(import|export)\s+type\b/.test(
        stripped.slice(start < 0 ? 0 : start, m.index)
      );
      hits.push({
        spec: normalizeSpecifier(build(m)),
        line: lineAt(m.index),
        typeOnly,
      });
    }
  };
  collect(MODULE_REGEX, (m) => `@modules/${m[1]}`);
  collect(REL_IMPORT_REGEX, (m) => m[1]);
  return hits;
}

function astHits(filePath: string, content: string): Hit[] {
  const scriptKind = filePath.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    scriptKind
  );
  const hits: Hit[] = [];
  const pos = (node: ts.Node): number =>
    sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const push = (spec: string, node: ts.Node, typeOnly: boolean): void => {
    hits.push({
      spec: normalizeSpecifier(spec),
      line: pos(node),
      typeOnly,
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      push(
        node.moduleSpecifier.text,
        node,
        node.importClause?.isTypeOnly === true
      );
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      push(node.moduleSpecifier.text, node, node.isTypeOnly);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      push(node.moduleReference.expression.text, node, node.isTypeOnly);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return hits;
}

// ─── 扫描与对照 ──────────────────────────────────────────────────────────────

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.tsx?$/.test(name) && !name.endsWith('.d.ts')) yield p;
  }
}

interface Sample {
  file: string;
  line: number;
  spec: string;
}

function main(): void {
  const regexOnly: Sample[] = [];
  const astOnly: Sample[] = [];
  let astOnlyCount = 0;
  let regexOnlyCount = 0;
  let files = 0;
  let regexTotal = 0;
  let astTotal = 0;
  let astTypeOnly = 0;
  let regexTypeOnly = 0;
  let astUntracked = 0;

  for (const file of walk(SRC)) {
    files++;
    const content = readFileSync(file, 'utf-8');
    const rel = relative(SRC, file).replace(/\\/g, '/');

    const rHits = regexHits(content);
    const aAll = astHits(file, content);
    // **收窄到门禁追踪口径**（`@modules/*` + 相对路径）；裸包/内建不计入对照
    const aHits = aAll.filter((h) => isTracked(h.spec));
    astUntracked += aAll.length - aHits.length;
    regexTotal += rHits.length;
    astTotal += aHits.length;
    regexTypeOnly += rHits.filter((h) => h.typeOnly).length;
    astTypeOnly += aHits.filter((h) => h.typeOnly).length;

    // 去重成 (spec, typeOnly) 集合后比较（行号仅用于取样展示）
    const rSet = new Set(rHits.map((h) => `${h.spec}|${h.typeOnly}`));
    const aSet = new Set(aHits.map((h) => `${h.spec}|${h.typeOnly}`));
    for (const h of aHits) {
      const key = `${h.spec}|${h.typeOnly}`;
      if (!rSet.has(key)) {
        astOnlyCount++;
        if (astOnly.length < 40) {
          astOnly.push({
            file: rel,
            line: h.line,
            spec: `${h.spec}${h.typeOnly ? ' (type-only)' : ''}`,
          });
        }
      }
    }
    for (const h of rHits) {
      const key = `${h.spec}|${h.typeOnly}`;
      if (!aSet.has(key)) {
        regexOnlyCount++;
        if (regexOnly.length < 40) {
          regexOnly.push({
            file: rel,
            line: h.line,
            spec: `${h.spec}${h.typeOnly ? ' (type-only)' : ''}`,
          });
        }
      }
    }
  }

  console.log('=== AST vs 正则：静态 import 提取差异（P1-b 取证，非门禁）===');
  console.log(`扫描文件: ${files}（app/src，*.ts/*.tsx，排除 *.d.ts）`);
  console.log(`提取条数: 正则 ${regexTotal} | AST ${astTotal}（AST 侧另有 ${astUntracked} 条裸包/内建，门禁有意不追踪）`);
  console.log(`type-only: 正则 ${regexTypeOnly} | AST ${astTypeOnly}`);
  console.log(`\n--- AST-only（正则【漏判】）: ${astOnlyCount} 例（展示前 ${astOnly.length}）---`);
  astOnly.forEach((s) => console.log(`  ${s.file}:${s.line}  ${s.spec}`));
  console.log(`\n--- 正则-only（正则【多出】= 疑似误报/形态差异）: ${regexOnlyCount} 例（展示前 ${regexOnly.length}）---`);
  regexOnly.forEach((s) => console.log(`  ${s.file}:${s.line}  ${s.spec}`));
  console.log('\n判定口径（见方案 §8.4）：AST-only 若全为 0 且 正则-only 全为 0 ⇒ P1「精度版」收益为 0。');
}

main();
