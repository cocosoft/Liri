/**
 * 定时器 `unref` 门禁（Timer Unref Linter）
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
 * **两级判据**（尽量低误报；不搞"所有 setInterval 一律 unref"的一刀切 —— 那会把
 * "该定时器就是进程保活来源"的合法场景判违规）：
 * - ❌ **错误（阻断）**：`app/src/**` 中 **模块顶层**（行首无缩进 ⇒ import 时即执行）的
 *   `setInterval(` 未 unref ⇒ **必然**能在导入时挂住任一 CLI 进程。
 * - ⚠️ **警告（不阻断）**：其余未 unref 的 `setInterval` ⇒ 属"存量收敛清单"：仅当该定时器
 *   属**可放弃的周期性观测/维护**、且其宿主**可能被 CLI/脚本 import** 时才需补 `unref()`；
 *   由服务实例（守护进程有 HTTP server 保活）独占的定时器**无需**处理。
 *
 * **豁免**：`src/hooks/**` 与 `*.tsx`（组件生命周期定时器，不进 CLI 路径）。
 *
 * 运行：cd app && bun run lint:unref（cwd = app/，项目根 = ../）
 * 实现约束：Windows 无系统 grep，全部用 Bun/Node 内置 API。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** 项目根目录（scripts/ 的父目录） */
const PROJECT_ROOT = join(import.meta.dir, '..');

/** 扫描根（运行时源码） */
const SRC_DIR = join(PROJECT_ROOT, 'app', 'src');

/** 匹配 `setInterval(`（排除字符串字面量中的提及，见 isInsideStringLiteral） */
const SET_INTERVAL = /setInterval\s*\(/g;

/** 判定"是否已 unref"的向后窗口（行数）——覆盖多行语句里的 `const t = setInterval(...); t.unref();` */
const UNREF_LOOKAHEAD_LINES = 12;

/** 已 unref 判据 */
const UNREF = /\.unref\s*\(/;

interface Hit {
  file: string;
  line: number;
  /** 该行原文（trim 后用于展示） */
  snippet: string;
  /** 模块顶层（行首无缩进） */
  moduleScope: boolean;
  unrefed: boolean;
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
      const openParenIdx = (lineOffsets[i] ?? 0) + idx + m[0].length - 1;
      const callEnd = findCallEnd(stripped, openParenIdx);
      let chainedUnref = false;
      if (callEnd > 0) {
        // 取到本语句结束（`;` 或换行）为止的片段
        const rest = stripped.slice(callEnd + 1, callEnd + 400);
        const stmtTail = rest.split('\n').slice(0, 2).join('\n');
        chainedUnref = /\.unref\b/.test(stmtTail);
      }
      const windowText = strippedLines
        .slice(i, i + UNREF_LOOKAHEAD_LINES)
        .join('\n');
      const unrefed = chainedUnref || UNREF.test(windowText);

      hits.push({
        file: relative(PROJECT_ROOT, file).replace(/\\/g, '/'),
        line: i + 1,
        snippet: (rawLines[i] ?? '').trim().slice(0, 120),
        moduleScope: /^\S/.test(strippedLines[i] ?? ''),
        unrefed,
      });
    }
  }
}

function main(): void {
  /** `--list`：输出**全量清单**（普查用；含每处的顶层/已 unref 标记），不只看汇总 */
  const listAll = process.argv.includes('--list');

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

  const blocking = hits.filter((h) => h.moduleScope && !h.unrefed);
  const warnings = hits.filter((h) => !h.moduleScope && !h.unrefed);
  const okCount = hits.length - blocking.length - warnings.length;

  const byDir = new Map<string, number>();
  for (const w of warnings) {
    const dir = w.file.split('/').slice(0, 3).join('/');
    byDir.set(dir, (byDir.get(dir) ?? 0) + 1);
  }

  console.log(
    `[unref] 扫描 ${files.length} 个文件：setInterval 共 ${hits.length} 处 ` +
      `（已 unref ${okCount} / 顶层未 unref ${blocking.length} / 其余未 unref ${warnings.length}）`
  );

  if (blocking.length > 0) {
    console.log(
      '\n❌ 模块顶层 `setInterval` 未 `unref()`（导入即执行 ⇒ 必然挂住 CLI/脚本进程）：'
    );
    for (const b of blocking) {
      console.log(`  - ${b.file}:${b.line}  ${b.snippet}`);
    }
    console.log(
      '\n修法：`const t = setInterval(...); t.unref?.();` —— 保留定时器行为，但不让它撑住进程。' +
        '\n依据：附带发现 7 / 仓内既有惯例（TurnLivenessWatchdog、ChannelSessionManager、rateLimiter 等）。'
    );
  }

  if (warnings.length > 0) {
    console.log(
      `\n⚠️  其余未 unref 的 setInterval ${warnings.length} 处（**不阻断**，属存量收敛清单）：`
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

    if (listAll) {
      console.log('\n--- 全量清单（file:line + 顶层标记 + 已 unref 标记）---');
      for (const h of hits) {
        console.log(
          `${h.unrefed ? '[unref]' : '[     ]'} ${h.moduleScope ? '[TOP]' : '[   ]'} ${
            h.file
          }:${h.line}`
        );
      }
    }
  }

  if (blocking.length > 0) process.exit(1);
  console.log('\n✅ unref 门禁通过（无顶层未 unref 的 setInterval）');
  process.exit(0);
}

main();
