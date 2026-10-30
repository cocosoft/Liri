/**
 * C4（2026-10-30，一致性核查 §8.1）：**内部诊断文本识别**。
 *
 * 真机现象：assistant 正文里直接出现面向模型的内部提示与原始报错 ——
 * - `[系统提示] 上一轮工具调用返回了错误或空结果。不要直接结束对话…`
 * - `⚠️ 工具执行失败: Command failed: type "C:\…\%TE…`
 * - `安全检查失败: PowerShell 命令 …`
 *
 * 这些文案是**给模型看的**（写入侧见 `MessageService.ts` 的 steering 文案），不该原样占据气泡。
 * 渲染侧据此把它们折叠进「诊断详情」（默认收起），气泡只留一行摘要。
 *
 * 识别口径（宁可少折叠，不误伤正文）：
 * - 文本**开头**命中已知诊断前缀（允许前导空白 / Markdown 引用符 `>`）；
 * - 且整体长度 ≥ `DIAGNOSTIC_MIN_CHARS`（短句多半是正文里正常提到"工具执行失败"）。
 */

/** 折叠门槛（字符数）：低于该长度不折叠，避免把正文一句正常描述当成诊断 */
export const DIAGNOSTIC_MIN_CHARS = 60;

/** 摘要行最大长度 */
export const DIAGNOSTIC_SUMMARY_CHARS = 80;

/** 诊断前缀（按最长匹配优先，避免 `工具执行失败` 抢先命中 `⚠️ 工具执行失败`） */
const DIAGNOSTIC_PREFIXES = [
  "[系统提示]",
  "⚠️ 工具执行失败",
  "工具执行失败",
  "安全检查失败",
  "Command failed:",
] as const;

/** 去掉前导空白与 Markdown 引用符（`> ` 可能被上游当作引用包了一层） */
function stripLeadingNoise(text: string): string {
  return text.replace(/^[\s>]+/, "");
}

/**
 * 判断文本是否为内部诊断文本；命中则返回「一行摘要 + 完整详情」。
 *
 * @returns 命中 ⇒ `{ summary, detail }`；未命中 ⇒ `null`
 */
export function splitDiagnosticText(
  text: string | undefined,
): { summary: string; detail: string } | null {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (trimmed.length < DIAGNOSTIC_MIN_CHARS) return null;

  const body = stripLeadingNoise(trimmed);
  const hit = DIAGNOSTIC_PREFIXES.some((p) => body.startsWith(p));
  if (!hit) return null;

  const firstLine =
    body
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "";
  const summary =
    firstLine.length > DIAGNOSTIC_SUMMARY_CHARS
      ? `${firstLine.slice(0, DIAGNOSTIC_SUMMARY_CHARS)}…`
      : firstLine;

  return { summary, detail: trimmed };
}
