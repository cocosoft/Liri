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
 * 在高能力解释器之外补入常见 shell（`cmd` / `sh` / `bash` / `zsh` / `fish`）：
 * 它们的共性是「第一个 token 只说明用什么执行器，不说明执行什么」⇒ 前缀规则没有意义。
 */
export const INTERPRETER_COMMAND_HEADS: ReadonlySet<string> = new Set([
  ...HIGH_CAPABILITY_INTERPRETERS,
  'cmd',
  'sh',
  'bash',
  'zsh',
  'fish',
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
 * - 其余命令 ⇒ 保留既有「前 2 token 前缀 + `.*`」口径（与历史行为逐字一致）。
 */
export function buildCommandContentPattern(command: string): string {
  const trimmed = command.trim();
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return '';

  const head = normalizeCommandHead(extractCommandHeadToken(trimmed));
  if (isInterpreterCommandHead(head)) {
    return `^${escapeRegExp(trimmed)}$`;
  }

  const prefix = tokens.slice(0, 2).join(' ');
  return `^${escapeRegExp(prefix)}.*`;
}
