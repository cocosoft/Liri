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
 * 命令规范化"单一事实源"（S1-5，2026-10-11）—— G22 + G10 同根。
 *
 * 背景：`BashTool.execute` 内部存在**四份口径** —— 审批哈希、安全拦截层、最终 spawn、
 * 审批卡展示 —— 它们各自对同一命令做了**不同**的解析/改写：
 * - 平台改写（Windows：`/tmp`→`%TEMP%`、`/dev/null`→`NUL`、全角冒号 token 加引号）
 *   发生在审批哈希（`BashTool.ts:593`）**之前** ⇒ "审批卡展示的命令 ≠ 执行的命令"（G10）；
 * - 路径探测与基命令白名单各自内联解析，口径可能与哈希漂移（G22 尤指 Windows 分支
 *   缺 Unix 绝对路径/敏感目录探测）。
 *
 * 本模块提供 `standardizeCommand()`：**一次计算**即产出 `raw / preprocessed / normalized`
 * 三种表示与路径/基命令派生结果；`BashTool` 的四处消费者**全部读取同一对象**，
 * 避免"各算各的"导致的口径漂移。
 *
 * ⚠️ 修正 2（方案 §4.5.4）：**不做**"统一转 POSIX 语义"（cmd.exe/PowerShell 执行不了）；
 * 这里只做**统一规范化口径**。`preprocessed` 即最终 spawn 的字符串（保留原语义/多行），
 * `normalized` 仅用于审批哈希与展示（`normalizeCommand` 会折叠换行，**不可用于 spawn**）。
 */
import { normalizeCommand } from '@modules/permission';

/** 平台预处理结果 */
export interface PreprocessResult {
  /** 预处理后的命令（即最终将执行的字符串） */
  command: string;
  /** 非阻断告警（含 `禁止:` 前缀者为阻断项，由调用方判定） */
  warnings: string[];
  /** 实际发生的改写项（供审批快照记录"用户看到的 ≠ 最终执行的"） */
  rewrites: string[];
}

/**
 * Windows 命令预处理：翻译常见 Unix 路径和命令（纯函数）。
 *
 * 自 `BashTool.preprocessWindowsCommand` 迁出，成为命令改写的**唯一**发生点（S1-5）。
 * 改写 3 处：`/tmp`→`%TEMP%`、`/dev/null`→`NUL`、含全角冒号的路径 token 加引号；
 * 告警 2 类（不阻断）：Unix-only 命令、`cd /x`（后者含 `禁止:` 前缀 ⇒ 阻断）。
 */
export function preprocessWindowsCommand(command: string): PreprocessResult {
  const warnings: string[] = [];
  const rewrites: string[] = [];
  let processed = command;

  // 检测 Unix 专用命令（Windows cmd.exe 中不存在）
  const unixOnlyCommands = ['head', 'tail', 'sed', 'awk', 'xargs', 'tee'];
  const cmdWords = processed.split(/\s+/);
  for (const cmd of unixOnlyCommands) {
    if (cmdWords.some((w) => w === cmd || w === `${cmd}.exe`)) {
      warnings.push(
        `${cmd} 是 Unix/Linux 命令，Windows cmd.exe 中不可用。请使用 PowerShell: pwsh -Command "..." 或改用 Windows 等价命令。`
      );
    }
  }

  // 自动翻译常见 Unix 路径为 Windows 路径
  if (processed.includes('/tmp')) {
    processed = processed.replace(/\/tmp\b/g, '%TEMP%');
    warnings.push('已自动将 /tmp 替换为 %TEMP%');
    rewrites.push('/tmp → %TEMP%');
  }
  if (processed.includes('/dev/null')) {
    processed = processed.replace(/\/dev\/null\b/g, 'NUL');
    warnings.push('已自动将 /dev/null 替换为 NUL');
    rewrites.push('/dev/null → NUL');
  }

  // 检测 2>&1 重定向（Windows cmd.exe 也支持，但确保格式正确）
  // 无需修改，cmd.exe 支持 2>&1

  // 检测 && 链式命令（cmd.exe 支持）
  // 无需修改，cmd.exe 支持 &&

  // 检测仅包含 Unix 路径的命令（禁止执行）
  if (/\bcd\s+\/[a-z]/.test(processed)) {
    warnings.push(
      '禁止: cd 到 Unix 根路径（如 /tmp、/usr）。请使用 Windows 路径或 %TEMP%。'
    );
  }

  // 方案六 P1-5：对含全角冒号（：）等特殊字符且未加引号的路径 token 自动加引号，
  // 避免 cmd.exe 解析含全角字符的文件路径失败（如 `标的1-标包10：云景....docx`）
  const beforeColonQuote = processed;
  processed = processed.replace(
    /(^|[\s"'|;&,()<>])(?!["'])([^\s"'|;&,()<>]*：[^\s"'|;&,()<>]*)/g,
    (match, prefix: string, token: string) => {
      // 前缀为引号说明 token 已在引号上下文内，跳过避免双重包裹
      if (prefix === '"' || prefix === "'") return match;
      return `${prefix}"${token}"`;
    }
  );
  if (processed !== beforeColonQuote) {
    rewrites.push('含全角冒号的路径 token 自动加引号');
  }

  return { command: processed, warnings, rewrites };
}

/**
 * 疑似路径 token 提取（统一口径）——替代 `BashTool` 内联正则。
 *
 * 覆盖：`--key=/path` 形式、Unix 绝对路径、Windows 盘符路径（`C:\` / `C:/`）、
 * 反斜杠根路径 / UNC（`\etc`、`\\host`）。
 * 返回**全部**候选（非仅首个），使"多个路径只查第一个"的盲区被消除。
 *
 * B2-1（2026-10-30，issue #36）：改为 **argv 感知**（先切 token 再判路径），
 * 真机实测旧正则把 Windows 开关 / findstr 搜索模式当 Unix 绝对路径：
 * ```
 * findstr /n /c:"app/src" /c:"../../app" x.ts
 *   ⇒ ["/n","/c:","/src","/c:","/../app","/c:"]  ⇒ 误判「路径遍历」硬拒
 * ```
 * 现在：`/n`、`/b`、`/ad`、`/c:"…"` 这类开关/模式**整体排除**（仅 Windows 语义下），
 * 引号内的相对片段（`app/src`、`../../app`）不再被当成绝对路径。
 *
 * @param options.isWindows 是否按 Windows 开关语义过滤（缺省 false = POSIX 口径，不过滤）
 */
export function extractPathCandidates(
  command: string,
  options: { isWindows?: boolean } = {}
): string[] {
  const isWindows = options.isWindows === true;
  const out: string[] = [];
  for (const raw of tokenizeCommand(command)) {
    const token = stripOuterQuotes(raw.trim());
    if (!token) continue;
    // `--key=value` ⇒ 只判 value（与旧口径一致）
    const eq = /^--?[\w-]+=(.+)$/.exec(token);
    const candidate = stripOuterQuotes((eq ? eq[1] : token).trim());
    if (!candidate) continue;
    if (isWindows && isWindowsSwitchToken(candidate)) continue;
    if (
      /^\/[^\s'"]*$/.test(candidate) ||
      /^[A-Za-z]:[\\/][^\s'"]*$/.test(candidate) ||
      /^\\+[^\s'"]+$/.test(candidate)
    ) {
      out.push(candidate);
    }
  }
  return out;
}

/**
 * 引号感知切 token：空白与 shell 分隔符（`| & ; < >`）处断开，引号内不断开。
 * 引号**保留**在 token 内（后续开关判定要能看到 `/c:"…"` 的冒号）。
 */
function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  let buf = '';
  let quote: '"' | "'" | null = null;
  const push = (): void => {
    const trimmed = buf.trim();
    if (trimmed) tokens.push(trimmed);
    buf = '';
  };
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      buf += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
      continue;
    }
    if (
      ch === '|' ||
      ch === '&' ||
      ch === ';' ||
      ch === '<' ||
      ch === '>' ||
      /\s/.test(ch)
    ) {
      push();
      continue;
    }
    buf += ch;
  }
  push();
  return tokens;
}

/** 去掉包裹 token 的最外层引号（仅首尾，不影响内部引号） */
function stripOuterQuotes(token: string): string {
  let t = token;
  if (t.length >= 2) {
    const first = t[0];
    const last = t[t.length - 1];
    if ((first === '"' || first === "'") && first === last) {
      t = t.slice(1, -1);
    }
  }
  return t;
}

/** Unix 顶层目录：即便只有 1–3 个字母，也**不得**当成 Windows 开关 */
const UNIX_TOP_DIRS = new Set([
  '/etc',
  '/usr',
  '/var',
  '/tmp',
  '/dev',
  '/bin',
  '/lib',
  '/opt',
  '/sys',
  '/sbin',
  '/root',
  '/home',
  '/boot',
  '/proc',
]);

/**
 * 是否为 Windows 命令行**开关 / 搜索模式**（`/n`、`/b`、`/ad`、`/c:"…"`）。
 *
 * 判据刻意保守：仅「`/` + 1–3 个字母（可带冒号参数）」且**不是** Unix 顶层目录
 * ⇒ 开关。多段路径（`/usr/local`）与更长名字（`/path`）一律仍按路径判定（fail-closed）。
 */
function isWindowsSwitchToken(token: string): boolean {
  if (!token.startsWith('/')) return false;
  if (/^\/[A-Za-z]{1,3}:/.test(token)) return true;
  if (!/^\/[A-Za-z]{1,3}$/.test(token)) return false;
  return !UNIX_TOP_DIRS.has(token.toLowerCase());
}

/** 是否为 Unix 绝对路径（以 `/` 开头） */
export function isUnixAbsolutePath(p: string): boolean {
  return p.startsWith('/');
}

/**
 * 是否为 Unix **敏感系统目录**下的路径（Windows 分支 fail-closed 判据）。
 *
 * 仅匹配真实系统目录（`/etc`、`/usr`…）而**不**匹配单字母开关（`/i`、`/b`、`/c:`），
 * 避免误伤 `findstr /i`、`dir /b` 等 Windows 合法用法（这正是"不能只补 `^\//`"的原因，G22）。
 */
export function isUnixSensitivePath(p: string): boolean {
  return /^\/(etc|usr|proc|sys|dev|root|boot|bin|sbin|var|home|lib|opt)(\/|$)/i.test(
    p
  );
}

/**
 * 派生基命令名（小写、去路径前缀、去 `.exe/.cmd/.bat/.ps1/.com` 扩展名）。
 * 与 `BashTool` 白名单/解释器判定的归一化口径一致（S1-5：消除重复解析）。
 */
export function deriveBaseCommand(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) return '';
  const firstWord = trimmed.split(/\s+/)[0].toLowerCase();
  const baseName = firstWord.replace(/^.*[/\\]/, '');
  return baseName.replace(/\.(exe|cmd|bat|ps1|com)$/i, '');
}

/**
 * 规范化命令（引号感知压缩空白 + 运算符贴边、保留大小写）。
 * 单一事实源 = `@modules/permission` 的 `normalizeCommand`（审批哈希同源）。
 */
export { normalizeCommand };

/** `standardizeCommand()` 的一次性产出 —— `BashTool` 四处消费者共用此对象 */
export interface StandardizedCommand {
  /** 模型/用户原始命令（任何处理之前） */
  raw: string;
  /** 平台预处理后的命令 —— **最终 spawn 的字符串**（保留多行/引号原语义） */
  preprocessed: string;
  /** 规范化文本 —— 审批哈希与审批卡展示口径（**不可用于 spawn**：会折叠换行） */
  normalized: string;
  /** 预处理改写项 */
  rewrites: string[];
  /** 预处理告警（含 `禁止:` 前缀者为阻断项） */
  warnings: string[];
  /** 派生基命令名（小写、无路径、无扩展名） */
  baseCommand: string;
  /** 提取到的疑似路径候选（全部） */
  paths: string[];
  /** 其中的 Unix 绝对路径 */
  unixAbsolutePaths: string[];
  /** 其中命中 Unix 敏感系统目录者（Windows 分支 fail-closed 依据） */
  unixSensitivePaths: string[];
}

/**
 * 命令规范化的**唯一入口**。
 *
 * @param raw 原始命令
 * @param opts.isWindows 是否按 Windows 语义预处理（默认按 `process.platform`）
 */
export function standardizeCommand(
  raw: string,
  opts: { isWindows?: boolean } = {}
): StandardizedCommand {
  const isWindows = opts.isWindows ?? process.platform === 'win32';
  const pre = isWindows
    ? preprocessWindowsCommand(raw)
    : { command: raw, warnings: [] as string[], rewrites: [] as string[] };
  const preprocessed = pre.command;
  const paths = extractPathCandidates(preprocessed, { isWindows });
  const unixAbsolutePaths = paths.filter(isUnixAbsolutePath);
  return {
    raw,
    preprocessed,
    normalized: normalizeCommand(preprocessed),
    rewrites: pre.rewrites,
    warnings: pre.warnings,
    baseCommand: deriveBaseCommand(preprocessed),
    paths,
    unixAbsolutePaths,
    unixSensitivePaths: unixAbsolutePaths.filter(isUnixSensitivePath),
  };
}
