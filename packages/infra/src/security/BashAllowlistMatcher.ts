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
// P1-3（2026-11-06）：丢弃/合并型重定向不算 shell operator（与 compoundReadOnly 同口径）
import { stripHarmlessRedirects } from './compoundReadOnly';

// Shell operators that indicate injection risk
const SHELL_OPERATORS = /[;&|><`$]/;

/** bash / PowerShell 只读前缀（按 shell 拼接，任一命中即放行） */
const readOnlyPrefixes = [
  ...BASH_READ_ONLY_PREFIX_PATTERNS,
  ...POWERSHELL_READ_ONLY_PREFIX_PATTERNS,
];

/**
 * 2026-11-08（真机 `pdca_mw6rx5kr` / `pdca_mw6sfu1y`）：**工作区内良性写命令**放行。
 *
 * 动机：长程任务步骤里 `mkdir output` 这类"只为落产物建目录"的命令会落进
 * 「未知命令 ⇒ 转人工审批」，任务在 33%/50% 挂起等一个毫无风险的点击
 * （真机：同一个 `mkdir output` 连弹两张卡，用户即为"过度审批"抱怨过）。
 *
 * 边界（**只放行最窄的一类**，任何不确定一律走原「转审批」路径）：
 * - 命令族仅 `mkdir` / `touch`；开关仅 `mkdir -p|--parents`，其余开关一律不放行；
 * - 参数必须是**工作区相对路径**：绝对路径（`/` / `\` / 盘符 / `~`）、`..` 越界、
 *   变量展开（`%VAR%` / `$VAR`）、空参数 ⇒ 不放行；
 * - 含 shell 操作符的复合命令在更早的分支已被拒绝，不会走到这里。
 */
const BENIGN_WORKSPACE_WRITE_COMMANDS = new Set(['mkdir', 'touch']);
const BENIGN_WORKSPACE_WRITE_FLAGS = new Set(['-p', '--parents']);

/** 单个参数是否为安全的工作区相对路径 */
function isWorkspaceRelativePath(arg: string): boolean {
  if (arg.length === 0) return false;
  if (arg.startsWith('-')) return false; // 未登记开关
  if (/^([/\\]|[A-Za-z]:)/.test(arg)) return false; // 绝对路径 / 盘符 / UNC
  if (arg.startsWith('~')) return false; // 家目录展开
  if (arg.includes('..')) return false; // 越界
  if (/[%$`]/.test(arg)) return false; // 变量 / 命令展开
  return true;
}

/** 是否为"工作区内良性写"（只建目录 / 建空文件） */
export function isBenignWorkspaceWrite(command: string): boolean {
  const tokens = command.trim().split(/\s+/);
  const base = tokens[0];
  if (!BENIGN_WORKSPACE_WRITE_COMMANDS.has(base)) return false;
  const paths = tokens.slice(1).filter((t) => !BENIGN_WORKSPACE_WRITE_FLAGS.has(t));
  if (paths.length === 0) return false;
  return paths.every(isWorkspaceRelativePath);
}

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
  // P1-3（2026-11-06）：先剥离丢弃/合并型重定向（`2>&1` / `2>nul` / `>/dev/null`）再判 operator
  // —— 否则 `bun test 2>&1` 会被当成"复合命令"硬拒（应转人工审批，批准后可执行）。
  const operatorProbe = stripHarmlessRedirects(trimmed);
  if (SHELL_OPERATORS.test(operatorProbe)) {
    const operatorMatch = operatorProbe.match(SHELL_OPERATORS);
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

  // 2.2 工作区内良性写（2026-11-08）：`mkdir output` / `touch a.md` 这类只为落产物的
  // 最窄写操作 ⇒ 放行（详见上方 `isBenignWorkspaceWrite` 的边界说明）
  if (isBenignWorkspaceWrite(trimmed)) {
    return {
      safe: true,
      reason: 'Command is a benign workspace-relative write (mkdir/touch)',
    };
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
