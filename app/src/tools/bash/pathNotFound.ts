/**
 * 「路径不存在」判定（F5，2026-11-04 前端会话跟踪）
 *
 * **背景（真机会话实证）**：15Z 后仍有 30 条 `bash: execute_error`，全部是
 * `dir output` / `dir /s /b /ad "…*01_work*"` 一类**只读列举**，错误文本是
 * `File Not Found` / `The system cannot find the file specified.`（exit 1）。
 * 这与 F3 同族：**"目标确实没有"是事实查询的答案，不是命令执行失败** ——
 * 判成失败会让模型重复同一条命令，并计入 `all-tools-failed`。
 *
 * **判据刻意收窄**（避免把真失败当成功）：
 *   ① 退出码恰为 1（2+ 是语法/IO 错误，照旧失败）；
 *   ② 错误文本明确是"找不到路径/文件"（Windows / POSIX 两种约定文案）；
 *   ③ 命令首词是**只读列举/读取类**（`dir`/`ls`/`find`/`stat`/`cat`/`head`/`tail`/`type`）。
 *
 * 纯函数、无 I/O；**不改安全判定**。
 */

/** 只读列举/读取类命令（首词） */
const READONLY_LOOKUP_COMMANDS = [
  'dir',
  'ls',
  'find',
  'stat',
  'cat',
  'head',
  'tail',
  'type',
  // P1-1（2026-11-05）：`where` / `which` 是纯查找命令，退出码 1 = 没找到，
  // 不是执行失败（真机：`where tsc` 被记为「工具执行失败」）
  'where',
  'which',
];

/**
 * P1-1（2026-11-05）：PowerShell **只读**读取/查找类 cmdlet（含常用别名）。
 *
 * 只在解包 `powershell -Command "<cmdlet>"` 后使用 —— 写类 cmdlet（`Remove-Item` 等）
 * 绝不进入本清单。
 */
const READONLY_LOOKUP_CMDLETS = [
  'get-childitem',
  'gci',
  'get-content',
  'gc',
  'get-item',
  'gi',
  'test-path',
  'resolve-path',
  'select-string',
  'sls',
];

/** `powershell` / `pwsh` 包裹前缀（含 `.exe` 与可选引号） */
const POWERSHELL_WRAPPER_RE =
  /^\s*["']?(?:powershell|pwsh)(?:\.exe)?["']?(?=\s|$)/i;

/** "找不到路径/文件"的约定文案（cmd / POSIX / PowerShell） */
const PATH_MISSING_TEXTS = [
  'file not found',
  'the system cannot find the file specified',
  'the system cannot find the path specified',
  'no such file or directory',
  'cannot access',
  // P1-1（2026-11-05）：`where` 未命中时的固定文案（真机 `where tsc` 命中的就是这条）
  'could not find files for the given pattern(s)',
  // P1-1（2026-11-05）：PowerShell 的固定文案
  //（`Get-Content : Cannot find path '…' because it does not exist.`）
  'cannot find path',
];

/** 取首个 token 并做可执行名归一化（去引号 / 去 `.exe` / 小写） */
function firstCommandToken(command: string): string | undefined {
  return command
    .trim()
    .split(/\s+/)[0]
    ?.replace(/^["']|["']$/g, '')
    .replace(/\.exe$/i, '')
    .toLowerCase();
}

function isReadonlyLookupCommand(command: string): boolean {
  const first = firstCommandToken(command);
  if (!first) return false;
  return (
    READONLY_LOOKUP_COMMANDS.includes(first) ||
    READONLY_LOOKUP_CMDLETS.includes(first)
  );
}

/**
 * P1-1（2026-11-05）：解包 `powershell -Command "<cmdlet>"`，返回内层命令。
 *
 * 真机：只读查询常写成 `powershell -Command "Get-Content PRD.md"`，首词是 `powershell`
 * ⇒ 原判据直接当"非只读命令"⇒ 路径缺失被记成工具失败（模型随后重复同一条命令）。
 *
 * 只解 `-Command` / `-c`：`-File x.ps1` 是**执行脚本**，其失败可能是真失败，保持原判定。
 */
export function unwrapPowerShellCommand(command: string): string | undefined {
  if (!POWERSHELL_WRAPPER_RE.test(command)) return undefined;
  const rest = command.replace(POWERSHELL_WRAPPER_RE, '');
  const matched = rest.match(/(?:^|\s)-(?:command|c)\s+([\s\S]+)$/i);
  if (!matched) return undefined;
  let inner = matched[1].trim();
  const quoted =
    inner.length >= 2 &&
    ((inner.startsWith('"') && inner.endsWith('"')) ||
      (inner.startsWith("'") && inner.endsWith("'")));
  if (quoted) inner = inner.slice(1, -1).trim();
  return inner || undefined;
}

export function isPathNotFound(params: {
  command: string | undefined;
  exitCode?: number;
  stderr?: string;
  /** 兜底：命令失败消息（通常已拼入 stderr） */
  message?: string;
}): boolean {
  if (params.exitCode !== 1) return false;
  const text = `${params.stderr ?? ''}\n${params.message ?? ''}`.toLowerCase();
  if (!PATH_MISSING_TEXTS.some((t) => text.includes(t))) return false;
  const command = params.command ?? '';
  if (isReadonlyLookupCommand(command)) return true;
  const unwrapped = unwrapPowerShellCommand(command);
  return !!unwrapped && isReadonlyLookupCommand(unwrapped);
}
