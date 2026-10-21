/**
 * 工具结果预览（REPL 工具卡片用）
 *
 * **为什么要它**：REPL 的流循环此前把所有非文本 chunk 一律跳过
 *（`ReplApp.tsx` 的"其他非文本分块（如 tool_call, status 等）跳过"），
 * 于是 `tool_end` 下发的 `toolCall.result` / `error` 全被丢弃 —— 用户只看到
 *「🔧 工具名 已完成」，看不到任何执行结果。结果文本的裁剪/降级规则收在本文件，
 * 便于单测（REPL 组件本身不可测）。
 */

/** 单行预览的最大字符数（超出截断 + 省略号；终端宽度有限，宁短勿长） */
export const TOOL_RESULT_PREVIEW_MAX = 120;

/**
 * 任意 `result` 载荷 → 单行预览
 *
 * - 后端 `tool_end` 的形状是 `{ success: true, data: <output> }`
 *   （见 `chat/reactEventsToChunks.ts`）⇒ 取 `data` 作为正文，避免把包装对象打给用户；
 * - 字符串原样；对象 `JSON.stringify`；循环引用/大整数等序列化失败 ⇒ `String()` 降级；
 * - 所有空白折叠为单空格（多行输出在卡片里必须是一行）。
 */
export function summarizeToolResult(
  result: unknown,
  maxLength: number = TOOL_RESULT_PREVIEW_MAX
): string {
  if (result === undefined || result === null) return '';

  let payload: unknown = result;
  if (typeof result === 'object' && !Array.isArray(result)) {
    const record = result as Record<string, unknown>;
    if ('data' in record) payload = record['data'];
  }

  const text = typeof payload === 'string' ? payload : stringifySafely(payload);
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= maxLength) return oneLine;
  return `${oneLine.slice(0, Math.max(0, maxLength - 1))}…`;
}

function stringifySafely(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    // @ignore-catch — 循环引用 / BigInt 等无法序列化 ⇒ 降级为 String()，不抛给渲染层
    return String(value);
  }
}
