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
 * G-07（2026-10-19）：BashTool 的 **PowerShell 包裹**检查。
 *
 * 背景：`BashTool` 的提示词鼓励复杂脚本写成 `powershell -Command "…"`（`BashTool.ts`），
 * 但既有硬拦截层只分析**外层字符串** —— 内层脚本（递归删除 / iex / 白名单外动词）
 * 完全不经过 `PowerShellTool` 的安全链，属真实的正则绕过面。
 *
 * 口径（CS01：不新增第二套危险词表）：
 * - 只做**识别与解包**（`inspectPowerShellWrapper`）；
 * - 判定**复用** `PowerShellTool` 的同一入口 `evaluatePowerShellSecurity()`
 *   （分析器 + 白名单 + 沙箱二次校验），保证「包裹执行」与「直接执行」判定一致；
 * - `-EncodedCommand` / 空脚本等**无法静态检查**的形态 ⇒ **fail-closed**（不静默放行）。
 *
 * 边界（如实）：仅覆盖**语句位置**的 `powershell` / `pwsh` 调用（`^`、`;`、`&&`、`||`、`|`、`(`）；
 * `cmd /c powershell …` 等更深层嵌套不在本次范围（未纳入即不声称覆盖）。
 */

import type { ToolResult } from '../types/ToolResult';
import { createToolResult } from '../types/ToolResult';
import {
  evaluatePowerShellSecurity,
  PowerShellSecurityAnalyzer,
} from '../PowerShellTool/PowerShellTool';

/** 解包结果 */
export interface PowerShellWrapperInspection {
  /** 是否命中语句位置的 powershell/pwsh 调用 */
  matched: boolean;
  /** 可静态检查的内层脚本（`-Command` / `-c`） */
  scripts: string[];
  /** 存在无法静态检查的形态（`-EncodedCommand` / 空脚本）⇒ 调用方 fail-closed */
  opaque: boolean;
}

/** 语句位置调用：行首，或 shell 分隔符之后（普通空白前导不算语句位置，避免 `echo powershell` 误判）。 */
const PS_WRAPPER_INVOKE_RE =
  /(?:^|[;&|()\n\r])\s*(?:powershell(?:\.exe)?|pwsh(?:\.exe)?)\b/gi;

/** PowerShell 内联脚本开关（`-Command` / `-EncodedCommand` 及其官方短别名）。 */
const PS_WRAPPER_FLAG_RE = /^-{1,2}(encodedcommand|enc|e|command|comm|c)\b/i;

/**
 * 读取从 `start` 开始的一条 shell 语句（在**引号外**遇 `;` / 换行 / `|` / `&&` 截止）。
 * 内层脚本里的分隔符因处于引号内而不会被误切。
 */
function readStatement(text: string, start: number): string {
  let quote: '"' | "'" | null = null;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '\n' || ch === '\r' || ch === ';' || ch === '|') {
      return text.slice(start, i);
    }
    if (ch === '&') return text.slice(start, i);
  }
  return text.slice(start);
}

/** 在语句中**引号外**找首个脚本开关；找不到（如 `-File`）⇒ `null`。 */
function findScriptFlag(
  statement: string
): { name: string; end: number } | null {
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < statement.length; i++) {
    const ch = statement[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch !== '-' || (i > 0 && !/\s/.test(statement[i - 1]))) continue;
    const m = PS_WRAPPER_FLAG_RE.exec(statement.slice(i));
    if (m) return { name: m[1].toLowerCase(), end: i + m[0].length };
  }
  return null;
}

/** 去掉脚本最外层的一对引号（PowerShell 用 `""` 转义内层双引号）。 */
function stripOuterQuotes(raw: string): string {
  const s = raw.trim();
  const q = s[0];
  if (q !== '"' && q !== "'") return s;
  let out = '';
  for (let i = 1; i < s.length; i++) {
    if (s[i] === q) {
      if (s[i + 1] === q) {
        out += q;
        i++;
        continue;
      }
      return out;
    }
    out += s[i];
  }
  return out;
}

/** 识别并解包所有语句位置的 `powershell/pwsh -Command "…"` 调用（纯函数）。 */
export function inspectPowerShellWrapper(
  command: string
): PowerShellWrapperInspection {
  const scripts: string[] = [];
  let matched = false;
  let opaque = false;

  PS_WRAPPER_INVOKE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PS_WRAPPER_INVOKE_RE.exec(command)) !== null) {
    matched = true;
    const statement = readStatement(command, m.index + m[0].length);
    const flag = findScriptFlag(statement);
    // 无 -Command/-c（如 `-File`）⇒ 内联脚本不存在，本项不声称覆盖
    if (!flag) continue;
    if (
      flag.name === 'encodedcommand' ||
      flag.name === 'enc' ||
      flag.name === 'e'
    ) {
      opaque = true;
      continue;
    }
    const script = stripOuterQuotes(statement.slice(flag.end));
    if (!script) {
      opaque = true;
      continue;
    }
    scripts.push(script);
  }

  return { matched, scripts, opaque };
}

/** 安全分析器**惰性**单例（构造期读配置；避免模块加载时与 config 初始化耦合） */
let sharedAnalyzer: PowerShellSecurityAnalyzer | undefined;
function getAnalyzer(): PowerShellSecurityAnalyzer {
  return (sharedAnalyzer ??= new PowerShellSecurityAnalyzer());
}

/**
 * FIX-15（2026-10-27）：整条命令是否**仅**由一条语句位置的 `powershell|pwsh -Command "…"`
 * 构成（语句外无 `&&` / `;` / `|` / 换行 等串联段）。
 *
 * 用途：bash 侧的复合只读判定把 `powershell` 当"非只读命令"⇒ 恒 `deny`，而内层脚本
 * **已**由 PowerShell 安全链判定通过（`checkPowerShellWrapper` 在此之前已放行）⇒
 * 两道闸结论互斥（真机 10:13:59Z / 10:14:03Z 的只读 `Get-ChildItem … | Select-Object …`
 * 被 `security_analyzer_deny` 拦下）。
 *
 * ⚠️ 多段形态（如 `powershell -Command "x" && del /f y`）**不算**单条：兄弟段未经验证，
 * 必须继续走原 deny，不得被顺带放行。
 */
export function isSinglePowerShellWrapperCommand(command: string): boolean {
  const trimmed = command.trim();
  const head = /^(?:powershell(?:\.exe)?|pwsh(?:\.exe)?)\b/i.exec(trimmed);
  if (!head) return false;
  // readStatement 在**引号外**遇分隔符截止 ⇒ 单条语句时 rest 为空
  const statement = readStatement(trimmed, head[0].length);
  return trimmed.slice(head[0].length + statement.length).trim() === '';
}

function deny(message: string, reason: string): ToolResult<unknown> {
  // BUG-8（2026-10-19）：硬拦截必须带 `error`/`success:false`，
  // 否则消费方按 `toolResult.error` 判定时会把拦截误记为成功。
  return createToolResult(message, {
    success: false,
    error: message,
    newMessages: [{ role: 'system', content: `Error: ${message}` }],
    metadata: { securityIntercepted: true, reason },
  });
}

/**
 * BashTool 硬拦截：若命令包含 `powershell/pwsh -Command` 包裹，则对**内层脚本**执行
 * `PowerShellTool` 的同一安全链（分析器 → 白名单 → 沙箱）。
 *
 * @returns 命中拦截 / 需人工确认 ⇒ 结果；通过或未包裹 ⇒ `null`
 */
export function checkPowerShellWrapper(
  command: string,
  workingDirectory?: string
): ToolResult<unknown> | null {
  const inspection = inspectPowerShellWrapper(command);
  if (!inspection.matched) return null;

  if (inspection.opaque) {
    return deny(
      '安全检查失败: PowerShell 内层脚本无法静态检查（-EncodedCommand / 空脚本），已拒绝执行',
      'powershell_wrapper_opaque'
    );
  }

  for (const script of inspection.scripts) {
    const decision = evaluatePowerShellSecurity(script, {
      workingDirectory,
      analyzer: getAnalyzer(),
    });
    if (decision.allowed) continue;

    if (decision.behavior === 'ask') {
      const message = `需要用户确认: ${
        decision.message ?? 'PowerShell 内层命令需要确认'
      }`;
      return createToolResult(message, {
        requireApproval: true,
        approvalReason: 'PowerShell 包裹的内层命令需人工确认（G-07）',
        newMessages: [{ role: 'system', content: message }],
        metadata: {
          securityIntercepted: true,
          reason: 'powershell_wrapper_ask',
        },
      });
    }

    return deny(
      `安全检查失败: ${decision.message ?? 'PowerShell 内层命令被阻止执行'}`,
      'powershell_wrapper_deny'
    );
  }

  return null;
}
