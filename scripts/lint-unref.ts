/**
 * 定时器 `unref` / 生命周期门禁（Timer Unref Linter）
 *
 * **背景**（`dev_docs/error_repairs/预存错误与待处理问题.md` → 附带发现 7，2026-09-25）：
 * 实测 `scripts/bench-memory-dedup.ts` 三次运行**都打印了 `[done]` 却不退出**
 * （各 ~270MB WS，数分钟直至被手工 `Stop-Process`）。根因定位用打桩探针
 * （`app/scripts/probe-memory-handles.ts`）确认：`MemoryManagerImpl` 的**导入链**间接拉起
 * 两个单例，而它们的**周期性定时器未 `unref()`** ⇒ 任何以 import 方式触碰该链的
 * CLI/脚本进程都会被**永久撑住**（`1` 个 5s 刷缓冲、`1` 个 60s 缓存清理）。
 *
 * **与已有 `lint:exit` 的分工（互补，不重复）**：
 * - `lint:exit` 治**标**：要求 `package.json#scripts` 引用的**入口脚本**显式 `process.exit`
 *   （台账 N-16 / N-49，"同一类缺陷已复发两次"）。
 * - 本 linter 治**本**：**库/服务侧不得用"可放弃的周期性定时器"撑住进程** ——
 *   入口显式退出的写法**挡不住**被 import 的模块在导入时就注册未 unref 的定时器。
 *
 * **两级判据（2026-10-19 扩展）**：
 * - ❌ **错误（阻断）**：`app/src/**` 中 **模块顶层**（行首无缩进 ⇒ import 时即执行）的
 *   `setInterval(` 未 unref ⇒ **必然**能在导入时挂住任一 CLI 进程。
 * - ⚠️ **警告（不阻断）**：函数作用域内未 unref 的 `setInterval`（存量收敛清单）。
 * - ❌ **错误（基线棘轮）**：**类作用域**内的 `setInterval` 必须同时满足：
 *   ① 返回值赋给定时器句柄（`*Timer` / `*Interval` / `*Handle` 字段或同名局部量后被字段接管）；
 *   ② 同一个类内有清理入口（`clearInterval` / `.stop*()` / `.dispose()`）；
 *   ③ 已 `unref()`（不阻塞进程退出）。
 *   存量违规写入 `.trae/architecture/timer-unref-baseline.json`（**只拦新增**）；
 *   更新基线：`bun run scripts/lint-unref.ts --update-baseline`。
 *
 * **豁免**：`src/hooks/**` 与 `*.tsx`（组件生命周期定时器，不进 CLI 路径）。
 *
 * 运行：cd app && bun run lint:unref（cwd = app/，项目根 = ../）
 * 实现约束：Windows 无系统 grep，全部用 Bun/Node 内置 API。
 */

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

/** 项目根目录（scripts/ 的父目录） */
const PROJECT_ROOT = join(import.meta.dir, '..');

/** 扫描根（运行时源码） */
const SRC_DIR = join(PROJECT_ROOT, 'app', 'src');

/** 匹配 `setInterval(`（排除字符串字面量中的提及，见 isInsideStringLiteral） */
const SET_INTERVAL = /setInterval\s*\(/g;

/** 判定"是否已 unref"的向后窗口（行数）——覆盖多行语句里的 `const t = setInterval(...); t.unref();` */
const UNREF_LOOKAHEAD_LINES = 12;

/** 已 unref 判据（同时覆盖 `.unref()` 与可选链 `.unref?.()`） */
const UNREF = /\.unref\s*(?:\?\.)?\s*\(/;

interface Hit {
  file: string;
  line: number;
  /** 该行原文（trim 后用于展示） */
  snippet: string;
  /** 模块顶层（行首无缩进） */
  moduleScope: boolean;
  unrefed: boolean;
  /** 是否位于 class 作用域内 */
  classScope: boolean;
  /** 类内是否存在清理入口（clearInterval / .stop*() / .dispose()） */
  classHasCleanup: boolean;
  /** 返回值是否落入定时器句柄（*Timer / *Interval / *Handle） */
  handleAssigned: boolean;
  /** 类作用域违规原因（空数组 = 合规） */
  instanceReasons: string[];
}

/** class 体在源码中的绝对偏移区间（start 指向 `{` 之后，end 指向 `}`） */
interface ClassRange {
  start: number;
  end: number;
}

/**
 * 剥离注释（复用 `lint-script-exit.ts` 的既定策略：宁可多剥，不漏剥）。
 *
 * **关键**：块注释必须**等量保留换行**（用空格填充非换行字符）—— 否则多行块注释
 * 被替换成空串后**行号整体位移**，报告出的位置会指到无关代码（本 linter 首版实测踩到：
 * `ChannelSessionManager.ts:365` 的片段显示为 `}`）。
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/.*$/gm, '');
}

/** 该匹配是否落在字符串字面量里（如 `content.includes('setInterval(')`） */
function isInsideStringLiteral(lineText: string, matchIndex: number): boolean {
  let quote: string | null = null;
  for (let i = 0; i < matchIndex; i++) {
    const ch = lineText[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
    }
  }
  return quote !== null;
}

/**
 * 从 `setInterval(` 的左括号起，**括号配平**找到调用结尾。
 *
 * 必要性（本 linter 首版实测的假阳性）：真实写法常是
 * `setInterval(\n  () => { ...几十行... },\n  60000\n).unref?.();`
 * —— `unref()` 出现在**多行回调结束之后**，离 `setInterval(` 远超固定的"向后 N 行"窗口，
 * 于是被判成"未 unref"。运行时打桩探针（真值）证实这类其实**已 unref**。
 */
function findCallEnd(text: string, openParenIdx: number): number {
  let depth = 0;
  for (let i = openParenIdx; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** 从 `class X {` 的左花括号起做花括号配平，返回 class 体的结束下标 */
function findBlockEnd(text: string, openBraceIdx: number): number {
  let depth = 0;
  for (let i = openBraceIdx; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** 收集所有 class 体的绝对偏移区间（用于判定 setInterval 是否在类作用域内） */
function findClassRanges(text: string): ClassRange[] {
  const ranges: ClassRange[] = [];
  const re = /\bclass\s+[A-Za-z_$][\w$]*[^{]*\{/g;
  for (const m of text.matchAll(re)) {
    const open = (m.index ?? 0) + m[0].length - 1;
    const end = findBlockEnd(text, open);
    if (end > 0) ranges.push({ start: open + 1, end });
  }
  return ranges;
}

/** 类内是否有清理入口：clearInterval / .stop*() / .dispose() */
function detectClassCleanup(classBody: string): boolean {
  return (
    /clearInterval\s*\(/.test(classBody) ||
    /\.stop\w*\s*\(/.test(classBody) ||
    /\.dispose\s*\(/.test(classBody)
  );
}

/**
 * 返回值是否落入定时器句柄。
 *
 * 覆盖两种既有写法：
 * - 同行：`this.syncTimer = setInterval(...)` / `const timer = setInterval(...)`
 * - 多行：`const timer = setInterval(...); ... this.rotationTimer = timer;`
 *
 * 句柄名必须带 Timer / Interval / Handle 语义（避免把任意赋值误判为受管）。
 */
function detectHandleAssignment(
  stripped: string,
  lineText: string,
  idxInLine: number,
  absOffset: number
): boolean {
  const before = lineText.slice(0, idxInLine);
  const sameLine = before.match(
    /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*=\s*$/
  );
  if (sameLine && /timer|interval|handle/i.test(sameLine[1])) return true;

  const window = stripped.slice(absOffset, absOffset + 1200);
  return /this\.[A-Za-z_$][\w$]*(?:timer|interval|handle)[\w$]*\s*=/i.test(window);
}

/** 递归收集 .ts/.tsx（跳过测试/类型声明与 UI 豁免目录） */
function collectFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'hooks' || entry.name === 'node_modules') continue;
      collectFiles(full, acc);
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (/\.d\.ts$/.test(entry.name)) continue;
    acc.push(full);
  }
  return acc;
}

function scanFile(file: string, hits: Hit[]): void {
  const raw = readFileSync(file, 'utf-8');
  const stripped = stripComments(raw);
  const rawLines = raw.split('\n');
  const strippedLines = stripped.split('\n');

  // 每行在 `stripped` 中的**绝对起始偏移**（`m.index` 是**行内**下标，配平需要绝对偏移）
  const lineOffsets: number[] = [];
  {
    let acc = 0;
    for (const l of strippedLines) {
      lineOffsets.push(acc);
      acc += l.length + 1;
    }
  }

  const classRanges = findClassRanges(stripped);

  for (let i = 0; i < strippedLines.length; i++) {
    const lineText = strippedLines[i];
    for (const m of lineText.matchAll(SET_INTERVAL)) {
      const idx = m.index ?? 0;
      // 落在字符串字面量内的提及不算（注释已剥离，此处只剩字符串）
      if (isInsideStringLiteral(lineText, idx)) continue;

      // unref 判定（两条路径，任一命中即视为已 unref）：
      // ① **链式/紧跟**：括号配平找到调用结尾，检查其后的本语句片段是否含 `.unref`
      //    （覆盖 `setInterval(...).unref?.()` 与"多行回调结束后再 unref"）；
      // ② **向后窗口**：覆盖 `const t = setInterval(...); ... t.unref();` 与
      //    `if (typeof t.unref === 'function') t.unref();` 这类形态。
      const absOffset = (lineOffsets[i] ?? 0) + idx;
      const openParenIdx = absOffset + m[0].length - 1;
      const callEnd = findCallEnd(stripped, openParenIdx);
      let chainedUnref = false;
      if (callEnd > 0) {
        // 同名方法声明（如 `setInterval(intervalMs: number): void {`）不是调用，跳过
        const afterCall = stripped.slice(callEnd + 1, callEnd + 120);
        if (/^\s*:\s*[^{;]+?\{/.test(afterCall)) continue;

        // 取到本语句结束后的片段（最多 800 字符，且不跨入下一个 setInterval），
        // 覆盖 `setInterval(...); ... timer.unref();` 与
        // `if (typeof timer.unref === 'function') timer.unref();` 等形态
        const rest = stripped.slice(callEnd + 1, callEnd + 800);
        const nextTimer = rest.indexOf('setInterval(');
        const stmtTail = nextTimer >= 0 ? rest.slice(0, nextTimer) : rest;
        chainedUnref = /\.unref\b/.test(stmtTail);
      }
      const windowText = strippedLines
        .slice(i, i + UNREF_LOOKAHEAD_LINES)
        .join('\n');
      const unrefed = chainedUnref || UNREF.test(windowText);

      // 类作用域判定（2026-10-19）：实例级定时器必须「有句柄 + 有清理 + unref」
      const classRange =
        classRanges.find((r) => absOffset >= r.start && absOffset <= r.end) ??
        null;
      const classScope = classRange !== null;
      const classHasCleanup = classScope
        ? detectClassCleanup(stripped.slice(classRange.start, classRange.end))
        : false;
      const handleAssigned = detectHandleAssignment(
        stripped,
        lineText,
        idx,
        absOffset
      );
      const instanceReasons: string[] = [];
      if (classScope) {
        if (!handleAssigned) instanceReasons.push('no-handle');
        if (!classHasCleanup) instanceReasons.push('no-cleanup');
        if (!unrefed) instanceReasons.push('no-unref');
      }

      hits.push({
        file: relative(PROJECT_ROOT, file).replace(/\\/g, '/'),
        line: i + 1,
        snippet: (rawLines[i] ?? '').trim().slice(0, 120),
        moduleScope: /^\S/.test(strippedLines[i] ?? ''),
        unrefed,
        classScope,
        classHasCleanup,
        handleAssigned,
        instanceReasons,
      });
    }
  }
}

/** 实例级违规基线（存量收敛清单；只拦新增） */
const BASELINE_PATH = join(
  PROJECT_ROOT,
  '.trae',
  'architecture',
  'timer-unref-baseline.json'
);

interface BaselineFile {
  schemaVersion: number;
  updatedAt?: string;
  /** file（相对项目根）→ 该文件的实例级违规数量 */
  files: Record<string, number>;
}

function loadBaseline(): BaselineFile {
  try {
    const parsed = JSON.parse(
      readFileSync(BASELINE_PATH, 'utf-8')
    ) as Partial<BaselineFile>;
    if (parsed && typeof parsed.files === 'object' && parsed.files) {
      return {
        schemaVersion: parsed.schemaVersion ?? 1,
        updatedAt: parsed.updatedAt,
        files: parsed.files as Record<string, number>,
      };
    }
  } catch {
    // 基线缺失/损坏 ⇒ 视为空基线（所有实例级违规都算新增，fail-closed）
  }
  return { schemaVersion: 1, files: {} };
}

function main(): void {
  /** `--list`：输出**全量清单**（普查用；含每处的顶层/已 unref 标记），不只看汇总 */
  const listAll = process.argv.includes('--list');
  /** `--update-baseline`：把当前实例级违规写成基线（存量收敛期使用） */
  const updateBaseline = process.argv.includes('--update-baseline');

  const files = collectFiles(SRC_DIR).filter(
    (f) => !f.endsWith('.tsx') // UI 组件豁免
  );

  const hits: Hit[] = [];
  for (const f of files) {
    try {
      if (!statSync(f).isFile()) continue;
      scanFile(f, hits);
    } catch {
      // 读取失败（权限/竞态）不阻断检查
    }
  }

  const topBlocking = hits.filter((h) => h.moduleScope && !h.unrefed);
  // 函数作用域未 unref：保持既有"告警不阻断"口径（类作用域另行判定）
  const warnings = hits.filter(
    (h) => !h.moduleScope && !h.unrefed && !h.classScope
  );
  const instanceViolations = hits.filter((h) => h.instanceReasons.length > 0);
  const okCount =
    hits.length -
    topBlocking.length -
    warnings.length -
    instanceViolations.length;

  // 按文件统计实例级违规（基线棘轮：只拦新增）
  const currentCounts = new Map<string, number>();
  for (const v of instanceViolations) {
    currentCounts.set(v.file, (currentCounts.get(v.file) ?? 0) + 1);
  }

  if (updateBaseline) {
    const baseline: BaselineFile = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      files: Object.fromEntries(
        [...currentCounts.entries()].sort(([a], [b]) => a.localeCompare(b))
      ),
    };
    mkdirSync(dirname(BASELINE_PATH), { recursive: true });
    writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`, 'utf-8');
    console.log(
      `[unref] 已更新基线：${relative(PROJECT_ROOT, BASELINE_PATH)}` +
        `（${instanceViolations.length} 处实例级存量违规，${currentCounts.size} 个文件）`
    );
    process.exit(0);
  }

  const baseline = loadBaseline();
  const offendingFiles = new Set(
    [...currentCounts.keys()].filter(
      (file) => (currentCounts.get(file) ?? 0) > (baseline.files[file] ?? 0)
    )
  );
  const newInstanceViolations = instanceViolations.filter((v) =>
    offendingFiles.has(v.file)
  );
  const baselineCovered = instanceViolations.length - newInstanceViolations.length;

  const byDir = new Map<string, number>();
  for (const w of warnings) {
    const dir = w.file.split('/').slice(0, 3).join('/');
    byDir.set(dir, (byDir.get(dir) ?? 0) + 1);
  }

  console.log(
    `[unref] 扫描 ${files.length} 个文件：setInterval 共 ${hits.length} 处 ` +
      `（合规 ${okCount} / 顶层未 unref ${topBlocking.length} / ` +
      `类作用域违规 ${instanceViolations.length}（基线内 ${baselineCovered}）/ ` +
      `函数作用域未 unref ${warnings.length}）`
  );

  if (topBlocking.length > 0) {
    console.log(
      '\n❌ 模块顶层 `setInterval` 未 `unref()`（导入即执行 ⇒ 必然挂住 CLI/脚本进程）：'
    );
    for (const b of topBlocking) {
      console.log(`  - ${b.file}:${b.line}  ${b.snippet}`);
    }
    console.log(
      '\n修法：`const t = setInterval(...); t.unref?.();` —— 保留定时器行为，但不让它撑住进程。' +
        '\n依据：附带发现 7 / 仓内既有惯例（TurnLivenessWatchdog、ChannelSessionManager、rateLimiter 等）。'
    );
  }

  if (newInstanceViolations.length > 0) {
    console.log(
      '\n❌ 新增实例级定时器违规（相对基线，未在 `.trae/architecture/timer-unref-baseline.json` 中）：'
    );
    for (const v of newInstanceViolations) {
      console.log(
        `  - ${v.file}:${v.line} [${v.instanceReasons.join(',')}]  ${v.snippet}`
      );
    }
    console.log(
      '\n修法（三件齐全才算合规）：' +
        '\n  ① `this.xxxTimer = setInterval(...)`（句柄入字段，不用裸调用）；' +
        '\n  ② 同类提供 `stop()` / `dispose()`，内部 `clearInterval(this.xxxTimer)`；' +
        '\n  ③ 启动后 `timer.unref?.()`，避免阻塞 CLI/测试进程退出。' +
        '\n依据：BUG-1/BUG-2（定时器生命周期专项）。'
    );
  }

  if (warnings.length > 0) {
    console.log(
      `\n⚠️  函数作用域未 unref 的 setInterval ${warnings.length} 处（**不阻断**，属存量收敛清单）：`
    );
    for (const [dir, n] of [...byDir.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  - ${dir}/ : ${n}`);
    }
    console.log(
      '  收敛判据（逐处人工判定，不做一刀切）：该定时器若属**可放弃的周期性观测/维护**，' +
        '且其宿主**可能被 CLI/脚本 import** ⇒ 补 `unref()`；\n' +
        '  若仅由服务实例独占（守护进程有 HTTP server 保活）⇒ 无需处理。\n' +
        '  **权威判定工具**：`bun app/scripts/probe-memory-handles.ts <模块路径>` —— 实测"导入该模块时' +
        '哪些未 unref 定时器被真实拉起"（静态扫描无法判定 import 可达性）。\n' +
        '  **全量清单**：`bun run scripts/lint-unref.ts --list`。'
    );
  }

  if (listAll) {
    console.log(
      '\n--- 全量清单（file:line + 顶层/类作用域 + 已 unref + 违规原因）---'
    );
    for (const h of hits) {
      const tags = [
        h.unrefed ? '[unref]' : '[     ]',
        h.moduleScope ? '[TOP]' : h.classScope ? '[CLS]' : '[FUN]',
        h.instanceReasons.length > 0
          ? `[${h.instanceReasons.join(',')}]`
          : '[     ]',
      ].join(' ');
      console.log(`${tags} ${h.file}:${h.line}`);
    }
  }

  if (topBlocking.length > 0 || newInstanceViolations.length > 0) process.exit(1);
  console.log(
    '\n✅ unref / 定时器生命周期门禁通过（无顶层未 unref、无新增实例级违规）'
  );
  process.exit(0);
}

main();
