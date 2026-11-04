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
];

/** "找不到路径/文件"的约定文案（cmd / POSIX） */
const PATH_MISSING_TEXTS = [
  'file not found',
  'the system cannot find the file specified',
  'the system cannot find the path specified',
  'no such file or directory',
  'cannot access',
];

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
  const first = (params.command ?? '')
    .trim()
    .split(/\s+/)[0]
    ?.replace(/^["']|["']$/g, '')
    .replace(/\.exe$/i, '')
    .toLowerCase();
  return !!first && READONLY_LOOKUP_COMMANDS.includes(first);
}
