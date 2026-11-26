// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 命令模式生成的**共享判定**（2026-11-21）。
 *
 * 背景：审批卡「以后这个命令免审批」落盘的是 `contentPattern`。旧实现固定取命令前
 * 2 个 token + `.*` ⇒ 对解释器命令（`powershell -NoProfile -Command "..."`）等价于
 * 「放行整个解释器」（真机 `session_mwpit6sk32d12fe50b`：`^powershell -NoProfile.*`）。
 *
 * 本模块把「哪些命令属于解释器/壳」「如何取稳定的命令头」收敛为**唯一事实源**：
 * - `packages/service` 的 `inboxApproval.buildCommandContentPattern` 消费它生成规则；
 * - `app` 的 bash 安全链复用同一份高能力解释器清单（避免第二套词表）。
 *
 * 依赖方向：infra 不依赖 app / service（R00-001）。
 */

import {
  AUTO_MODE_HARD_DENY_TOKENS,
  DANGEROUS_BASE_COMMANDS,
} from '../security/patterns/index.js';

/** 高能力解释器（可执行任意代码；A4 解释器守卫同源） */
export const HIGH_CAPABILITY_INTERPRETERS: ReadonlySet<string> = new Set([
  'node',
  'bun',
  'npm',
  'npx',
  'yarn',
  'pnpm',
  'deno',
  'pwsh',
  'powershell',
  'python',
  'python3',
  'pip',
  'pip3',
]);

/**
 * 生成「命令级免审批」规则时需要**精确匹配**的命令头。
 *
 * 除高能力解释器外，补入**壳与包装器**（`cmd` / POSIX shell 全族 / `env` / `busybox`）：
 * 它们的共性是「第一个 token 只说明用什么执行器，不说明执行什么」⇒ 前缀规则没有意义
 * （`^dash -c.*` 等于放行任意 `dash -c`）。
 *
 * P1（2026-11-22）：补齐 `dash` / `ksh` / `mksh` / `ash` / `csh` / `tcsh` / `busybox` / `env`
 * —— 此前只有 bash/sh/zsh/fish，`dash`、`ksh` 等批准后会退化成通配前缀。
 */
export const INTERPRETER_COMMAND_HEADS: ReadonlySet<string> = new Set([
  ...HIGH_CAPABILITY_INTERPRETERS,
  'cmd',
  'sh',
  'bash',
  'zsh',
  'dash',
  'ksh',
  'mksh',
  'ash',
  'csh',
  'tcsh',
  'fish',
  'busybox',
  'env',
]);

/** 命令头是否为高能力解释器（入参需已归一化：小写、去扩展名、去目录） */
export function isHighCapabilityInterpreter(baseCommand: string): boolean {
  if (!baseCommand) return false;
  return HIGH_CAPABILITY_INTERPRETERS.has(baseCommand);
}

/** 命令头是否应按「解释器」处理（生成精确匹配规则） */
export function isInterpreterCommandHead(baseCommand: string): boolean {
  if (!baseCommand) return false;
  return INTERPRETER_COMMAND_HEADS.has(baseCommand);
}

/**
 * **壳内建命令**（2026-11-25）：不能按"首 token 前缀"授权。
 *
 * 为什么单独一张表：`cd "E:\\a" & python -c "…"` 这类复合命令的首 token 是 `cd`，
 * 若按前缀授权（`allowlist_tool_session` / `contentPattern=^cd.*`）则等价于
 * 「本会话放行所有以 cd 开头的命令」——真机 `session_mww2f7qtf0e2b83018` 已验证：
 * 批一条 `cd "E:\\..." & python -c step1` 后，`cd "C:\\Temp" & python -c step2` 零审批执行。
 *
 * 这些命令的共同点：本身不说明执行什么（改 cwd / 改环境 / 间接执行），必须**精确匹配**。
 */
export const SHELL_BUILTIN_COMMAND_HEADS: ReadonlySet<string> = new Set([
  'cd',
  'chdir',
  'pushd',
  'popd',
  'set',
  'export',
  'alias',
  'unalias',
  'unset',
  'call',
  'start',
]);

/** 命令头是否属于"不能按前缀授权"的壳内建（入参需已归一化） */
export function isShellBuiltinCommandHead(baseCommand: string): boolean {
  if (!baseCommand) return false;
  return SHELL_BUILTIN_COMMAND_HEADS.has(baseCommand);
}

/**
 * 命令是否带**内联代码**开关（`-c` / `-e` / `--eval` / `-Command` / `-EncodedCommand`）。
 *
 * 只用于"高能力解释器确认"的灰度判定：`node script.js` / `python -m pytest` 这类
 * 文件/模块调用不应被一律升级人工确认。
 */
export function hasInlineCodeFlag(command: string): boolean {
  if (!command) return false;
  const flags = new Set([
    '-c',
    '-e',
    '--eval',
    '-command',
    '-encodedcommand',
    '-ec',
  ]);
  return command
    .split(/\s+/)
    .some((token) => flags.has(token.toLowerCase().replace(/^["']/, '')));
}

/**
 * 取命令首 token（支持带引号的完整路径：`"C:\Program Files\PowerShell\7\pwsh.exe"`）。
 * 返回**原文**（未归一化）；无法解析时返回空串。
 */
export function extractCommandHeadToken(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) return '';
  const quoted = /^"([^"]+)"/.exec(trimmed) ?? /^'([^']+)'/.exec(trimmed);
  if (quoted?.[1]) return quoted[1];
  return trimmed.split(/\s+/)[0] ?? '';
}

/**
 * 归一化命令头：去目录、去 `.exe`、小写。
 *
 * 例：`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe` → `powershell`
 */
export function normalizeCommandHead(head: string): string {
  const raw = head.trim().replace(/^["']|["']$/g, '');
  if (!raw) return '';
  const base = raw.split(/[\\/]/).pop() ?? raw;
  return base.replace(/\.exe$/i, '').toLowerCase();
}

/** 转义正则特殊字符，保证命令文本按字面匹配 */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 生成命令级免审批规则的 `contentPattern`（**唯一实现**）。
 *
 * - 解释器/壳（`powershell` / `cmd` / `bash` / `python` / `node` …）⇒ **精确匹配**
 *   `^<整条命令>$`：换参数必须重新审批；
 * - 壳内建（`cd` / `set` / `call` …，见 `SHELL_BUILTIN_COMMAND_HEADS`）⇒ 同样精确匹配
 *   （2026-11-25：`^cd /d.*` / `^cd.*` 等于放行任意 cd 前缀复合命令）；
 * - 其余命令 ⇒ 保留既有「前 2 token 前缀 + `.*`」口径（与历史行为逐字一致）。
 */
export function buildCommandContentPattern(command: string): string {
  const trimmed = command.trim();
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return '';

  const head = normalizeCommandHead(extractCommandHeadToken(trimmed));
  if (isInterpreterCommandHead(head) || isShellBuiltinCommandHead(head)) {
    return `^${escapeRegExp(trimmed)}$`;
  }

  const prefix = tokens.slice(0, 2).join(' ');
  return `^${escapeRegExp(prefix)}.*`;
}

/** 正则元字符：命令头只取「字面前缀」，遇到元字符即停止（不猜正则语义） */
const REGEX_META = /[\\^$.*+?()[\]{}|]/;

/**
 * 从 `contentPattern` 提取**字面命令头**（`^git push .*` ⇒ `git push`）。
 *
 * 局限（如实标注）：正则化写法（`^git\s+push`）或通配开头（`^.*`）无法静态判定命令头
 * ⇒ 返回 `null`，本层不做结论（不假装能判断）。
 */
export function extractCommandHead(contentPattern: string): string | null {
  const literal = contentPattern.replace(/^\^/, '').trimStart();
  if (!literal) return null;
  const cut = literal.search(REGEX_META);
  const head = (cut === -1 ? literal : literal.slice(0, cut)).trimEnd();
  return head || null;
}

/**
 * 判定 allow 规则的命令头是否命中危险词表（R2b；纯函数）。
 *
 * 复用 `security/patterns` 的**同一份**词表（不复制）：`DANGEROUS_BASE_COMMANDS`
 * 按基础命令名（`mkfs.ext4` ⇒ `mkfs`）与首词比对；`AUTO_MODE_HARD_DENY_TOKENS`
 * 只取命令位令牌（首字符为字母），按「命令头 == 令牌」或「命令头以令牌 + 空格开头」判定。
 *
 * 2026-11-25：从 `manager/ruleCrud.ts` 迁入本模块 —— 审批生成规则的写入路径
 * （`inboxApproval.persistAllowlistRule`）与 `ApprovedCommandRegistry` 的会话级放行
 * 都需要同一判据，而 ruleCrud 反向 import 了 registry（成环），故下沉到无依赖的
 * `commandPatterns`，由 ruleCrud 转出保持既有导出面。
 */
export function findDangerousCommandHead(
  contentPattern: string
): string | null {
  const head = extractCommandHead(contentPattern);
  if (!head) return null;
  const lowered = head.toLowerCase();
  const firstWord = lowered.split(/\s+/)[0]!;
  const baseName = firstWord.split(/[./\\]/)[0]!;
  if (
    DANGEROUS_BASE_COMMANDS.has(firstWord) ||
    DANGEROUS_BASE_COMMANDS.has(baseName)
  ) {
    return baseName;
  }
  for (const token of AUTO_MODE_HARD_DENY_TOKENS) {
    const normalized = token.trim().toLowerCase().replace(/\s+/g, ' ');
    // 只判命令位令牌：`' | '` / `'$('` / `'=rm'` 这类结构令牌不构成命令头
    if (!/^[a-z][a-z0-9]/.test(normalized)) continue;
    if (lowered === normalized || lowered.startsWith(`${normalized} `)) {
      return normalized;
    }
  }
  return null;
}

/**
 * 该命令是否属于"不得以前缀/会话级方式放行"的危险命令（2026-11-25）。
 *
 * 用途：审批卡不再为危险命令提供 `allowlist_command` / `allowlist_workspace_command` /
 * `allowlist_tool_session`；`ApprovedCommandRegistry.allowToolForSession` 也不记录前缀。
 * 只保留「仅这次 / 拒绝」——单次执行仍由批准缓存放行。
 */
export function isDangerousApprovalCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) return false;
  return findDangerousCommandHead(`^${escapeRegExp(trimmed)}$`) !== null;
}

/**
 * 该命令是否**即使写隔离已生效也仍需人工确认**（2026-11-26，用户裁定「沙箱内执行 ⇒ 免审批」）。
 *
 * 判据 = 危险命令 **减去**「内联代码」形态（`python -c` / `node -e` / `bash -c` …）：
 * - 内联代码的副作用就是"任意代码"，而写隔离正是约束它的手段（越界写被内核/低完整性拒绝）
 *   ⇒ 属「沙箱已覆盖」，不再弹卡；
 * - 其余危险命令（删除 / 提权 / 系统配置 / 包安装 …）的后果包含"删掉白名单内目录"这类
 *   **写隔离明确允许**的操作 ⇒ 保持人工确认。
 *
 * ⚠️ 如实边界：写隔离只约束"写"，**读与网络不受限**；本判据不声称这两项已被隔离。
 */
export function requiresApprovalDespiteSandbox(command: string): boolean {
  if (!isDangerousApprovalCommand(command)) return false;
  return !hasInlineCodeFlag(command);
}

/**
 * 该命令是否属于「危险 **且** 会按前缀放大」的命令（2026-11-25）。
 *
 * 解释器/壳内建即使命中危险词表（如 `node -e`），生成的规则是**精确匹配**、不会放大
 * ⇒ 仍可提供「以后这个命令免审批」；只有会生成 `^head.*` 前缀规则的命令
 * （`git push` / `gh pr merge` 等）才收回永久/会话/前缀档位。
 */
export function isDangerousPrefixAmplifyingCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) return false;
  const head = normalizeCommandHead(extractCommandHeadToken(trimmed));
  if (isInterpreterCommandHead(head) || isShellBuiltinCommandHead(head)) {
    return false;
  }
  return isDangerousApprovalCommand(trimmed);
}

