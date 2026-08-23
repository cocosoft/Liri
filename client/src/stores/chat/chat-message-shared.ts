/**
 * Chat Message Slice 共享模块级状态与工具函数
 *
 * 从 chat-message.slice.ts 拆出（R04-001 文件行数限制治理）。
 * 存放跨方法共享的模块级状态（会话切换锁 / 工具结果缓存）与纯工具函数。
 */
import type { MessageBlock } from "@/types";

/**
 * 会话切换锁：setMessages 期间挂起流式写入，避免 loadSessions 覆盖流式数据。
 * 用可变对象封装，供多个拆分文件读写（避免 no-import-assign）。
 */
export const switchState = {
  lock: false,
  pending: [] as Array<{
    sessionId: string;
    assistantId: string;
    blocks: MessageBlock[];
  }>,
};

/**
 * 工具调用全量结果缓存。
 * 设计原则：block 中只存截断摘要（≤2000 字符），全量结果存此处。
 * 渲染时按需通过 toolCallId 获取，避免大内容（grep 全量匹配、file_read 整个文件）撑爆 DOM。
 */
const toolResultFullCache = new Map<string, string>();
/** 全量结果缓存上限（LRU 淘汰，防止长对话内存无限增长） */
export const MAX_TOOL_RESULT_CACHE = 500;

/** block 内联结果最大长度，超出部分截断 */
export const MAX_INLINE_RESULT_LENGTH = 2000;

/** 截断工具结果字符串：保留前 N 字符 + 截断提示 */
export function truncateResult(raw: string): string {
  if (raw.length <= MAX_INLINE_RESULT_LENGTH) return raw;
  const truncated = raw.slice(0, MAX_INLINE_RESULT_LENGTH);
  const lastNewline = truncated.lastIndexOf("\n");
  // 尽量在换行处截断，避免截断在行中间
  const cutPoint =
    lastNewline > MAX_INLINE_RESULT_LENGTH * 0.7
      ? lastNewline
      : MAX_INLINE_RESULT_LENGTH;
  return (
    raw.slice(0, cutPoint) +
    `\n...（共 ${raw.length.toLocaleString()} 字符，已截断，点击展开查看完整结果）`
  );
}

/** 获取工具调用的全量结果（用于渲染层按需展开） */
export function getToolResultFull(toolCallId: string): string | undefined {
  return toolResultFullCache.get(toolCallId);
}

/** 清理全量工具结果缓存（setMessages 加载新会话前调用，防止内存泄漏） */
export function clearToolResultCache(): void {
  toolResultFullCache.clear();
}

/** 写入工具结果全量缓存（LRU 淘汰） */
export function cacheToolResult(toolCallId: string, content: string): void {
  if (toolResultFullCache.size >= MAX_TOOL_RESULT_CACHE) {
    const oldest = toolResultFullCache.keys().next().value;
    if (oldest) toolResultFullCache.delete(oldest);
  }
  toolResultFullCache.set(toolCallId, content);
}

/**
 * 同 toolCallId 的 tool_call 块去重（**合并策略**）。
 *
 * 背景（2026-08-23）：SSE 层 tool_start/tool_end 双 chunk 被重复发送时，
 * 同一 toolCallId 会出现多块（实测"2 带 args + 2 空 args"）。其中：
 *   - tool_start 块：带 arguments（建卡）
 *   - tool_end 块：空 arguments，但带 status/result（终态）
 *
 * 去重须**合并**而非简单 first/last-wins：
 *   - 终态字段（status/result/error）取后到块（tool_end 优先）
 *   - arguments 取首个非空值（保留 tool_start 建卡参数）
 * 否则只取 tool_end 会丢工具参数摘要，只取 tool_start 会丢执行结果。
 *
 * 渲染层（ChatMessage）/ 落盘层（processChunk/SaveQueue）/ 读取层共用此函数。
 */
export function dedupeToolCallBlocks(blocks: MessageBlock[]): MessageBlock[] {
  const merged = new Map<string, MessageBlock>();
  for (const b of blocks) {
    if (b.type !== "tool_call") continue;
    const toolId = b.toolCallId || b.toolCall?.id;
    if (!toolId) continue;
    const existing = merged.get(toolId);
    if (!existing) {
      merged.set(toolId, { ...b, toolCall: { ...b.toolCall! } });
    } else {
      const prev = existing.toolCall!;
      const next = b.toolCall!;
      const prevHasArgs =
        prev.arguments && Object.keys(prev.arguments).length > 0;
      existing.toolCall = {
        ...prev,
        ...next,
        // arguments：保留首个非空值（tool_start 建卡参数），避免 tool_end 空 args 覆盖
        arguments: prevHasArgs ? prev.arguments : next.arguments,
      };
    }
  }
  if (merged.size === 0) return blocks;
  const result: MessageBlock[] = [];
  for (const b of blocks) {
    if (b.type !== "tool_call") {
      result.push(b);
      continue;
    }
    const toolId = b.toolCallId || b.toolCall?.id;
    if (!toolId) {
      result.push(b);
      continue;
    }
    const m = merged.get(toolId);
    if (!m) continue; // 该 toolId 已输出过（首个块位置）→ 跳过后续重复块
    // 每个 toolId 只在首次出现位置输出一次（合并后的终态块）
    result.push(m);
    merged.delete(toolId);
  }
  return result;
}

/** P2-2: 移除指定会话的流控制器，返回新对象（不可变更新） */
export function removeStreamController(
  controllers: Record<string, AbortController>,
  sid: string,
): Record<string, AbortController> {
  const next = { ...controllers };
  delete next[sid];
  return next;
}
