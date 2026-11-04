/**
 * 只读探测命令的**出路提示**（P2-2，2026-11-04）
 *
 * 背景（《运行态问题排查与修复方案》P2-2）：窗口内 `bash: security_gate_blocked` **21 次**，
 * 形态是 `if exist …` 一类**只读探测**（判断路径/文件是否存在）——模型被拦后没有出路信息，
 * 只能反复换写法重试。
 *
 * ⚠️ **本模块不改安全判定**（CD07：安全门属关键模块）：拦截照旧 fail-closed，只把
 * "这类需求可以用 glob / list / read 工具完成"这一条**出路**附在拦截结果上。
 *
 * 纯函数、无 I/O；平台无关（cmd 与 POSIX 两种写法都识别）。
 */
import type { ToolResult } from '../types';

/** 只读探测命令的形态（仅用于决定是否附提示，**不参与**任何放行判定） */
const READ_ONLY_PROBE_PATTERNS: readonly RegExp[] = [
  /^\s*if\s+(not\s+)?exist\b/i, // cmd: if exist <路径> (…)
  /^\s*test\s+-[efd]\b/, // POSIX: test -e / -f / -d <路径>
  /^\s*\[\s+-[efd]\s/, // POSIX: [ -e / -f / -d <路径> ]
];

const PROBE_HINT =
  '\n提示: 本次被拦截的是「判断路径/文件是否存在」的**只读探测**命令。' +
  '这类需求请改用 glob / list 工具（列目录、按模式匹配），或 read 工具（读具体文件），' +
  '不必用终端探测；确实需要执行终端命令时，请在命令里说明用途。';

/**
 * 构造提示文本；命令不属于只读探测 ⇒ **空字符串**（调用方据此不追加）。
 */
export function buildReadOnlyProbeHint(command: string): string {
  return READ_ONLY_PROBE_PATTERNS.some((re) => re.test(command))
    ? PROBE_HINT
    : '';
}

/**
 * 给拦截结果追加出路提示（error / data / 回给模型的消息三处同源追加）。
 *
 * 非只读探测 ⇒ **原对象原样返回**（调用方可据引用相等判定"未改动"）。
 * `failureKind` / `metadata` 等**安全语义字段一律不动** —— 只改可读文案。
 */
export function appendReadOnlyProbeHint(
  result: ToolResult<unknown>,
  command: string
): ToolResult<unknown> {
  const hint = buildReadOnlyProbeHint(command);
  if (!hint) return result;
  return {
    ...result,
    ...(typeof result.error === 'string' ? { error: result.error + hint } : {}),
    ...(typeof result.data === 'string' ? { data: result.data + hint } : {}),
    ...(result.newMessages?.length
      ? {
          newMessages: result.newMessages.map((m) =>
            Object.assign({}, m, { content: `${m.content}${hint}` })
          ),
        }
      : {}),
  };
}
