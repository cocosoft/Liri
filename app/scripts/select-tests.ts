#!/usr/bin/env bun
/**
 * 增量测试选择（2026-10-18）—— CI 只跑「受本次变更影响」的测试。
 *
 * 安全优先（本仓门禁要求可信）：
 *  - **tag 发布** ⇒ 恒全量（`refs/tags/v*`）。
 *  - 变更落在 `app/src` / `app/tests` / **`packages/kernel/src`** 之外（scripts / .github /
 *    package.json / bun.lock / tsconfig / prompts / shared / client …）⇒ 全量。
 *    内核源码自 2026-10-24 起纳入代码根（此前"只改内核 ⇒ 恒全量"，属纯成本）。
 *  - 门禁类测试目录（`tests/gates` / `tests/contracts` / `tests/ci`）变更 ⇒ 全量。
 *  - **反向导入闭包**：从变更文件沿「谁 import 了它」反向遍历，收集受影响的测试；
 *    闭包为空 或 选中测试 > 全部测试的 60% ⇒ 全量（省不下多少，别冒险）。
 *  - **纯文档变更**（dev_docs / docs / app/docs / 根 *.md）⇒ 跳过测试（其它门禁仍跑）。
 *
 * 输出（`--out <file>`）：
 *  - `mode=full`   ⇒ 不写文件；调用方跑 `bun test tests/`
 *  - `mode=skip`   ⇒ 文件内容 `__SKIP__`
 *  - `mode=selected` ⇒ 文件为逐行测试路径（仓库相对）
 *
 * 用法（CI）：
 *   bun run scripts/select-tests.ts --base "$CI_BASE_SHA" --out /tmp/selected-tests.txt
 */
import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

export type SelectionMode = 'full' | 'skip' | 'selected';

export interface SelectionResult {
  mode: SelectionMode;
  /** 仓库相对路径（`/` 分隔）；`full` / `skip` 时为空 */
  tests: string[];
  reason: string;
}

/**
 * 文档-only 判定（全部变更都命中才算）。
 * ⚠️ **不得**把 `app/prompts` 下的 `.md` 当文档 —— 那是运行时资源，变更必须跑测试。
 */
const DOC_PATH_RE =
  /^(dev_docs\/|docs\/|app\/docs\/|\.trae\/docs\/)|^[^/]+\.md$/;

/** 门禁类测试目录：变更即全量（跨切面） */
const GATE_TEST_DIRS = [
  'app/tests/gates/',
  'app/tests/contracts/',
  'app/tests/ci/',
];

const CODE_ROOTS = ['app/src/', 'app/tests/', 'packages/kernel/src/'];

/** 允许处理的最大变更文件数；超过直接全量（防异常 diff） */
const MAX_CHANGED_FILES = 200;
/** 选中测试占比超过该值 ⇒ 全量 */
const FULL_RATIO = 0.6;

interface AliasRule {
  re: RegExp;
  target: string;
}

/** 从 tsconfig 读取 paths → 别名解析规则（`*` 通配） */
export function loadAliasRules(appDir: string): AliasRule[] {
  const tsconfigPath = join(appDir, 'tsconfig.json');
  if (!existsSync(tsconfigPath)) return [];
  let raw: {
    compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
  };
  try {
    raw = JSON.parse(readFileSync(tsconfigPath, 'utf-8'));
  } catch {
    return [];
  }
  const baseUrl = raw.compilerOptions?.baseUrl ?? '.';
  const paths = raw.compilerOptions?.paths ?? {};
  const rules: AliasRule[] = [];
  for (const [key, targets] of Object.entries(paths)) {
    const target = targets[0];
    if (!target) continue;
    const abs = resolve(appDir, baseUrl, target);
    if (key.includes('*')) {
      const [head, tail] = key.split('*');
      rules.push({
        re: new RegExp(`^${escapeRe(head)}(.*)${escapeRe(tail ?? '')}$`),
        target: abs,
      });
    } else {
      rules.push({ re: new RegExp(`^${escapeRe(key)}$`), target: abs });
    }
  }
  return rules;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 尝试把 specifier 解析为真实文件（相对 / 别名；裸包返回 null） */
export function resolveSpecifier(
  spec: string,
  fromFile: string,
  aliasRules: readonly AliasRule[]
): string | null {
  let base: string | null = null;
  if (spec.startsWith('.')) {
    base = resolve(dirname(fromFile), spec);
  } else {
    for (const rule of aliasRules) {
      const m = rule.re.exec(spec);
      if (!m) continue;
      base =
        m[1] !== undefined
          ? resolve(rule.target.replace(/\*$/, ''), m[1])
          : rule.target;
      break;
    }
  }
  if (base === null) return null;
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.d.ts`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

const IMPORT_RE =
  /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|import\(\s*['"]([^'"]+)['"]\s*\)/g;

/** 提取一个文件的依赖（已解析为绝对路径） */
export function extractDeps(
  file: string,
  aliasRules: readonly AliasRule[]
): string[] {
  let source = '';
  try {
    source = readFileSync(file, 'utf-8');
  } catch {
    return [];
  }
  const out = new Set<string>();
  for (const m of source.matchAll(IMPORT_RE)) {
    const spec = m[1] ?? m[2] ?? m[3];
    if (!spec) continue;
    const resolved = resolveSpecifier(spec, file, aliasRules);
    if (resolved) out.add(resolved);
  }
  return [...out];
}

/** 递归收集 `*.ts` / `*.tsx`（跳过 node_modules / dist） */
export function collectSourceFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      collectSourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** 测试文件判定（仓库相对路径，`/` 分隔） */
export function isTestFile(rel: string): boolean {
  return (
    rel.startsWith('app/tests/') &&
    (/\.test\.tsx?$/.test(rel) || rel.includes('/__tests__/'))
  );
}

function toRepoRel(appDir: string, abs: string): string {
  const repo = resolve(appDir, '..');
  return abs.startsWith(repo + sep)
    ? abs.slice(repo.length + 1).replace(/\\/g, '/')
    : abs.replace(/\\/g, '/');
}

export interface SelectOptions {
  /** 仓库根下的变更文件（`/` 分隔） */
  changed: readonly string[];
  /** 全部测试文件（仓库相对） */
  allTests: readonly string[];
  /** 反向邻接：被依赖文件 → 依赖它的文件（绝对路径） */
  importers: ReadonlyMap<string, ReadonlySet<string>>;
  /** 变更文件的绝对路径 → 仓库相对 */
  absToRel: ReadonlyMap<string, string>;
  /** 仓库相对 → 绝对路径 */
  relToAbs: ReadonlyMap<string, string>;
}

/** 纯决策函数（可单测） */
export function decideSelection(opts: SelectOptions): SelectionResult {
  const { changed, allTests, importers, absToRel, relToAbs } = opts;
  if (changed.length === 0)
    return { mode: 'full', tests: [], reason: '空变更集（无法判定）' };
  if (changed.length > MAX_CHANGED_FILES)
    return {
      mode: 'full',
      tests: [],
      reason: `变更文件 ${changed.length} > ${MAX_CHANGED_FILES}`,
    };
  if (changed.every((p) => DOC_PATH_RE.test(p))) {
    return { mode: 'skip', tests: [], reason: '纯文档变更' };
  }
  const outside = changed.find((p) => !CODE_ROOTS.some((r) => p.startsWith(r)));
  if (outside)
    return {
      mode: 'full',
      tests: [],
      reason: `变更触及代码根之外：${outside}`,
    };
  const gate = changed.find((p) => GATE_TEST_DIRS.some((d) => p.startsWith(d)));
  if (gate) return { mode: 'full', tests: [], reason: `门禁测试变更：${gate}` };

  const changedAbs = changed
    .map((rel) => relToAbs.get(rel) ?? null)
    .filter((x): x is string => x !== null);

  const selected = new Set<string>();
  const seen = new Set<string>();
  const queue: string[] = [...changedAbs];
  while (queue.length > 0) {
    const cur = queue.pop() as string;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const rel = absToRel.get(cur);
    if (rel && isTestFile(rel)) selected.add(rel);
    const parents = importers.get(cur);
    if (!parents) continue;
    for (const p of parents) queue.push(p);
  }

  if (selected.size === 0)
    return { mode: 'full', tests: [], reason: '反向导入闭包为空' };
  const ratio = allTests.length === 0 ? 1 : selected.size / allTests.length;
  if (ratio > FULL_RATIO)
    return {
      mode: 'full',
      tests: [],
      reason: `选中 ${selected.size}/${allTests.length}（>${FULL_RATIO}）`,
    };
  return {
    mode: 'selected',
    tests: [...selected].sort(),
    reason: `选中 ${selected.size}/${allTests.length}`,
  };
}

/** 构建反向导入图（全量 src + tests） */
export function buildImportGraph(appDir: string): {
  importers: Map<string, Set<string>>;
  absToRel: Map<string, string>;
  relToAbs: Map<string, string>;
  allTests: string[];
} {
  const aliasRules = loadAliasRules(appDir);
  const files = [
    ...collectSourceFiles(join(appDir, 'src')),
    ...collectSourceFiles(join(appDir, 'tests')),
  ];
  const absToRel = new Map<string, string>();
  const relToAbs = new Map<string, string>();
  const importers = new Map<string, Set<string>>();
  for (const abs of files) {
    const rel = toRepoRel(appDir, abs);
    absToRel.set(abs, rel);
    relToAbs.set(rel, abs);
    for (const dep of extractDeps(abs, aliasRules)) {
      let set = importers.get(dep);
      if (!set) {
        set = new Set();
        importers.set(dep, set);
      }
      set.add(abs);
    }
  }
  const allTests = [...absToRel.values()].filter(isTestFile).sort();
  return { importers, absToRel, relToAbs, allTests };
}

export function selectChangedTests(
  appDir: string,
  changed: readonly string[]
): SelectionResult {
  const { importers, absToRel, relToAbs, allTests } = buildImportGraph(appDir);
  return decideSelection({
    changed,
    allTests,
    importers,
    absToRel,
    relToAbs,
  });
}

function changedFiles(repoRoot: string, base: string): string[] | null {
  if (!base || /^0+$/.test(base)) return null;
  try {
    // CI 默认浅克隆：base 可能不在本地 ⇒ 按 SHA 补取一次（失败则全量）
    try {
      execFileSync('git', ['cat-file', '-e', `${base}^{commit}`], {
        cwd: repoRoot,
        stdio: 'ignore',
      });
    } catch {
      execFileSync('git', ['fetch', '--no-tags', '--depth=1', 'origin', base], {
        cwd: repoRoot,
        stdio: 'ignore',
      });
    }
    const out = execFileSync(
      'git',
      ['diff', '--name-only', '--diff-filter=ACMR', base, 'HEAD'],
      { cwd: repoRoot, encoding: 'utf-8' }
    );
    return out.split(/\r?\n/).filter(Boolean);
  } catch {
    return null;
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const argValue = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const appDir = resolve(import.meta.dir, '..');
  const repoRoot = resolve(appDir, '..');
  const outPath = argValue('--out');
  const base = argValue('--base') ?? process.env.CI_BASE_SHA ?? '';

  let result: SelectionResult;
  if ((process.env.GITHUB_REF ?? '').startsWith('refs/tags/')) {
    result = { mode: 'full', tests: [], reason: 'tag 发布 ⇒ 恒全量' };
  } else {
    const changed = changedFiles(repoRoot, base);
    result = changed
      ? selectChangedTests(appDir, changed)
      : {
          mode: 'full',
          tests: [],
          reason: `无法计算变更集（base=${base || '空'}）`,
        };
  }

  if (outPath) {
    if (result.mode === 'skip') writeFileSync(outPath, '__SKIP__\n', 'utf-8');
    else if (result.mode === 'selected')
      // 输出相对 `app/`（CI 的 `working-directory: app` 直接消费）
      writeFileSync(
        outPath,
        `${result.tests.map((t) => t.replace(/^app\//, '')).join('\n')}\n`,
        'utf-8'
      );
    else if (existsSync(outPath)) {
      // full 模式不写文件；清掉可能残留的旧选择结果
      writeFileSync(outPath, '', 'utf-8');
    }
  }

  console.log(`[select-tests] mode=${result.mode} · ${result.reason}`);
  if (result.mode === 'selected') {
    console.log(result.tests.map((t) => `  ${t}`).join('\n'));
  }
  const ghOut = process.env.GITHUB_OUTPUT;
  if (ghOut) {
    appendFileSync(ghOut, `mode=${result.mode}\n`, 'utf-8');
  }
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    appendFileSync(
      summary,
      `### 增量测试选择\n\n- **mode**: \`${result.mode}\`\n- **reason**: ${result.reason}\n`,
      'utf-8'
    );
  }
  process.exit(0);
}

if (import.meta.main) main();
