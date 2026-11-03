/**
 * BashAllowlistMatcher — Bash 命令 allowlist 前缀匹配防注入
 *
 * P3-4: 对标 openworker shell 命令前缀匹配,拒绝 shell operator (; & | > < ` 等)。
 * 在黑名单检测之外增加一层 allowlist 防护,防止绕过。
 */

// P2-3（2026-11-03）：只读命令清单收敛到 `security/readOnlyCommands.ts`（单一来源）
import {
  BASH_READ_ONLY_PREFIX_PATTERNS,
  POWERSHELL_READ_ONLY_PREFIX_PATTERNS,
  VERSION_ONLY_QUERY_PATTERN,
} from './readOnlyCommands';

// Shell operators that indicate injection risk
const SHELL_OPERATORS = /[;&|><`$]/;

/** bash / PowerShell 只读前缀（按 shell 拼接，任一命中即放行） */
const readOnlyPrefixes = [
  ...BASH_READ_ONLY_PREFIX_PATTERNS,
  ...POWERSHELL_READ_ONLY_PREFIX_PATTERNS,
];

export interface AllowlistResult {
  safe: boolean;
  reason: string;
}

/**
 * 检查命令是否符合 allowlist 安全规范
 * @returns safe=true 表示命令不包含危险的 shell operator
 */
export function checkBashAllowlist(command: string): AllowlistResult {
  if (!command || command.trim().length === 0) {
    return { safe: false, reason: 'Empty command' };
  }

  const trimmed = command.trim();

  // 1. Reject shell operators
  if (SHELL_OPERATORS.test(trimmed)) {
    const operatorMatch = trimmed.match(SHELL_OPERATORS);
    return {
      safe: false,
      reason: `Shell operator '${operatorMatch?.[0]}' detected — potential command injection. Use a single command without chaining operators.`,
    };
  }

  // 2. Allow known safe commands
  for (const prefix of readOnlyPrefixes) {
    if (prefix.test(trimmed)) {
      return { safe: true, reason: 'Command matches known-safe pattern' };
    }
  }

  // 2.1 只读版本查询（LRO-D3）：`node -v` 这类"完整命令 + 版本开关"放行
  if (VERSION_ONLY_QUERY_PATTERN.test(trimmed)) {
    return { safe: true, reason: 'Command is a read-only version query' };
  }

  // 3. Unknown command — potentially unsafe, defer to permission system
  return {
    safe: false,
    reason: `Command '${trimmed.split(/\s+/)[0]}' is not in the known-safe allowlist. Permission review required.`,
  };
}

/**
 * 检查是否为只读命令

 * P3-4: 在白名单中的命令可以快速放过
 */
export function isReadOnlyBashCommand(command: string): boolean {
  if (!command || command.trim().length === 0) return false;
  if (SHELL_OPERATORS.test(command.trim())) return false;

  for (const prefix of readOnlyPrefixes) {
    if (prefix.test(command.trim())) return true;
  }
  return false;
}
