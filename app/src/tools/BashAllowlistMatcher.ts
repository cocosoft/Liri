/**
 * BashAllowlistMatcher — Bash 命令 allowlist 前缀匹配防注入
 *
 * P3-4: 对标 openworker shell 命令前缀匹配,拒绝 shell operator (; & | > < ` 等)。
 * 在黑名单检测之外增加一层 allowlist 防护,防止绕过。
 */

// Shell operators that indicate injection risk
const SHELL_OPERATORS = /[;&|><`$]/;

// Known safe read-only command prefixes (case-insensitive)
const READ_ONLY_PREFIXES: RegExp[] = [
  /^ls\b/i, /^dir\b/i, /^pwd\b/i, /^cd\b/i,
  /^cat\b/i, /^type\b/i, /^head\b/i, /^tail\b/i,
  /^grep\b/i, /^find\b/i, /^locate\b/i,
  /^git\s+(status|diff|log|branch|show|rev-parse|remote|config|blame)\b/i,
  /^(Get-ChildItem|Get-Content|Get-Location|Select-String|Get-Process)\b/i,
  /^echo\b/i, /^printf\b/i,
  /^wc\b/i, /^sort\b/i, /^uniq\b/i,
  /^date\b/i, /^whoami\b/i, /^id\b/i, /^uname\b/i,
  /^which\b/i, /^where\b/i, /^whereis\b/i,
  /^env\b/i, /^printenv\b/i,
  /^df\b/i, /^du\b/i, /^free\b/i, /^ps\b/i, /^top\b/i,
  /^tree\b/i, /^file\b/i, /^stat\b/i, /^md5sum\b/i,
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
  for (const prefix of READ_ONLY_PREFIXES) {
    if (prefix.test(trimmed)) {
      return { safe: true, reason: 'Command matches known-safe pattern' };
    }
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

  for (const prefix of READ_ONLY_PREFIXES) {
    if (prefix.test(command.trim())) return true;
  }
  return false;
}
