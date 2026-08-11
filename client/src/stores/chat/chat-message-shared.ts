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

/** P2-2: 移除指定会话的流控制器，返回新对象（不可变更新） */
export function removeStreamController(
  controllers: Record<string, AbortController>,
  sid: string,
): Record<string, AbortController> {
  const next = { ...controllers };
  delete next[sid];
  return next;
}
