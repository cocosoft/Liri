/**
 * C2（2026-10-30，一致性核查 §8.1）：assistant 正文的**JSON 包装解包**。
 *
 * 真机实测（会话 `session_mvoqs1ho875ea6b95e`）：最近 30 条 assistant 里 **18 条** content
 * 形如 `{"data":"…工具输出…"}`（含字面 `\n` / `\"`），气泡里原样铺开 ⇒ 用户看到的是 JSON 源码。
 *
 * 处置（**只在渲染侧、只对 assistant 正文**，不动落盘数据）：
 * - 仅解包**窄形态**：整段是一个对象、**只有一个 key `data`**、其值是**非空字符串**；
 * - 其余"疑似 JSON"（多字段 / 数组 / 非字符串 data）**原样返回 `null`**（不解包、不折叠）——
 *   避免把用户要求的合法 JSON 代码块当包装拆掉（宁可保持原样，也不误伤）。
 * - 解包结果里的 `\n` 已被 `JSON.parse` 还原为真换行，可直接交给 Markdown 渲染。
 */

/** 解包上限（超过则不尝试解析，避免大会话每帧解析多兆字符串造成卡顿） */
export const JSON_PAYLOAD_MAX_CHARS = 512 * 1024;

/**
 * 若文本是 `{"data":"…"}` 窄包装 ⇒ 返回内层字符串；否则返回 `null`。
 */
export function unwrapJsonDataPayload(text: string | undefined): string | null {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > JSON_PAYLOAD_MAX_CHARS) {
    return null;
  }
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return null;

  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 1 || keys[0] !== "data") return null;

  const data = record.data;
  if (typeof data !== "string" || data.trim().length === 0) return null;
  return data;
}
