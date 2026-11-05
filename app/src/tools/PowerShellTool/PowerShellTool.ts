import { TOOL_NAME_CONSTANTS } from '../toolNameConstants';
/**
 * PowerShell 工具（Windows专用）
 *
 * 提供安全的 PowerShell 命令执行功能
 * 参考 BashTool 实现，适配 Windows 环境
 */

import { z } from 'zod';
import { BaseTool } from '../BaseTool';
import { ToolResult, createToolResult, ErrorLevel } from '../types/ToolResult';
import { ToolUseContext } from '../types/ToolUseContext';
import {
  ToolParam,
  InterruptBehavior,
  ToolValidationResult,
  ToolTag,
  ToolCallProgress,
} from '../types/Tool';
import {
  createSuccessResult,
  createFailureResult,
  checkPathAccessibility,
  // P0（2026-11-03）：cwd 必须"存在且是目录"（与 BashTool 同一口径）
  isDirectoryPath,
  // LRO-10（2026-10-26）：空输出判定/文案与 BashTool 同一口径（禁止双轨）
  isEmptyOutput,
  EMPTY_OUTPUT_HINT,
} from '../utils/ToolUtils';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { realpathSync, existsSync } from 'fs';
import {
  DELETION_RULES,
  // P2-2/P2-3（2026-11-03）：删除别名 / 只读目录统一由 infra 提供（禁止本地再写一份）
  POWERSHELL_DELETION_ALIASES,
  POWERSHELL_ALLOWED_COMMAND_PREFIXES,
  POWERSHELL_READ_ONLY_COMMAND_PATTERNS,
  securityIntegrationService,
} from '@openliri/infra/security';
import { SandboxSecurityChecker } from '@modules/sandbox';
import { completeSecuritySystem } from '@openliri/infra/security';
import { configManager } from '@openliri/infra/config';
import type { PermissionConfig } from '@openliri/infra/config/types';

import { getLogger } from '@openliri/infra/monitoring';
const logger = getLogger('tools:PowerShellTool:PowerShellTool');

/**
 * PowerShell 安全命令白名单（F3 修复）
 * 仅允许以这些 PowerShell 动词/命令开头的命令执行
 * P2-3：清单已收敛到 `@openliri/infra/security`（`POWERSHELL_ALLOWED_COMMAND_PREFIXES`）
 */
const ALLOWED_POWERSHELL_COMMANDS: ReadonlySet<string> =
  POWERSHELL_ALLOWED_COMMAND_PREFIXES;

/** 沙箱安全检查器实例（F2 修复：二次校验） */
const psSandboxChecker = new SandboxSecurityChecker();

/**
 * 按 `;` / 换行把脚本拆成语句（引号内的分隔符不切）。
 *
 * 原实现只取整段脚本的**第一个 token** 做前缀匹配 ⇒ `$f='x'; Get-Item $f` 取到
 * `$f='x';` 被判"不在允许列表"。白名单应按**每条被执行语句**的动词判定。
 */
function splitPowerShellStatements(command: string): string[] {
  const statements: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === ';' || ch === '\n' || ch === '\r') {
      statements.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  statements.push(current);
  return statements.map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * P1-2④（2026-11-05）：剥离**前导字符串字面量 + `+` 拼接**，让后续命令继续参与白名单校验。
 *
 * 真机（会话 `session_mvwkdol840f68a0ebe`，19 条 `powershell:allowlist` 中的 2 条）：
 * ```
 * "node: " + (Get-Command node -ErrorAction SilentlyContinue).Source; "bun: " + (Get-Command bun …)
 * ```
 * 旧实现（G3，2026-11-03）遇到引号开头一律判「不是命令」⇒ 语句里唯一的只读命令
 * `Get-Command` **从未被校验**，而整条脚本又因「零动词」被拒 ⇒ 模型看到
 * 「命令「node: 」不在允许列表」，无从自纠。
 *
 * 边界（安全面**不缩小**）：
 *   · 只剥「引号字符串 + `+`」这一种前缀；剥完剩下的部分照常解析 ——
 *     `"x" + (Remove-Item …)` 会得到 `remove-item` ⇒ 仍然拒绝（原因还更准确）；
 *   · 剥完为空（纯字符串语句，如分隔线 `"---"`）⇒ 返回 `null`，由既有零动词规则处理；
 *   · 引号后紧跟别的东西（如 `'…' -f $a`）⇒ 原样返回，交回既有分支（`isReadOnlyFormatExpression`）。
 */
function stripLeadingStringConcat(statement: string): string {
  let cur = statement.trim();
  for (;;) {
    const m = /^(['"])([^'"]*)\1\s*/.exec(cur);
    if (!m) return cur;
    const after = cur.slice(m[0].length).trim();
    if (after.startsWith('+')) {
      cur = after.slice(1).trim();
      continue;
    }
    // 引号后紧跟别的东西（如 `-f`）⇒ 返回**当前位置**（不回到原始串，避免丢掉已剥离的部分）
    return after === '' ? '' : cur;
  }
}

/**
 * 提取一条语句实际执行的命令动词。
 *
 * - 纯注释 / 纯字面量赋值（`$f='x'`）⇒ `null`（不构成命令）；
 * - `$x = Get-Item ...` ⇒ 右侧仍是命令，继续解析；
 * - `(Get-Item x).Length` ⇒ 剥离前导 `(` 后取动词 `get-item`；
 * - **调用运算符** `& node script.js` / `& "C:\...\node.exe"` ⇒ 取被调用程序名
 *   （2026-10-19 修复：此前 `&` 导致动词为 `null` ⇒ 整条脚本被误判"不在允许列表"，
 *   进而连续 3 轮全失败触发 circuit_breaker）；
 * - 点源 `. script.ps1` 仍返回 `null`（`.ps1` 属任意代码，不在白名单 ⇒ 由零动词规则拒绝）。
 */
function extractPowerShellStatementVerb(statement: string): string | null {
  let rest = statement.trim();
  if (!rest || rest.startsWith('#')) return null;
  // 块界符 / 续行符单独成行时不是命令（`{`、`}`、`)`、`|` 等）
  if (/^[{}()[\]]\s*$/.test(rest)) return null;
  if (rest === '|' || rest === '\\') return null;

  const assignment = rest.match(/^\$[A-Za-z_][\w:]*\s*=\s*/);
  if (assignment) {
    rest = rest.slice(assignment[0].length).trim();
    if (!rest || rest.startsWith("'") || rest.startsWith('"')) return null;
  }

  // FIX-3（2026-10-27）：**哈希表 / 传参键值行**不是命令。
  // 多行字面量 `@{ errors = 0; isError = $true }` 的无 `$` 行此前被当动词
  // （`errors=0` ⇒ 动词 `errors`），产生「命令「errors」不在允许列表」的误杀。
  if (/^[A-Za-z_][\w.-]*\s*[=:]/.test(rest)) return null;

  // 调用运算符：剥离 `&`（点源 `.` 不剥离 ⇒ 保守拒绝脚本）
  const hadCallOperator = /^&\s*/.test(rest);
  rest = rest.replace(/^&\s*/, '');
  if (!rest) return null;

  // P1-2④（2026-11-05）：前导字符串拼接（`"node: " + (Get-Command node).Source`）——
  // 剥掉标签字符串后**继续按命令解析**，使括号里的真实命令进入白名单校验。
  const withoutStringPrefix = stripLeadingStringConcat(rest);
  if (withoutStringPrefix !== rest) {
    if (!withoutStringPrefix) return null; // 纯字符串语句（echo / 分隔线）
    rest = withoutStringPrefix;
  }

  // `& 'C:\Program Files\nodejs\node.exe'` ⇒ 取 basename（仅去 .exe/.cmd/.bat/.com；
  // **不**去 .ps1 —— 避免把 `node.ps1` 误认成 `node`）
  const quotedExe = /^(['"])([^'"]+)\1/.exec(rest);
  if (quotedExe) {
    // G3（2026-11-03）：**没有调用运算符**的引号开头语句是**表达式**，不是命令。
    // 真机 `'{0} | {1}' -f $a,$b` 曾被解析成「命令「{0} | {1}」不在允许列表」——
    // 把格式化字符串当命令名，模型无法据此自纠。表达式改由 `isReadOnlyFormatExpression`
    // 在零动词分支放行，含重定向/管道时仍交回命令判定（不因本修复放宽写文件）。
    if (!hadCallOperator) return null;
    return quotedExe[2]
      .replace(/^.*[/\\]/, '')
      .replace(/\.(exe|cmd|bat|com)$/i, '')
      .toLowerCase();
  }

  rest = rest.replace(/^\(\s*/, '');
  // 保留点号以识别 `node.ps1` 一类脚本名（旧正则 `[\w-]` 会在 `.` 处截断）
  const verb = rest.match(/^[A-Za-z][\w.-]*/);
  return verb
    ? verb[0].toLowerCase().replace(/\.(exe|cmd|bat|com)$/i, '')
    : null;
}

/**
 * 引号外是否出现指定字符（`chars` 为单字符集合）。
 *
 * 引号感知：`'{0} | {1}'` 里的 `|` 在引号内 ⇒ 不算管道。
 * 不处理转义（单引号 `''` / 双引号反引号）—— 那会让配对提前结束、把引号内内容判成
 * 引号外 ⇒ **更严格**（可能误拒，不会误放），安全方向正确。
 */
function hasUnquotedChar(statement: string, chars: string): boolean {
  let quote: '"' | "'" | null = null;
  for (const ch of statement) {
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (chars.includes(ch)) return true;
  }
  return false;
}

/**
 * G3（2026-11-03）：**只读格式化表达式**放行判定。
 *
 * `'{0} | {1}' -f $a,$b` 是纯内存文本拼接（无 I/O 副作用），但安全门此前把它解析成
 * 「命令「{0} | {1}」不在允许列表」（真机 seq 1420）—— 模型无法据此自纠。
 *
 * 放行条件（**全部**满足；任一不满足 ⇒ 交回命令判定，不放宽写文件/执行面）：
 *  1. 语句以引号字符串开头，且引号闭合后紧跟 `-f` 格式化运算符；
 *  2. **引号外**无 `> < | &`（重定向 / 管道 / 调用运算符）；
 *  3. 全文无 `$(`（命令替换，双引号内也会执行 ⇒ 不分引号内外一律排除）。
 */
function isReadOnlyFormatExpression(statement: string): boolean {
  const trimmed = statement.trim();
  const quote = trimmed[0];
  if (quote !== "'" && quote !== '"') return false;
  if (trimmed.includes('$(')) return false;

  const closeAt = trimmed.indexOf(quote, 1);
  if (closeAt < 0) return false; // 引号未闭合 ⇒ 不判定
  if (!/^-f\b/i.test(trimmed.slice(closeAt + 1).trim())) return false;

  return !hasUnquotedChar(trimmed, '><|&');
}

/** 拒绝原因（F4，2026-10-27） */
export interface PowerShellNotAllowed {
  /** 人读原因（可直接拼进错误报文） */
  reason: string;
  /** 命中的语句（截断 ≤120 字）—— 让模型知道该改哪一段 */
  statement?: string;
  /** 命中的动词（命令名） */
  verb?: string;
}

/**
 * 方法调用**只读白名单**（§12.4 方案 B，2026-10-27 安全评审后收窄）。
 *
 * 背景：原实现只要出现 `obj.Method(…)` 就整脚本 fail-closed，真机 83 次拒绝里
 * 可解释的 3 例都是 `$_.Line.Substring(0,260)` 这类**文本整理**（Liri R2）。
 *
 * 收窄口径 = **方法名逐字命中白名单**，且名单内全部无 I/O 副作用：
 * - 放行：字符串只读方法（截取/裁剪/切分/大小写/比较/补齐/拼接）；
 * - 继续拒绝：`Delete` / `MoveTo` / `CopyTo` / `Create` / `Open*` / `Invoke` /
 *   `GetType` 等有副作用或可串到反射的入口 —— `GetType` 尤其关键，
 *   `$x.GetType().GetMethod('Delete').Invoke(...)` 一步就能绕过本白名单。
 *   同理，静态调用 `[Type]::Method(…)` 仍整条拒绝（见 `explainPowerShellNotAllowed` ②）。
 */
const ALLOWED_READONLY_METHODS = new Set([
  'substring',
  'trim',
  'trimstart',
  'trimend',
  'split',
  'replace',
  'tolower',
  'tolowerinvariant',
  'toupper',
  'toupperinvariant',
  'startswith',
  'endswith',
  'contains',
  'indexof',
  'lastindexof',
  'padleft',
  'padright',
  'tostring',
  'join',
  // FIX-4（2026-10-27）：纯内存集合/时间转换（无副作用），真机高频误杀
  'containskey',
  'getenumerator',
  'tolocaltime',
  'touniversaltime',
]);

/**
 * FIX-4（2026-10-27）：静态调用**只读类型白名单**。
 *
 * 原实现「见 `::` 即整条拒绝」—— 真机 19 次命中 `[Type]::Method(…)`，其中包括
 * `[datetime]::ParseExact` / `[math]::Round` 这类纯计算，导致分析脚本写不出来。
 * 收窄口径：**类型名逐字命中**白名单才放行；`[System.IO.File]::Delete` 一类仍拒绝。
 */
const ALLOWED_STATIC_TYPES = new Set([
  'datetime',
  'math',
  'string',
  'convert',
  'guid',
  'timespan',
]);

/** 取第一处**不在**只读类型白名单的静态调用（无 ⇒ `null`） */
function findDisallowedStaticCall(command: string): string | null {
  for (const match of command.matchAll(
    /\[\s*([A-Za-z_][\w.]*)\s*\]\s*::\s*([A-Za-z_]\w*)\s*\(/g
  )) {
    const rawType = match[1];
    // `[System.Math]::…` 与 `[math]::…` 同义：去掉 `System.` 前缀再比
    const normalized = rawType.toLowerCase().replace(/^system\./, '');
    if (!ALLOWED_STATIC_TYPES.has(normalized)) {
      return `${rawType}::${match[2]}`;
    }
  }
  return null;
}

/** 取脚本中**第一处不在只读白名单**的方法调用名（无 ⇒ `null`） */
function findDisallowedMethodCall(command: string): string | null {
  for (const match of command.matchAll(/\.([A-Za-z_]\w*)\s*\(/g)) {
    const name = match[1].toLowerCase();
    if (!ALLOWED_READONLY_METHODS.has(name)) return name;
  }
  return null;
}

/**
 * FIX-3（2026-10-27）：PowerShell **控制流关键字**。
 *
 * 它们不是"命令"，但本安全门不做 AST 解析 ⇒ 无法证明块内命令全只读。
 * 此前报文写成「命令「foreach」不在允许列表」—— 把语法结构说成命令，模型改不动
 * （真机实测 2 次）。现单独识别并给出可执行的改写建议。
 */
const POWERSHELL_CONTROL_KEYWORDS = new Set([
  'if',
  'elseif',
  'else',
  'foreach',
  'for',
  'while',
  'do',
  'switch',
  'try',
  'catch',
  'finally',
  'function',
  'param',
  'begin',
  'process',
  'end',
]);

/** 单个动词是否命中白名单（`get-` 为前缀族，其余精确匹配） */
function isAllowedPowerShellVerb(verb: string): boolean {
  for (const allowed of ALLOWED_POWERSHELL_COMMANDS) {
    if (allowed.endsWith('-') ? verb.startsWith(allowed) : verb === allowed) {
      return true;
    }
  }
  return false;
}

/**
 * P0（2026-11-03，cwd 方案 §六.1）：控制流拒绝的**单条等价写法**提示。
 *
 * 口径：每条提示自身必须过本白名单（否则模型照抄又被拒——真机已实测这类死循环）。
 * - 循环族（foreach/for/while/do）→ 管道投影；确需逐条处理 ⇒ 拆成多次工具调用；
 * - 条件族（if/switch）→ 判断留给模型：先跑只读命令拿事实，再按结果发下一条；
 * - try/catch → 去掉包裹直接执行，失败文本由工具原样返回；
 * - function/param → 不定义函数，改写为一条内联命令。
 */
function controlFlowSingleCommandHint(verb: string): string {
  if (
    verb === 'foreach' ||
    verb === 'for' ||
    verb === 'while' ||
    verb === 'do'
  ) {
    return '等价单条写法：用一条管道投影代替循环，如「Get-ChildItem <目录> | Select-Object -ExpandProperty Name」；确需逐条处理请拆成多次工具调用（每次一条命令）';
  }
  if (
    verb === 'if' ||
    verb === 'elseif' ||
    verb === 'else' ||
    verb === 'switch'
  ) {
    return '等价单条写法：先跑一条只读命令拿事实（如「Test-Path <路径>」），再按结果发下一条命令（判断留给模型，不写进脚本）';
  }
  if (verb === 'try' || verb === 'catch' || verb === 'finally') {
    return '等价单条写法：去掉 try/catch 直接执行单条命令——失败时工具会原样返回错误文本供你处理';
  }
  // function / param / begin / process / end
  return '等价单条写法：不定义函数，把函数体改写成一条内联命令直接执行';
}

/**
 * F4（2026-10-27）：**给出拒绝原因**而非只回布尔值。
 *
 * 真机实测（会话 `session_mvoqs1ho875ea6b95e`，Liri 报告 R2）：83 次拒绝报文都写成
 * `PowerShell 命令 "<首词>" 不在允许列表` —— 而真实原因往往**不是**首词那条命令
 * （可能是脚本里另一处方法调用/静态调用）。模型据此改不动，只能反复重试。
 *
 * ⚠️ **方法调用已按 §12.4 方案 B 收窄**（2026-10-27 安全评审）：只放行
 * `ALLOWED_READONLY_METHODS` 里的**只读方法**（`$_.Line.Substring(…)`、`.ContainsKey(…)` 一类）；
 * 静态调用按 `ALLOWED_STATIC_TYPES` 的**只读类型白名单**放行（FIX-4），其余仍整条 fail-closed。
 *
 * @returns `null` = 允许；否则为可读拒绝原因
 */
export function explainPowerShellNotAllowed(
  command: string
): PowerShellNotAllowed | null {
  if (!command.trim()) return { reason: '命令为空' };

  // ① 方法调用（方案 B：只读方法名白名单，其余 fail-closed）
  const disallowedMethod = findDisallowedMethodCall(command);
  if (disallowedMethod) {
    return {
      reason:
        `检测到方法调用「.${disallowedMethod}(…)」不在只读白名单；允许的纯内存方法：Substring/Trim/Split/Replace/ToLower/ToUpper/StartsWith/EndsWith/Contains/IndexOf/PadLeft/PadRight/ToString/Join/ContainsKey/GetEnumerator/ToLocalTime（其余请去掉方法链）` +
        `｜等价单条写法：文本检索用「Select-String -Path <文件> -Pattern '<词>'」或「findstr /C:"词" <文件>」；取文件属性用「Get-Item <路径> | Select-Object Length,LastWriteTime」`,
    };
  }
  // ② 静态方法调用（FIX-4：只读类型白名单；其余仍 fail-closed）
  const disallowedStatic = findDisallowedStaticCall(command);
  if (disallowedStatic) {
    return {
      reason:
        `检测到静态方法调用「${disallowedStatic}(…)」不在只读类型白名单（仅 ${[
          ...ALLOWED_STATIC_TYPES,
        ].join('/')}）；请改写为单一命令` +
        `｜等价单条写法：读文件用「Get-Content <路径>」；列目录用「Get-ChildItem <路径>」；存在性判断用「Test-Path <路径>」`,
    };
  }

  const statements = splitPowerShellStatements(command);
  const verbs = statements.map(extractPowerShellStatementVerb);

  // ③ 无可执行动词：纯赋值/注释仍拒；但**只读表达式**（方法链/静态调用）应放行 ——
  //    `[math]::Round(1.5)` / `$h.ContainsKey('x')` 这类语句的动词提取本就是 null，
  //    其安全性已由 ①（只读方法白名单）与 ②（只读类型白名单）逐条闸过。
  //    FIX-3（2026-10-27）：否则"能算出结果的分析表达式"会被当成"空脚本"误杀。
  if (verbs.filter((v): v is string => v !== null).length === 0) {
    const hasReadOnlyExpression =
      /\.[A-Za-z_]\w*\s*\(/.test(command) ||
      /\[\s*[A-Za-z_][\w.]*\s*\]\s*::/.test(command) ||
      // G3（2026-11-03）：`'{0} | {1}' -f $a,$b` 一类纯格式化表达式（逐语句判定，
      // 引号外的重定向/管道/命令替换已在 `isReadOnlyFormatExpression` 内排除）
      statements.some(isReadOnlyFormatExpression);
    if (hasReadOnlyExpression) return null;
    return {
      reason:
        '脚本没有可执行命令（纯赋值/注释），不在允许列表' +
        '｜等价单条写法：去掉赋值直接执行，如「Get-ChildItem <目录> | Select-Object Name,Length」',
    };
  }

  // ④ 逐语句取动词：报**第一处未命中**的语句与动词（不再拿首词背锅）
  for (let i = 0; i < statements.length; i++) {
    const verb = verbs[i];
    if (verb === null) continue;
    if (POWERSHELL_CONTROL_KEYWORDS.has(verb)) {
      return {
        reason:
          `控制流「${verb}」不在支持范围（安全门只判定单条命令）；请改用管道 / Where-Object，或拆成多次工具调用` +
          `｜${controlFlowSingleCommandHint(verb)}`,
        statement: statements[i].trim().slice(0, 120),
        verb,
      };
    }
    if (isAllowedPowerShellVerb(verb)) continue;
    return {
      // FIX-6（2026-10-27）：报文补**允许摘要** —— 真机 65 次白名单拒绝中模型只能靠试错
      // 反推边界（信息熵黑洞）。给一句"允许哪几族"，一次拒绝即可自纠。
      reason:
        `命令「${verb}」不在允许列表｜允许的常用族：Get-/Test-/Select-/Where-/Format-/Out-/ConvertTo-/ConvertFrom-/Write-；` +
        `执行器：node/npm/bun/git/python；文件：New-Item/Copy-Item/Move-Item/Rename-Item/Expand-Archive；导航：cd/Set-Location` +
        `｜等价单条写法示例：列目录「Get-ChildItem <目录>」；搜文本「Select-String -Path <文件> -Pattern '<词>'」`,
      statement: statements[i].trim().slice(0, 120),
      verb,
    };
  }

  return null;
}

/**
 * 检查 PowerShell 命令是否在白名单中
 * @param command PowerShell 命令
 * @returns 是否允许
 *
 * 导出仅供单测断言（`PowerShellTool.execute` 会在真正 spawn 前调用它）。
 * F4：改为 `explainPowerShellNotAllowed(...) === null` 的薄封装 —— 判定逻辑单点，
 * 调用方可另取原因（不再出现"首词背锅"的报文）。
 */
export function isPowerShellCommandAllowed(command: string): boolean {
  return explainPowerShellNotAllowed(command) === null;
}

/**
 * PowerShell 安全链判定结果（G-07，2026-10-19）。
 *
 * `PowerShellTool.execute` 与 `tools/bash/powerShellWrapper` **共用**本结构：
 * 后者把 `powershell -Command "…"` 的内层脚本交给同一入口判定，避免两套口径。
 */
export interface PowerShellSecurityDecision {
  allowed: boolean;
  behavior: 'allow' | 'ask' | 'deny';
  /** 拒绝码（与 `PowerShellTool.execute` 既有 metadata.errorCode 逐字一致） */
  code?:
    | 'SECURITY_DENIED'
    | 'USER_CONFIRMATION_REQUIRED'
    | 'COMMAND_NOT_ALLOWED'
    | 'SANDBOX_SECURITY_DENIED';
  /** 人读原因（不含 "安全检查失败:" 等前缀，由调用方按自身语义拼装） */
  message?: string;
}

/**
 * PowerShell 命令安全链的**唯一判定入口**（G-07）。
 *
 * 顺序与原 `PowerShellTool.execute` 内联块**逐字一致**：
 * ① 项目沙箱临时文件安全删除（`_` / `~$` 前缀且 realpath 在工作目录内）⇒ 直接放行；
 * ② `PowerShellSecurityAnalyzer`（deny / ask）；
 * ③ 白名单 `isPowerShellCommandAllowed`；
 * ④ `SandboxSecurityChecker` 二次校验。
 *
 * @param command 待判定的 PowerShell 脚本（**内层**脚本，不含 `powershell -Command` 包裹）
 * @param options.workingDirectory 提供时启用 ① 的"沙箱内安全删除"例外（与 `PowerShellTool` 同口径）
 * @param options.analyzer 复用调用方的分析器实例（缺省新建；BashTool 侧用惰性单例）
 * @param options.trustLevel 工作区信任级别（`development` / `work` 时放宽**白名单未命中**，
 *   与 `BashTool` 同源；未传 = 既有 fail-closed 行为）
 */
export function evaluatePowerShellSecurity(
  command: string,
  options: {
    workingDirectory?: string;
    analyzer?: PowerShellSecurityAnalyzer;
    /**
     * 工作区信任级别（2026-10-31，台账「PowerShell 信任分级」项）。
     *
     * 与 `BashTool` **同源同口径**：`securityIntegrationService.getTrustLevelForPath(cwd)`。
     * 语义（**只管白名单未命中**，不放宽危险命令）：
     *  - `development` / `work` ⇒ 白名单外的**非危险**命令放行（原为硬拒，模型无改错机会）；
     *  - 其余（含未传）⇒ 保持既有硬拒（fail-closed，零行为变更）。
     *
     * 刻意**不放宽**的两档（与 Bash 的差异，如实）：
     *  ① 分析器 `ask`（递归删除 / 防火墙 / 建用户 / 改密码 …）仍要求人工确认；
     *  ② 沙箱危险命令仍拒。二者都属"真危险"，不受信任级别影响。
     */
    trustLevel?: string;
  } = {}
): PowerShellSecurityDecision {
  if (
    options.workingDirectory &&
    isSandboxSafeDelete(command, options.workingDirectory)
  ) {
    return { allowed: true, behavior: 'allow' };
  }

  const analyzer = options.analyzer ?? new PowerShellSecurityAnalyzer();
  const securityResult = analyzer.analyze(command);
  if (securityResult.behavior === 'deny') {
    return {
      allowed: false,
      behavior: 'deny',
      code: 'SECURITY_DENIED',
      message: securityResult.message || '命令被阻止执行',
    };
  }
  if (securityResult.behavior === 'ask') {
    return {
      allowed: false,
      behavior: 'ask',
      code: 'USER_CONFIRMATION_REQUIRED',
      message: securityResult.message || '此命令需要确认后执行',
    };
  }

  const trustedWorkspace =
    options.trustLevel === 'development' || options.trustLevel === 'work';
  const notAllowed = explainPowerShellNotAllowed(command);
  // 未受信 ⇒ 与改造前逐字一致：白名单未命中即硬拒（先于沙箱检查，fail-closed）。
  if (notAllowed && !trustedWorkspace) {
    // F4（2026-10-27）：报文必须指向**真实原因与命中语句**；旧实现只回显首词
    //（`PowerShell 命令 "Select-String" 不在允许列表`），而实际原因可能是别处的方法调用。
    return {
      allowed: false,
      behavior: 'deny',
      code: 'COMMAND_NOT_ALLOWED',
      message:
        `PowerShell 命令被拒绝：${notAllowed.reason}` +
        (notAllowed.verb ? `｜动词：${notAllowed.verb}` : '') +
        (notAllowed.statement ? `｜语句：${notAllowed.statement}` : ''),
    };
  }

  const sandboxCheckResult = psSandboxChecker.checkDangerousCommands(command);
  if (!sandboxCheckResult.allowed) {
    return {
      allowed: false,
      behavior: 'deny',
      code: 'SANDBOX_SECURITY_DENIED',
      message: sandboxCheckResult.reason,
    };
  }

  // 受信工作区 + 白名单未命中 + 非危险（已过分析器与沙箱两道）⇒ 放行（Bash 同款口径）
  if (notAllowed) {
    return {
      allowed: true,
      behavior: 'allow',
      message:
        `[信任工作区·${options.trustLevel}] 非危险命令已放行：${notAllowed.reason}` +
        (notAllowed.verb ? `｜动词：${notAllowed.verb}` : ''),
    };
  }

  return { allowed: true, behavior: 'allow' };
}

/**
 * 方案三（P0-3）：判断是否为「项目沙箱内的安全删除」。
 * 放行条件（3b 安全约束）：
 *  - 命令为删除类（del / Remove-Item / ri / rm / erase）
 *  - 目标解析后真实路径（realpath）仍在工作目录（项目沙箱）内，阻断符号链接逃逸
 *  - 目标文件名以 `_` 或 `~$` 前缀（临时脚本/Office 锁文件）
 *  - 拒绝通配符 / `.` / `..`（不允许整目录删除）
 */
function isSandboxSafeDelete(
  command: string,
  workingDirectory: string
): boolean {
  const lower = command.toLowerCase();
  const isDelete =
    /(^|[\s;|&])del(\s|\/)/.test(lower) ||
    /(^|[\s;|&])remove-item(\s|-)/.test(lower) ||
    /(^|[\s;|&])ri(\s|-)/.test(lower) ||
    /(^|[\s;|&])rm(\s|-)/.test(lower) ||
    /(^|[\s;|&])erase(\s)/.test(lower);
  if (!isDelete) return false;

  // 提取目标路径（优先引号路径，其次命令最后一个 token）
  const quoted = command.match(/["']([^"']+)["']/);
  const tokens = command.split(/\s+/).filter(Boolean);
  const target = (quoted?.[1] ?? tokens[tokens.length - 1]).trim();
  if (!target || target.includes('*') || target === '.' || target === '..') {
    return false;
  }

  try {
    const abs = path.resolve(workingDirectory, target);
    if (!existsSync(abs)) return false;
    const realAbs = realpathSync(abs);
    const realCwd = realpathSync(workingDirectory);
    const inside =
      realAbs.startsWith(realCwd + '\\') || realAbs.startsWith(realCwd + '/');
    if (!inside) return false;
    const name = path.basename(realAbs);
    return name.startsWith('_') || name.startsWith('~$');
  } catch {
    return false;
  }
}

/**
 * PowerShell 输入模式
 * 安全审计修复：移除 skipSecurityCheck 参数，安全检查强制运行
 */
const PowerShellInputSchema = z.strictObject({
  command: z.string().min(1, '命令不能为空').describe('要执行的PowerShell命令'),
  timeout: z
    .number()
    .int()
    .positive()
    .max(300000)
    .optional()
    .default(60000)
    .describe('超时时间（毫秒）'),
  workingDirectory: z.string().optional().describe('命令工作目录'),
  executionPolicy: z
    .string()
    .optional()
    .default('Bypass')
    .describe('PowerShell执行策略'),
  depth: z
    .number()
    .int()
    .positive()
    .max(1000)
    .optional()
    .describe('输出深度限制：限制返回的对象数量，避免输出过于冗长'),
  exclude: z
    .string()
    .optional()
    .describe('排除模式：从输出中排除包含此文本的行（简单文本匹配，非正则）'),
});

/**
 * PowerShell 输出模式
 */
const PowerShellOutputSchema = z.object({
  output: z.string().describe('命令输出'),
  executionTime: z.number().int().nonnegative().describe('执行耗时（毫秒）'),
  exitCode: z.number().int().optional().describe('退出码'),
});

const execAsync = promisify(exec);

/**
 * F7b（2026-10-27）：把 PowerShell 执行失败报文整理成**可诊断**形态。
 *
 * 真机实测（Liri 报告 P2-1）失败报文只剩 `pwsh -NoProfile … -EncodedCommand <base64>`，
 * 既看不到脚本也看不到 stderr ⇒ 模型/用户无法定位。这里做两件事：
 * ① 把 `-EncodedCommand <base64>` 换成**真实脚本预览**（压缩空白、截断 120 字）；
 * ② 有 stderr 时回填**末 40 行**（`exec` 的错误对象才带 stderr，取不到就不追加，不臆造）。
 *
 * 抽成纯函数是为了让这段"只能等真机失败才能看"的逻辑有自动化用例
 * （原先内联在 `execute` 的 catch 里，无法单测）。
 */
export function describePowerShellFailure(
  errorMessage: string,
  commandPreview: string,
  streams: { stdout?: string; stderr?: string } = {}
): string {
  let failureDetail = errorMessage;
  if (failureDetail.includes('-EncodedCommand')) {
    failureDetail = failureDetail.replace(
      /-EncodedCommand\s+\S+/,
      `-Command "<脚本预览: ${commandPreview.replace(/\s+/g, ' ').slice(0, 120)}>"`
    );
  }
  const stderrText =
    typeof streams.stderr === 'string' ? streams.stderr.trim() : '';
  if (stderrText) {
    const stderrTail = stderrText.split(/\r?\n/).slice(-40).join('\n');
    failureDetail += `\n[stderr]\n${stderrTail}`;
  }
  return failureDetail;
}

/**
 * PowerShell 命令执行工具类
 * 专用于 Windows 环境的命令执行
 */
export class PowerShellTool extends BaseTool {
  name = TOOL_NAME_CONSTANTS.powershell;
  description =
    '在 Windows 系统上执行 PowerShell 命令。用于 Windows 特有的管理、注册表操作和系统管理。';

  override tags = [ToolTag.CODE];

  /** A-4（2026-10-18）：能力声明位 —— 执行任意 PowerShell 命令 */
  override sandboxLevel = 'execution' as const;

  params: ToolParam[] = [
    {
      name: 'command',
      type: 'string',
      description: '要执行的 PowerShell 命令',
      required: true,
      example: 'Get-Process | Select-Object -First 10',
    },
    {
      name: 'timeout',
      type: 'number',
      description: '超时时间（毫秒）',
      required: false,
      default: 60000,
    },
    {
      name: 'workingDirectory',
      type: 'string',
      description: '命令的工作目录',
      required: false,
    },
    {
      name: 'executionPolicy',
      type: 'string',
      description: 'PowerShell 执行策略（Bypass、RemoteSigned 等）',
      required: false,
      default: 'Bypass',
    },
    {
      name: 'depth',
      type: 'number',
      description: '将输出限制为 N 个对象，避免结果过于冗长',
      required: false,
    },
    {
      name: 'exclude',
      type: 'string',
      description: '排除包含此文本的输出行（简单文本匹配）',
      required: false,
    },
  ];

  override aliases = ['ps', 'pwsh', 'ps1'];
  searchTips = ['powershell', 'windows', 'admin', 'registry', 'wmi'];
  override searchHint = 'windows administration powershell';

  private securityAnalyzer: PowerShellSecurityAnalyzer;

  constructor() {
    super();
    this.securityAnalyzer = new PowerShellSecurityAnalyzer();
  }

  override validateInput(input: any): ToolValidationResult {
    const result = PowerShellInputSchema.safeParse(input);
    if (!result.success) {
      const errors = result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');
      return { result: false, message: `PowerShell输入验证失败: ${errors}` };
    }
    return { result: true };
  }

  override isReadOnly(input?: Record<string, unknown>): boolean {
    const command = (input?.command as string)?.toLowerCase() || '';
    return POWERSHELL_READ_ONLY_COMMAND_PATTERNS.some((pattern) =>
      pattern.test(command)
    );
  }

  override isConcurrencySafe(input?: Record<string, unknown>): boolean {
    return this.isReadOnly(input);
  }

  override interruptBehavior(): InterruptBehavior {
    return 'cancel';
  }

  override getPath(input: Record<string, unknown>): string {
    const command = (input?.command as string) || '';
    const pathPatterns = [
      /(?:[-\\/]path(?:Name)?\s+)?['"]?([^'"}\s]+)['"]?/gi,
      /(?:[-\\/]literalPath\s+)?['"]?([^'"}\s]+)['"]?/gi,
      /(?:[-\\/]File\s+)?['"]?([^'"}\s]+\.\w+)['"]?/gi,
    ];

    for (const pattern of pathPatterns) {
      const match = pattern.exec(command);
      if (match) {
        return match[1];
      }
    }
    return '';
  }

  /**
   * 准备权限匹配器
   * 支持通配符权限规则的模糊匹配
   */
  override async preparePermissionMatcher(
    input: Record<string, unknown>
  ): Promise<(pattern: string) => boolean> {
    const command = (input?.command as string) || '';
    return (pattern: string) => {
      const regexPattern = pattern.replace(/\*/g, '.*');
      const regex = new RegExp(`^${regexPattern}$`);
      return regex.test(command);
    };
  }

  override async execute(
    input: Record<string, unknown>,
    context: ToolUseContext,
    onProgress?: ToolCallProgress<any>
  ): Promise<ToolResult<unknown>> {
    const startTime = Date.now();
    const toolUseId = context.toolUseId || this.name;

    try {
      const command = input.command as string;
      const timeout = (input.timeout as number) || 60000;
      const workingDirectory =
        (input.workingDirectory as string) ||
        context.options.cwd ||
        process.cwd();
      const executionPolicy = (input.executionPolicy as string) || 'Bypass';

      const workingDirCheck = checkPathAccessibility(
        workingDirectory,
        'PowerShell 工作目录'
      );
      // P0（2026-11-03）：存在 ≠ 可作 cwd（可能是文件）⇒ 与 BashTool 同口径拦在 spawn 之前
      if (
        !workingDirCheck.accessible ||
        !isDirectoryPath(workingDirCheck.resolvedPath)
      ) {
        return createFailureResult(
          `${workingDirCheck.accessible ? `PowerShell 工作目录不是目录: ${workingDirCheck.resolvedPath}` : workingDirCheck.reason}${workingDirCheck.suggestions?.length ? `\n建议: ${workingDirCheck.suggestions.join('; ')}` : ''}`,
          {
            executionTime: Date.now() - startTime,
            errorLevel: ErrorLevel.RECOVERABLE,
            metadata: {
              errorCategory: 'filesystem',
              errorCode: 'WORKING_DIR_NOT_ACCESSIBLE',
            },
          }
        );
      }

      if (!command) {
        return createFailureResult('command is required', {
          executionTime: Date.now() - startTime,
          errorLevel: ErrorLevel.RECOVERABLE,
          metadata: {
            errorCategory: 'validation',
            errorCode: 'COMMAND_REQUIRED',
          },
        });
      }

      // 安全审计修复：安全检查强制运行，不可绕过
      onProgress?.({
        toolUseID: toolUseId,
        data: {
          percentage: 10,
          message: '正在执行安全检查...',
          stage: 'security_check',
        },
      });

      // 方案三（P0-3）+ G-07（2026-10-19）：安全链**单点实现** ——
      // 项目沙箱内的临时文件安全删除直接放行，其余命令走
      // 安全分析器 → 白名单 → 沙箱危险命令；`BashTool` 的 `powershell -Command` 包裹
      // 复用同一入口（`evaluatePowerShellSecurity`），避免两套判定口径。
      // 2026-10-31（台账「PowerShell 信任分级」）：与 `BashTool` 同源取工作区信任级别 ——
      // 此前本工具**零命中** `trustLevel` ⇒ 受信工作区里的非白名单但非危险命令（如 `whoami`）
      // 一律硬拒，而 bash 侧同命令可执行，同一台机器出现两套姿态。
      const trustLevel = securityIntegrationService.getTrustLevelForPath(
        workingDirectory ?? process.cwd()
      );
      const decision = evaluatePowerShellSecurity(command, {
        workingDirectory,
        analyzer: this.securityAnalyzer,
        trustLevel,
      });
      if (!decision.allowed) {
        const isAsk = decision.behavior === 'ask';
        const prefix = isAsk
          ? '需要用户确认: '
          : decision.code === 'SANDBOX_SECURITY_DENIED'
            ? '沙箱安全检查: '
            : decision.code === 'COMMAND_NOT_ALLOWED'
              ? '安全检查: '
              : '安全检查失败: ';
        return createFailureResult(`${prefix}${decision.message ?? ''}`, {
          executionTime: Date.now() - startTime,
          errorLevel: isAsk ? ErrorLevel.RECOVERABLE : ErrorLevel.FATAL,
          metadata: {
            errorCategory: isAsk ? 'permission' : 'security',
            errorCode: decision.code,
            securityIntercepted: true,
          },
        });
      }

      // F5 修复：操作审计日志
      completeSecuritySystem.auditAction({
        sessionId: context.toolUseId || 'unknown',
        action: 'powershell_execute',
        actor: 'system',
        target: command.substring(0, 200),
        result: 'allowed',
        level: 1,
        details: `PowerShellTool execute: ${command.substring(0, 100)}`,
      });

      const depth = input.depth as number | undefined;
      const exclude = input.exclude as string | undefined;
      const pwshCommand = this.buildPowerShellCommand(
        command,
        executionPolicy,
        depth,
        exclude
      );

      onProgress?.({
        toolUseID: toolUseId,
        data: {
          percentage: 30,
          message: `正在执行: ${command.substring(0, 80)}`,
          stage: 'executing',
        },
      });

      const { stdout, stderr } = await execAsync(pwshCommand, {
        cwd: workingDirectory,
        timeout,
        env: { ...process.env, POWERSHELL_TEAPOT: '1' },
      });

      const output = stdout + (stderr ? '\n[stderr]:\n' + stderr : '');

      // LRO-10（2026-10-26）：成功但完全无输出 ⇒ 结构化标记 + 提示（状态仍是成功）
      const emptyResult = isEmptyOutput(stdout, stderr);
      if (emptyResult) {
        logger.info('powershell: empty_result', {
          sessionId: context?.sessionId,
          commandPreview: command.slice(0, 200),
        });
      }

      onProgress?.({
        toolUseID: toolUseId,
        data: {
          percentage: 100,
          message: 'PowerShell 命令执行完成',
          stage: 'completed',
        },
      });

      return createSuccessResult(emptyResult ? EMPTY_OUTPUT_HINT : output, {
        executionTime: Date.now() - startTime,
        output: emptyResult ? EMPTY_OUTPUT_HINT : output,
        // LRO-10：空输出是**事实标记**，不是失败（前端/审计可据此区分"跑了但没信息"）
        ...(emptyResult ? { metadata: { emptyResult: true } } : {}),
      });
    } catch (error: unknown) {
      onProgress?.({
        toolUseID: toolUseId,
        data: {
          percentage: 100,
          message: `执行失败: ${error instanceof Error ? error.message : String(error)}`,
          stage: 'error',
        },
      });

      const psMsg = error instanceof Error ? error.message : String(error);
      const executionTime = Date.now() - startTime;

      // 排查锚点：powershell 失败时必须记录命令、超时配置、错误分类与耗时，
      // 否则日志只有"权限通过"，circuit_breaker 触发时无法定位是超时/命令错误/输出过大。
      // 输出截断 200 字符避免日志膨胀；命令保留前 200 字符便于复现。
      // command/timeout 在 try 块内定义，catch 中从 input 重新读取。
      const commandPreview = String(input.command ?? '').slice(0, 200);
      const timeoutConfig = Number(input.timeout) || 60000;
      const isTimeout =
        psMsg.includes('ETIMEDOUT') || psMsg.includes('timeout');
      logger.warn('powershell:execution_failed', {
        toolCallId: toolUseId,
        sessionId: context.sessionId,
        commandPreview,
        timeout: timeoutConfig,
        executionTimeMs: executionTime,
        isTimeout,
        errorPreview: psMsg.slice(0, 200),
      });

      if (isTimeout) {
        return createFailureResult('Command timed out', {
          executionTime,
          errorLevel: ErrorLevel.RETRYABLE,
          metadata: { errorCategory: 'execution', errorCode: 'TIMEOUT' },
        });
      }

      // F7（2026-10-27）：失败报文不能只剩 `pwsh … -EncodedCommand <base64>`。
      // 实测（Liri 报告 P2-1）：模型/用户看到一串不可读编码 + 无 stderr，无法定位原因。
      // 现：①把 base64 载荷替换为**真实脚本预览**；②回填 stderr 末 40 行。
      const errWithStreams = error as { stdout?: string; stderr?: string };
      const failureDetail = describePowerShellFailure(
        psMsg,
        commandPreview,
        errWithStreams
      );

      return createFailureResult(failureDetail, {
        executionTime,
        errorLevel: ErrorLevel.RETRYABLE,
        metadata: { errorCategory: 'execution', errorCode: 'EXECUTION_FAILED' },
      });
    }
  }

  /**
   * 构建 PowerShell 命令
   * @param command 原始命令
   * @param executionPolicy 执行策略
   * @param depth 可选的输出深度限制
   * @param exclude 可选的排除文本模式
   */
  private buildPowerShellCommand(
    command: string,
    executionPolicy: string,
    depth?: number,
    exclude?: string
  ): string {
    let finalCommand = command;

    // 追加 depth 限制：通过 Select-Object -First 限制输出对象数
    if (depth !== undefined && depth > 0) {
      finalCommand += ` | Select-Object -First ${depth}`;
    }

    // 追加 exclude 过滤：通过 Select-String 排除匹配行
    if (exclude) {
      // 转义单引号防止命令注入
      const escapedExclude = exclude.replace(/'/g, "''");
      finalCommand += ` | Select-String -NotMatch -SimpleMatch '${escapedExclude}'`;
    }

    // 使用 EncodedCommand 避免双层引号转义问题：
    // child_process.exec 在 Windows 上通过 cmd.exe /d /s /c 执行，
    // cmd.exe 对引号的处理（^" 或 ""）与 PowerShell（`" 或 ""）不同，
    // 导致含双引号的命令（如 LLM 用引号包裹含中文符号的文件路径）被错误解析。
    // Base64 编码完全绕过 cmd.exe → pwsh 的引号转义层，支持任意 Unicode 字符。
    const encoded = Buffer.from(finalCommand, 'utf16le').toString('base64');
    return `pwsh -NoProfile -ExecutionPolicy ${executionPolicy} -EncodedCommand ${encoded}`;
  }

  /**
   * 检查命令安全性
   */
  checkSecurity(command: string) {
    return this.securityAnalyzer.analyze(command);
  }
}

/**
 * PowerShell 安全分析器
 *
 * 提供多层次的 PowerShell 命令安全检查
 */
export class PowerShellSecurityAnalyzer {
  private dangerousPatterns: Array<{
    pattern: RegExp;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    behavior: 'allow' | 'ask' | 'deny';
    message: string;
    name: string;
  }>;

  constructor() {
    // 从用户配置加载自定义黑名单，合并到危险模式列表
    const customBlacklistPatterns = this.loadCustomBlacklistPatterns();

    this.dangerousPatterns = [
      // P0 紧急新增：Remove-Item 别名全覆盖
      {
        name: 'recursive_deletion',
        pattern: new RegExp(
          `(?:${POWERSHELL_DELETION_ALIASES.join('|')})\\s+.*(?:-recurse|/s|-r|recurse)`,
          'i'
        ),
        riskLevel: 'high',
        behavior: 'ask',
        message: '检测到递归删除操作，请确认目标和范围',
      },
      {
        name: 'bulk_deletion',
        pattern: new RegExp(
          `(?:${POWERSHELL_DELETION_ALIASES.join('|')})\\s+.*(?:-recurse|/s|-r|/f|-force|force|recurse)`,
          'i'
        ),
        riskLevel: 'high',
        behavior: 'ask',
        message: '检测到批量删除操作，请确认目标和范围',
      },
      {
        name: 'remove_item_generic',
        pattern: new RegExp(
          `(?:${POWERSHELL_DELETION_ALIASES.join('|')})\\s+`,
          'i'
        ),
        riskLevel: 'medium',
        behavior: 'ask',
        message: '检测到文件删除操作，请确认目标和范围',
      },
      {
        name: 'registry_deletion',
        pattern: /remove-item\s+[-/]?(?:path|literalpath)\s+['"]?hklm:/i,
        riskLevel: 'high',
        behavior: 'deny',
        message: '禁止删除注册表项',
      },
      {
        name: 'system_file_deletion',
        pattern:
          /remove-item\s+[-/]?([cC]:\\windows|[cC]:\\program\s*files|\/var|\/usr)/i,
        riskLevel: 'critical',
        behavior: 'deny',
        message: '禁止删除系统文件',
      },
      {
        name: 'format_command',
        pattern: /format-(?:volume|drive)\s+/i,
        riskLevel: 'critical',
        behavior: 'deny',
        message: '禁止格式化操作',
      },
      {
        name: 'stop_critical_service',
        pattern:
          /stop-service\s+[-/]?(?:name|displayname)\s+['"]?(?:windows\s*update|bits|event\s*log|wuauserv)/i,
        riskLevel: 'high',
        behavior: 'deny',
        message: '禁止停止关键服务',
      },
      {
        name: 'firewall_modification',
        pattern: /(?:set|remove)-netfirewall(?:rule|profile)/i,
        riskLevel: 'high',
        behavior: 'ask',
        message: '防火墙修改需要确认',
      },
      {
        name: 'user_creation',
        pattern: /new-localuser|net\s+user\s+\/add/i,
        riskLevel: 'high',
        behavior: 'ask',
        message: '创建用户账户需要确认',
      },
      {
        name: 'password_reset',
        pattern: /net\s+user\s+.*\s+\/setpassword/i,
        riskLevel: 'high',
        behavior: 'ask',
        message: '密码重置需要确认',
      },
      {
        name: 'scheduled_task_creation',
        pattern: /register-scheduledtask|schtasks\s+\/create/i,
        riskLevel: 'medium',
        behavior: 'ask',
        message: '创建计划任务需要确认',
      },
      {
        name: 'service_creation',
        pattern: /new-service\s+[-/]?name/i,
        riskLevel: 'medium',
        behavior: 'ask',
        message: '创建服务需要确认',
      },
      {
        name: 'remote_connection',
        pattern:
          /(?:new-pssession|enter-pssession|invoke-command).*-(?:computername|sessionname)/i,
        riskLevel: 'medium',
        behavior: 'ask',
        message: '远程连接需要确认',
      },
      {
        name: 'download_execution',
        // 2026-10-30（外部建议 #3 取证）：补 `irm` / `iwr` 官方短别名 —— 原模式只认长名与
        // curl/wget，实测 `iwr https://… -OutFile a.ps1` 这类最常见写法**零命中**。
        pattern:
          /\b(?:irm|iwr|invoke-webrequest|invoke-restmethod|curl|wget)\b.*[-/]?(?:outfile|saveas)/i,
        riskLevel: 'medium',
        behavior: 'ask',
        message: '下载并执行需要确认',
      },
      {
        name: 'registry_modification',
        pattern: /set-itemproperty\s+[-/]?path\s+['"]?hklm:/i,
        riskLevel: 'medium',
        behavior: 'ask',
        message: '注册表修改需要确认',
      },
      {
        name: 'process_kill',
        pattern:
          /stop-process\s+[-/]?(?:name|id)\s+['"]?(?:system|csrss|lsass|smss|winlogon)/i,
        riskLevel: 'critical',
        behavior: 'deny',
        message: '禁止终止系统关键进程',
      },
      {
        name: 'disk_partition',
        pattern: /(?:clear|rescan|update|repair)-disk/i,
        riskLevel: 'high',
        behavior: 'ask',
        message: '磁盘操作需要确认',
      },
      {
        name: 'boot_modification',
        pattern: /bcdedit|bootrec/i,
        riskLevel: 'high',
        behavior: 'ask',
        message: '启动配置修改需要确认',
      },
      // V7 修复：补充 PowerShell 危险命令（安全审计发现）
      {
        name: 'invoke_expression',
        // 2026-10-30（外部建议 #3 取证）：原为 `invoke-expression\s+|iex\s+`，要求**尾随空白**
        // ⇒ 最常见的下载执行形态 `irm https://… | iex`（`iex` 在串尾）漏判。改为词边界匹配。
        pattern: /\binvoke-expression\b|\biex\b/i,
        riskLevel: 'critical',
        behavior: 'deny',
        message: '禁止 Invoke-Expression（iex），可执行任意代码',
      },
      {
        name: 'invoke_command',
        pattern: /invoke-command\s+|icm\s+/i,
        riskLevel: 'critical',
        behavior: 'deny',
        message: '禁止 Invoke-Command（icm），可远程执行任意代码',
      },
      {
        name: 'start_process',
        pattern: /start-process\s+|saps\s+/i,
        riskLevel: 'high',
        behavior: 'deny',
        message: '禁止 Start-Process，可启动任意进程',
      },
      {
        name: 'wmi_manipulation',
        pattern:
          /(?:get-wmiobject|set-wmiinstance|invoke-wmimethod|get-ciminstance|set-ciminstance|invoke-cimmethod)\s+/i,
        riskLevel: 'high',
        behavior: 'deny',
        message: '禁止 WMI/CIM 操作，可修改系统配置',
      },
      {
        name: 'add_type',
        pattern: /add-type\s+/i,
        riskLevel: 'critical',
        behavior: 'deny',
        message: '禁止 Add-Type，可加载任意 .NET 程序集',
      },
      {
        name: 'net_assembly_load',
        pattern: /\[system\.reflection\.assembly\]::load/i,
        riskLevel: 'critical',
        behavior: 'deny',
        message: '禁止反射加载 .NET 程序集',
      },
      // 用户自定义黑名单规则
      ...customBlacklistPatterns,
    ];
  }

  /**
   * 从用户配置加载自定义命令黑名单，转换为危险模式列表
   * @returns 自定义黑名单模式列表
   */
  private loadCustomBlacklistPatterns(): Array<{
    pattern: RegExp;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    behavior: 'allow' | 'ask' | 'deny';
    message: string;
    name: string;
  }> {
    try {
      const permission =
        configManager.getConfigValue<PermissionConfig>('permission');
      const blacklist = permission?.customRules?.commandRules?.blacklist;
      if (!blacklist || blacklist.length === 0) return [];

      return blacklist.map((rule, idx) => ({
        name: `custom_blacklist_${idx}`,
        pattern: new RegExp(
          rule.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
          'i'
        ),
        riskLevel: 'high' as const,
        behavior: 'deny' as const,
        message: `用户自定义黑名单拦截: ${rule.pattern}`,
      }));
    } catch {
      return [];
    }
  }

  /**
   * 白名单前置检查：当配置了 whitelist 模式时，只放行匹配白名单的指令
   * @param command 命令字符串
   * @returns 非 null 表示白名单检查结果（null 表示未启用白名单模式）
   */
  private checkWhitelistPreCheck(command: string): {
    safe: boolean;
    behavior: 'allow' | 'ask' | 'deny';
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    message?: string;
    matchedPatterns: string[];
  } | null {
    try {
      const permission =
        configManager.getConfigValue<PermissionConfig>('permission');
      const rules = permission?.customRules?.commandRules;
      if (!rules || rules.mode !== 'whitelist') return null;

      const whitelistPatterns = rules.whitelist || [];
      const matched = whitelistPatterns.some((r) =>
        command.toLowerCase().includes(r.pattern.toLowerCase())
      );

      if (matched) {
        return {
          safe: true,
          behavior: 'allow',
          riskLevel: 'low',
          matchedPatterns: [],
        };
      }

      return {
        safe: false,
        behavior: 'deny',
        riskLevel: 'high',
        matchedPatterns: [`未匹配白名单规则: ${command}`],
      };
    } catch {
      return {
        safe: false,
        behavior: 'deny',
        riskLevel: 'high',
        matchedPatterns: ['白名单检查异常，已熔断拒绝'],
      };
    }
  }

  /**
   * 分析命令安全性
   */
  analyze(command: string): {
    safe: boolean;
    behavior: 'allow' | 'ask' | 'deny';
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    message?: string;
    matchedPatterns: string[];
  } {
    if (!command) {
      return {
        safe: true,
        behavior: 'allow',
        riskLevel: 'low',
        matchedPatterns: [],
      };
    }

    const trimmedCommand = command.trim();

    if (!trimmedCommand) {
      return {
        safe: true,
        behavior: 'allow',
        riskLevel: 'low',
        matchedPatterns: [],
      };
    }

    // 前置检查：白名单模式 — 配置了 whitelist 时，只放行匹配的指令
    {
      const preCheck = this.checkWhitelistPreCheck(trimmedCommand);
      if (preCheck) return preCheck;
    }

    const matchedPatterns: string[] = [];
    let highestRiskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
    let finalBehavior: 'allow' | 'ask' | 'deny' = 'allow';
    const messages: string[] = [];

    for (const danger of this.dangerousPatterns) {
      if (danger.pattern.test(trimmedCommand)) {
        matchedPatterns.push(danger.name);

        if (this.isHigherRisk(danger.riskLevel, highestRiskLevel)) {
          highestRiskLevel = danger.riskLevel;
        }

        if (danger.behavior === 'deny') {
          finalBehavior = 'deny';
        } else if (danger.behavior === 'ask' && finalBehavior !== 'deny') {
          finalBehavior = 'ask';
        }

        if (danger.message) {
          messages.push(danger.message);
        }
      }
    }

    const safe = finalBehavior === 'allow';

    return {
      safe,
      behavior: finalBehavior,
      riskLevel: highestRiskLevel,
      message: messages.length > 0 ? messages.join('; ') : undefined,
      matchedPatterns,
    };
  }

  /**
   * 比较风险等级
   */
  private isHigherRisk(a: string, b: string): boolean {
    const order = ['low', 'medium', 'high', 'critical'];
    return order.indexOf(a) > order.indexOf(b);
  }
}

/**
 * 创建PowerShell工具实例
 * @returns PowerShell工具实例
 */
export function createPowerShellTool(): PowerShellTool {
  return new PowerShellTool();
}
