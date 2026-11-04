/**
 * 「检索无匹配」判定（P3，2026-11-04 前端会话跟踪）
 *
 * **背景（真机会话实证）**：`dir /b /s /ad 2>nul | findstr /i "mario"` 退出码 1、stdout/stderr
 * 均空 —— 这是 `findstr` / `grep` 的**约定语义**（"没有匹配项"即退出码 1），不是执行失败。
 * 旧实现一律走 `bash: execute_error` + failure 结果 ⇒ 每轮计入 `all-tools-failed`
 * （实测 3 次即触发熔断），模型只能反复重试同一条命令。
 *
 * **判据刻意收窄**（避免把真失败当成功）：
 *   ① 退出码**恰为 1**（2 及以上是语法/IO 错误，照旧失败）；
 *   ② stdout 与 stderr **均为空**（有输出说明检索到了内容或报错）；
 *   ③ 管道/串联的**最后一段**是检索类命令（`findstr` / `grep` / `rg` / `select-string` 等）；
 *   ④ 最后一段**没有输出重定向**（`> file` 时"无匹配"与"写进文件"无法区分）。
 *
 * 纯函数、无 I/O。**不改安全判定**，只改成功/失败归类。
 */

/** 检索类命令（最后一段的首个词） */
const SEARCH_COMMANDS = [
  'findstr',
  'grep',
  'egrep',
  'fgrep',
  'rg',
  'select-string',
];

/** 取管道/串联的最后一段（`|`、`||`、`&&`、`;` 都算分隔） */
function lastSegment(command: string): string {
  const parts = command.split(/\|\||&&|[|;]/);
  return (parts[parts.length - 1] ?? '').trim();
}

export function isSearchNoMatch(params: {
  command: string | undefined;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
}): boolean {
  if (params.exitCode !== 1) return false;
  if ((params.stdout ?? '').trim() || (params.stderr ?? '').trim())
    return false;
  const segment = lastSegment(params.command ?? '');
  if (!segment) return false;
  // 输出重定向 ⇒ "无匹配"与"结果写进文件"不可区分
  if (segment.includes('>')) return false;
  // 去掉可能的引号包裹与 `.exe` 后缀
  const first = segment
    .split(/\s+/)[0]
    .replace(/^["']|["']$/g, '')
    .replace(/\.exe$/i, '')
    .toLowerCase();
  return SEARCH_COMMANDS.includes(first);
}
