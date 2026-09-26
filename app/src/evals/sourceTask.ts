// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * A7（2026-09-26，《Liri 优化方案》）：**题目来源自动化** —— 把本仓代码库变成任务源。
 *
 * **流水线（对齐论文 §3.1–3.3 与方案 §2 A7 的四步）**：
 *  ① 挑"有公开入口 + 可观察输出"的功能 → `discoverSourceCandidates()`；
 *  ② 移除核心实现形成起始点 → `stubFromSource()`；
 *  ③ 基于**原始代码真实执行**生成期望输出 → `bunCasesRunner` + `buildSourceTask()` 的 `goldens`；
 *  ④ 清理泄漏 → `scanSourceLeaks()`（**只报告，不自动清理**）。
 *
 * **"能不能成题"不靠人判断，靠两次真实执行**（本模块的核心价值）：
 *  - 原始实现跑用例必须**全部成功**（否则无法建立 golden）；
 *  - 起始点（桩）跑用例必须**无一条**与 golden 相同（否则"起点已满足"⇒ 题目零区分度）。
 * 任一不成立 ⇒ `status: 'rejected'` 并带原因，**不产出题目**（不静默放过）。
 *
 * **为什么源文件必须"零运行时 import"**：golden 捕获与桩自检都要**独立运行**该模块
 * （启动器只 `import` 目标文件本身）⇒ 有运行时依赖就得复现整套模块解析，流水线不再自洽。
 * `import type` 不产生运行时依赖，**允许**。
 *
 * ⚠️ **已实测的关键泄漏缺口（2026-09-26）与处置**：评测沙箱把 `LIRI_PROJECT_DIR` 指向**真实仓库**
 * （`sandbox.ts` 的 `cwd` / `LIRI_PROJECT_DIR`）⇒ Agent 可直接读**原始实现**抄答案。处置：
 * `tools/pathShield.ts` + `ToolRegistry.executeTool` 在**分派前**拒绝一切引用**题源路径**的工具调用；
 * 且 `materialize()` 产出的 `EvalTask` **自带 `shieldedPaths`（源文件绝对路径）** ⇒ 注册进
 * `allTasks` 时**不会漏**（运行器据此注入沙箱并 fail-closed 校验，见 `evals/shieldPlan.ts`）。
 * 缺口本身仍由 `scanSourceLeaks()` 的 `repo-source` 条目自动报出（见 spec §4.8）。
 */

import { execFile } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  type Dirent,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { resolveProjectRoot } from '@modules/core/paths';
import type {
  EvalTask,
  SourceCaseResult,
  SourceTaskBuild,
  SourceTaskCandidate,
  SourceTaskLeak,
  SourceTaskMaterialization,
  SourceTaskSpec,
} from './types';

const execFileAsync = promisify(execFile);

/**
 * 仓库根 —— **不依赖 DAEMON 的 cwd**（`main.ts` 会把 cwd 设为项目根，但评测 CLI 不是）。
 * 本文件位于 `<root>/app/src/evals/` ⇒ 上溯 3 层即仓库根。
 */
export function resolveEvalRepoRoot(
  env: NodeJS.ProcessEnv = process.env
): string {
  // 2026-09-26（CI 根因修复·第二版）：**模块相对优先**。
  //
  // 第一版只做了"环境变量归一化"（委托 `resolveProjectRoot`），CI 仍红 ⇒ 说明该变量在 CI 里
  // 并不是固定的 `<root>/app`，而是**被别的用例指到别处后残留**（`LIRI_PROJECT_DIR` 是进程级
  // 全局量；评测沙箱会把它指向沙箱/仓库，存在**跨用例污染**，且 CI 的用例顺序与本地不同）。
  //
  // 本文件位于 `<root>/app/src/evals/` ⇒ 上溯 3 层即仓库根，**与 env / cwd 无关**，
  // 天然免疫该污染。同一手法已用于 `getBuiltinProfilesDir()` / `getBuiltinBundlesDir()`
  // —— 那两处上线后 CI 的 `LayersIntegration` 失败**当即消失**，机制已被 CI 实证。
  // 仅当该布局不成立（如打包后 `import.meta.dir` 为虚拟路径）才退回唯一事实源（含 env 归一化）。
  const moduleRelative = resolve(import.meta.dir, '../../..');
  if (existsSync(join(moduleRelative, 'app', 'src'))) return moduleRelative;
  return resolveProjectRoot(env);
}

/** 默认扫描目录（方案 §2 A7：从 `chat/`、`query/`、`tools/` 的纯函数起步，避开 `evals` 自身以免自指） */
export const DEFAULT_SOURCE_DIRS: readonly string[] = [
  'app/src/chat',
  'app/src/query',
  'app/src/tools',
];

/** 扫描时跳过的目录名 */
const SKIP_DIR_NAMES = new Set([
  'node_modules',
  '__tests__',
  'dist',
  'build',
  'fixtures',
  '__fixtures__',
]);

/** 行是否为**运行时** import（`import type` / `import { type … }` 不产生运行时依赖 ⇒ 不算） */
function isRuntimeImport(line: string): boolean {
  if (!/^\s*import\b/.test(line)) return false;
  if (/^\s*import\s+type\b/.test(line)) return false;
  if (/^\s*import\s*\{\s*type\b/.test(line)) return false;
  return true;
}

/** 文件导出的**函数**名（`export function` / `export const x = (` / `= function`） */
function exportedFunctionNames(source: string): string[] {
  const names: string[] = [];
  for (const m of source.matchAll(
    /^\s*export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm
  )) {
    names.push(m[1]);
  }
  for (const m of source.matchAll(
    /^\s*export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(|function\b)/gm
  )) {
    names.push(m[1]);
  }
  return [...new Set(names)];
}

/**
 * 扫描候选任务源：`dirs` 下**零运行时 import** 且至少导出一个函数的 `.ts` 文件。
 *
 * ⚠️ 这是**候选**（启发式），不是"可成题" —— 成题与否由 `buildSourceTask()` 的真实执行自检判定。
 */
export function discoverSourceCandidates(
  root: string,
  dirs: readonly string[] = DEFAULT_SOURCE_DIRS
): SourceTaskCandidate[] {
  const found: SourceTaskCandidate[] = [];

  const walk = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      // @ignore-catch 目录不存在/不可读 ⇒ 该分支无候选，交由调用方从"候选数"看出
      return;
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIR_NAMES.has(entry.name)) walk(abs);
        continue;
      }
      if (!entry.name.endsWith('.ts') || entry.name.endsWith('.d.ts')) continue;

      let source: string;
      try {
        source = readFileSync(abs, 'utf-8');
      } catch {
        // @ignore-catch 单个文件读失败不应中断整轮扫描（下一个候选继续）
        continue;
      }
      const lines = source.split('\n');
      if (lines.some(isRuntimeImport)) continue;

      const exports = exportedFunctionNames(source);
      if (exports.length === 0) continue;
      found.push({
        path: relative(root, abs).split('\\').join('/'),
        exports,
        lines: lines.length,
      });
    }
  };

  for (const dir of dirs) walk(join(root, dir));
  return found.sort((a, b) => a.path.localeCompare(b.path));
}

/** 起始点桩固定的哨兵错误：`buildSourceTask` 据此确认"桩确实可运行且按预期抛错" */
export const STUB_NOT_IMPLEMENTED = 'Not implemented';

/** `from` 之后第一个非空白字符（找不到 ⇒ null） */
function nextNonSpaceChar(source: string, from: number): string | null {
  for (let i = from; i < source.length; i += 1) {
    if (!/\s/.test(source[i])) return source[i];
  }
  return null;
}

/** `{` 的配对 `}` 下标（按花括号计数；类型位置不会出现字符串/注释里的花括号） */
function matchBrace(source: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * 定位**函数体**左花括号（从参数表右括号之后开始扫）；找不到 ⇒ `-1`。
 *
 * ⚠️ **不能用 `indexOf('{')` 直接找**：返回类型可能是**内联对象字面量**或**泛型实参**，它们的 `{`
 * 不是函数体。实测（2026-09-26）：`export function extractCommandInfo(input: string): {
 * name: string; args: string } {` 被误判 ⇒ 生成**语法错误**的桩（`error: Backtrack`），
 * 而自检只看"起始点有没有用例**通过**"⇒ 解析错误被当成"起始态已失败"⇒ **坏题静默放过**
 * （模型即使原样保留桩也永远跑不起来）。
 *
 * 判据：把候选 `{` 与其配对 `}` 视为一个整体；若该 `}` 之后的下一个非空白字符仍属**类型语法**
 * （`{` 内联类型后再接函数体、`|` 联合、`&` 交叉、`>` 泛型闭合、`[` 数组）⇒ 它是类型的一部分，
 * 跳过它继续往后找；否则它就是函数体。扫描途中先遇到 `;` ⇒ 该函数**只有声明没有实现** ⇒ `-1`。
 */
export function findFunctionBodyBrace(source: string, from: number): number {
  for (let i = from; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === ';') return -1;
    if (ch !== '{') continue;
    const close = matchBrace(source, i);
    if (close < 0) return -1;
    const next = nextNonSpaceChar(source, close + 1);
    if (
      next === '{' ||
      next === '|' ||
      next === '&' ||
      next === '>' ||
      next === '['
    ) {
      i = close; // 该花括号组属于类型 ⇒ 跳过，继续找真正的函数体
      continue;
    }
    return i;
  }
  return -1;
}

/**
 * 由源文件生成**起始点桩**：保留 `export function <name>(<params>): <ret>` 签名，实现体换成抛错。
 *
 * 返回 `null` ⇒ **无法机械提取签名**（如 `export const f = () => …` 箭头形式）⇒ 调用方**必须拒绝**
 * 该候选，不得"猜一个"桩（错误的起点会让题目不可解，且不会有人发现）。
 */
export function stubFromSource(
  source: string,
  exportName: string
): string | null {
  const re = new RegExp(
    `^\\s*export\\s+(?:async\\s+)?function\\s+${exportName}\\s*\\(`,
    'm'
  );
  const match = re.exec(source);
  if (!match) return null;

  const openParen = match.index + match[0].length - 1;
  let depth = 0;
  let closeParen = -1;
  for (let i = openParen; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        closeParen = i;
        break;
      }
    }
  }
  if (closeParen < 0) return null;

  const bodyBrace = findFunctionBodyBrace(source, closeParen + 1);
  if (bodyBrace < 0) return null; // 只有声明没有实现 ⇒ 没有"实现"可剥

  const head = source.slice(match.index, openParen).trim();
  const params = source.slice(openParen, closeParen + 1);
  const returnType = source.slice(closeParen + 1, bodyBrace).trim();

  return [
    '// A7 题目起点：实现体已被剥离（请补齐实现；本文件必须保持**零依赖**）',
    `${head}${params}${returnType} {`,
    `  throw new Error('${STUB_NOT_IMPLEMENTED}');`,
    '}',
    '',
  ].join('\n');
}

/**
 * 子进程命令行长度上限保护。
 *
 * Windows `CreateProcess` 的命令行上限为 32767 字符 ⇒ 用例/入口以 JSON 字面量**内联**进启动器
 * 时必须设闸；超限**fail-closed**（逐条记失败），不静默截断。
 */
const DRIVER_MAX_CHARS = 28_000;

/**
 * 生成子进程启动器脚本 —— 用例、导出名、实现路径**全部内联为 JSON 字面量**。
 *
 * 为什么不走环境变量：项目 §1.4 对 `*_*` 环境变量前缀有固定分类，为一次内部传输新增前缀
 * 会污染命名规范（`lint:arch` 会告警）。
 */
function buildCasesDriver(
  implUrl: string,
  exportName: string,
  cases: Array<{ name: string; args: unknown[] }>
): string {
  return `
const cases = ${JSON.stringify(cases)};
const name = ${JSON.stringify(exportName)};
const mod = await import(${JSON.stringify(implUrl)});
const fn = mod[name];
if (typeof fn !== 'function') {
  process.stdout.write(JSON.stringify(cases.map((c) => ({ name: c.name, ok: false, error: '导出 ' + name + ' 不是函数' }))));
} else {
  const out = [];
  for (const c of cases) {
    try {
      out.push({ name: c.name, ok: true, value: await fn(...c.args) });
    } catch (e) {
      out.push({ name: c.name, ok: false, error: String((e && e.message) || e) });
    }
  }
  process.stdout.write(JSON.stringify(out));
}
`;
}

export interface CasesRunInput {
  implPath: string;
  exportName: string;
  cases: Array<{ name: string; args: unknown[] }>;
  timeoutMs?: number;
}

/** 用例执行器（**必须异步**）：实现可替换，便于离线测试与将来改为沙箱内执行 */
export type TsCasesRunner = (
  input: CasesRunInput
) => Promise<SourceCaseResult[]>;

/**
 * 默认执行器：**独立子进程**跑 `bun -e <启动器>`（`process.execPath` = 当前运行时，避免 PATH 差异）。
 *
 * - **异步**（不得用 `execSync`：评测主机也要保持事件循环可用，见 B3-a 的教训）；
 * - **不经宿主 shell**（`execFile` + 参数数组），用例数据以 JSON 字面量内联；
 * - **fail-closed**：子进程失败 / stdout 不可解析 / 启动器超长 ⇒ **每条用例**都记 `ok: false`
 *   （绝不返回空数组 —— 空数组会让"逐例比对"的调用方误判"没有差异"）。
 */
export const bunCasesRunner: TsCasesRunner = async ({
  implPath,
  exportName,
  cases,
  timeoutMs,
}) => {
  const driver = buildCasesDriver(
    pathToFileURL(implPath).href,
    exportName,
    cases
  );
  if (driver.length > DRIVER_MAX_CHARS) {
    return cases.map((c) => ({
      name: c.name,
      ok: false,
      error: `用例数据过大（启动器 ${driver.length} 字符 > 上限 ${DRIVER_MAX_CHARS}）⇒ 拒绝执行`,
    }));
  }

  try {
    const { stdout } = await execFileAsync(process.execPath, ['-e', driver], {
      timeout: timeoutMs ?? 30_000,
      maxBuffer: 4 * 1024 * 1024,
      cwd: dirname(implPath),
      windowsHide: true,
      encoding: 'utf-8',
    });
    return JSON.parse(String(stdout)) as SourceCaseResult[];
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return cases.map((c) => ({
      name: c.name,
      ok: false,
      error: `启动器失败：${reason}`,
    }));
  }
};

/** 按文件名在目录树下有界查找（深度 + 时间双预算，避免扫 `node_modules` 拖死） */
function findByBasename(
  dir: string,
  basename: string,
  maxDepth: number,
  budgetMs: number
): { hits: string[]; truncated: boolean } {
  const hits: string[] = [];
  const deadline = Date.now() + budgetMs;
  let truncated = false;

  const walk = (current: string, depth: number): void => {
    if (hits.length >= 5) return;
    if (Date.now() > deadline) {
      truncated = true;
      return;
    }
    let entries: Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      // @ignore-catch 不可读目录跳过（扫描是尽力而为的泄漏排查，不是完整性证明）
      return;
    }
    for (const entry of entries) {
      const abs = join(current, entry.name);
      if (entry.isFile()) {
        if (entry.name === basename) hits.push(abs);
        continue;
      }
      if (entry.isDirectory() && depth < maxDepth) walk(abs, depth + 1);
    }
  };

  if (existsSync(dir)) walk(dir, 0);
  return { hits, truncated };
}

/** 构建产物目录（编译副本可能残留答案） */
const BUILD_DIRS = ['app/dist', 'dist', 'app/build'] as const;
/** 已安装副本目录 */
const INSTALL_DIRS = ['app/node_modules', 'node_modules'] as const;

/**
 * 泄漏面扫描（方案 §2 A7 流程第 4 步）—— **只报告，不自动清理**。
 *
 * 三类：`repo-source`（原始实现就在仓库里）/ `build-artifact`（编译产物副本）/
 * `installed-copy`（`node_modules` 已安装副本）。
 */
export function scanSourceLeaks(
  root: string,
  sourcePath: string
): SourceTaskLeak[] {
  const leaks: SourceTaskLeak[] = [];
  const abs = resolve(root, sourcePath);
  const basename = abs.split(/[\\/]/).pop() ?? abs;

  if (existsSync(abs)) {
    leaks.push({
      kind: 'repo-source',
      path: abs,
      detail:
        '原始实现**就在仓库里**，而评测沙箱把 `LIRI_PROJECT_DIR` 指向真实仓库（sandbox.ts 的 cwd / LIRI_PROJECT_DIR）⇒ Agent 可直接读到答案。**已提供屏蔽机制**：运行器把本题源路径经 `PERMISSION_SHIELDED_PATHS` 注入沙箱，`ToolRegistry.executeTool` 在分派前拒绝一切引用该路径（含直接父目录）的调用（见 `tools/pathShield.ts`）。本条目的作用改为**如实报出该泄漏面存在**，并核对路径是否随任务下传。',
    });
  }

  for (const dir of BUILD_DIRS) {
    const { hits, truncated } = findByBasename(
      join(root, dir),
      basename,
      3,
      1500
    );
    for (const hit of hits) {
      leaks.push({
        kind: 'build-artifact',
        path: hit,
        detail: '构建产物中存在同名文件（可能是已编译的实现副本）',
      });
    }
    if (truncated) {
      leaks.push({
        kind: 'build-artifact',
        path: join(root, dir),
        detail: '扫描超时（1.5s）⇒ 结果可能不完整',
      });
    }
  }

  for (const dir of INSTALL_DIRS) {
    const { hits } = findByBasename(join(root, dir), basename, 3, 1500);
    for (const hit of hits) {
      leaks.push({
        kind: 'installed-copy',
        path: hit,
        detail: '`node_modules` 下存在同名文件（已安装副本）',
      });
    }
  }

  return leaks;
}

/** 值等价（走 JSON 往返：用例返回值本就限定为可 JSON 化类型） */
function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 由"已通过自检"的材料装配出可用的 `EvalTask`（提示词**只给行为规范与输入，不给期望输出**） */
function materialize(
  spec: SourceTaskSpec,
  stubText: string,
  goldens: SourceCaseResult[],
  runner: TsCasesRunner,
  /** 源文件**绝对**路径（A7 防泄题：作为 `shieldedPaths` 随任务下传） */
  sourceAbsPath: string
): EvalTask {
  return {
    id: spec.id,
    name: spec.name,
    level: 'L1',
    assertionPolarity: 'positive',
    // A7 防泄题：随任务下传题源路径 ⇒ 注册进 allTasks 时不会漏（运行器据此注入沙箱屏蔽）
    shieldedPaths: [sourceAbsPath],
    prompt: (ws) =>
      [
        `工作区 ${ws}/eval_out/impl.ts 是一段被剥离了实现体的模块（起点）。`,
        '',
        '请补齐实现，使其满足以下**可观察行为**：',
        ...spec.behavior.map((b, i) => `  ${i + 1}. ${b}`),
        '',
        '约束：',
        `  · 只修改 eval_out/impl.ts，导出名必须仍为 \`${spec.exportName}\`；`,
        '  · 该文件必须**零依赖**（不得 import 任何模块，也不得去读仓库里的其它文件）；',
        '  · 不得针对输入硬编码特判（判定会用未给出的期望输出逐例比对）。',
        '',
        '完成后回复「已完成」。',
      ].join('\n'),
    setup: async ({ workspace }) => {
      const dir = join(workspace, 'eval_out');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'impl.ts'), stubText, 'utf-8');
    },
    async assert({ workspace }) {
      const impl = join(workspace, 'eval_out', 'impl.ts');
      if (!existsSync(impl)) {
        return {
          pass: false,
          reason: '未产出 eval_out/impl.ts（起点文件既未补齐也未被保留）',
        };
      }
      const got = await runner({
        implPath: impl,
        exportName: spec.exportName,
        cases: spec.cases,
      });
      if (got.length !== goldens.length) {
        return {
          pass: false,
          reason: `用例结果条数不符：期望 ${goldens.length}，实际 ${got.length}`,
        };
      }
      for (let i = 0; i < goldens.length; i += 1) {
        const actual = got[i];
        const golden = goldens[i];
        if (!actual.ok) {
          return {
            pass: false,
            reason: `用例「${spec.cases[i].name}」执行失败：${actual.error ?? '未知原因'}`,
          };
        }
        if (!sameValue(actual.value, golden.value)) {
          return {
            pass: false,
            reason: `用例「${spec.cases[i].name}」输出不符：期望 ${JSON.stringify(
              golden.value
            )}，实际 ${JSON.stringify(actual.value)}`,
          };
        }
      }
      return { pass: true };
    },
  };
}

export interface SourceTaskDeps {
  /** 仓库根（`spec.sourcePath` 相对于它解析） */
  root: string;
  /** 用例执行器（默认独立子进程；测试可注入假执行器） */
  runner?: TsCasesRunner;
}

/**
 * 把一条**任务源规格**加工成题目：真实执行原始实现取 golden → 生成桩 → 真实执行桩自检
 * → 泄漏扫描。任一环节不成立 ⇒ `rejected` 且**不产出题目**。
 */
export async function buildSourceTask(
  spec: SourceTaskSpec,
  deps: SourceTaskDeps
): Promise<SourceTaskMaterialization> {
  const runner = deps.runner ?? bunCasesRunner;
  const reasons: string[] = [];
  const abs = resolve(deps.root, spec.sourcePath);

  if (!existsSync(abs)) {
    return {
      build: {
        id: spec.id,
        status: 'rejected',
        reasons: [`源文件不存在：${spec.sourcePath}`],
        goldens: [],
        stub: [],
        leaks: [],
        shieldedPaths: [abs],
      },
    };
  }

  const source = readFileSync(abs, 'utf-8');

  if (spec.cases.length === 0) {
    reasons.push('未声明任何用例 ⇒ 无法建立 golden');
  }

  const goldens =
    spec.cases.length > 0
      ? await runner({
          implPath: abs,
          exportName: spec.exportName,
          cases: spec.cases,
        })
      : [];
  const failedGoldens = goldens.filter((g) => !g.ok);
  if (failedGoldens.length > 0) {
    reasons.push(
      `原始实现有 ${failedGoldens.length} 条用例执行失败（无法建立 golden）：${failedGoldens
        .map((f) => `${f.name}（${f.error ?? '未知'}）`)
        .join('；')}`
    );
  }

  const stubText = stubFromSource(source, spec.exportName);
  let stubResults: SourceCaseResult[] = [];

  if (stubText === null) {
    reasons.push(
      `无法从源文件机械提取 \`export function ${spec.exportName}\` 签名 ⇒ 拒绝（不生成可能错误的起始点）`
    );
  } else {
    const scratch = mkdtempSync(join(tmpdir(), 'liri-src-stub-'));
    try {
      const stubPath = join(scratch, `${spec.exportName}.ts`);
      writeFileSync(stubPath, stubText, 'utf-8');
      stubResults = await runner({
        implPath: stubPath,
        exportName: spec.exportName,
        cases: spec.cases,
      });
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
    // fail-closed（2026-09-26）：桩必须**可运行**且以哨兵错误收场。
    // 只看"有没有用例通过"不够：语法错误的桩会让**每条**用例都失败（启动器崩溃），
    // 于是"起始点成功数 = 0"成立 ⇒ 坏题静默放过（实测见 `findFunctionBodyBrace` 注释）。
    const notSentinel = stubResults.filter(
      (s) => s.ok || s.error !== STUB_NOT_IMPLEMENTED
    );
    if (notSentinel.length > 0) {
      reasons.push(
        `起始点桩未按预期运行：${notSentinel
          .map(
            (s) => `${s.name}（${s.ok ? '未抛错' : (s.error ?? '未知原因')}）`
          )
          .join(
            '；'
          )} ⇒ 拒绝（桩须可运行且以 \`${STUB_NOT_IMPLEMENTED}\` 收场；` +
          '否则"启动器/解析失败"会被误当成"起始态已失败"）'
      );
    }

    const matched = stubResults.filter(
      (s, i) => s.ok && goldens[i]?.ok && sameValue(s.value, goldens[i]?.value)
    );
    if (matched.length > 0) {
      reasons.push(
        `起始点已通过 ${matched.length} 条用例（${matched
          .map((m) => m.name)
          .join('、')}）⇒ 题目无区分度（起始态必须失败），拒绝`
      );
    }
  }

  const build: SourceTaskBuild = {
    id: spec.id,
    status: reasons.length > 0 ? 'rejected' : 'ready',
    reasons,
    goldens,
    stub: stubResults,
    leaks: scanSourceLeaks(deps.root, spec.sourcePath),
    shieldedPaths: [abs],
  };

  if (build.status === 'rejected' || stubText === null) return { build };
  return { build, task: materialize(spec, stubText, goldens, runner, abs) };
}

/** 批量加工（CLI 干跑用）；逐条独立自检，互不影响 */
export async function runSourceTaskDryRun(
  specs: readonly SourceTaskSpec[],
  deps: SourceTaskDeps
): Promise<SourceTaskMaterialization[]> {
  const out: SourceTaskMaterialization[] = [];
  for (const spec of specs) {
    out.push(await buildSourceTask(spec, deps));
  }
  return out;
}
