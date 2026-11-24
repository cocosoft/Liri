/**
 * 连续孤儿工具结果的读取入口（2026-11-24）
 *
 * `setMessages` 把**连续**的、找不到对应 `tool_call` 定义的 `role=tool` 结果
 * 合并成一条消息，记录在 `metadata.groupedToolResults`。渲染侧统一从这里读取，
 * 判据只用结构化字段（禁止文案匹配，CS02）。
 */
import type { GroupedToolResult, Message } from "../types";

const isGroupedToolResult = (item: unknown): item is GroupedToolResult => {
  if (!item || typeof item !== "object") return false;
  const rec = item as Record<string, unknown>;
  return typeof rec.id === "string" && typeof rec.content === "string";
};

export function readGroupedToolResults(message: Message): GroupedToolResult[] {
  const raw = message.metadata?.groupedToolResults;
  if (!Array.isArray(raw)) return [];
  return raw.filter(isGroupedToolResult);
}
