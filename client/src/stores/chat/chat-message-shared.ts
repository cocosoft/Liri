/**
 * Chat Message Slice 共享模块级状态与工具函数
 *
 * 从 chat-message.slice.ts 拆出（R04-001 文件行数限制治理）。
 * 存放跨方法共享的模块级状态（会话切换锁 / 工具结果缓存）与纯工具函数。
 */
import type { MessageBlock } from "@/types";
import i18n from "@/i18n";

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
    i18n.t("chat.stream.truncatedResult", {
      total: raw.length.toLocaleString(),
    })
  );
}

/** 获取工具调用的全量结果（用于渲染层按需展开） */
export function getToolResultFull(toolCallId: string): string | undefined {
  return toolResultFullCache.get(toolCallId);
}

/**
 * P0-1（2026-11-06）：消息列表里是否已有**待处理**的审批卡片。
 *
 * 用途：流式回合以「等待审批」收尾后判断是否需要补拉消息。
 * 服务端的 Inbox 块是**读时合成**（`attachPendingApprovalBlocks`），
 * 列表里没有 pending 卡片通常意味着本轮 assistant 消息尚未落盘 ⇒ 可重试一次。
 */
export function hasPendingApprovalCard(
  messages: ReadonlyArray<{ blocks?: MessageBlock[] }>,
): boolean {
  return messages.some((m) =>
    (m.blocks ?? []).some(
      (b) => b.type === "inbox" && b.inboxData?.status === "pending",
    ),
  );
}

/**
 * U-06-5（2026-10-19）：从工具结果**对象或 JSON 文本**提取审批等待信号。
 *
 * `awaiting_approval` 结果由后端返回为结构化 JSON
 * （`{ status: 'awaiting_approval', pendingApproval: true, inboxId }`），
 * 这里只认**结构化字段**（CS02：状态判断不用字符串匹配），非审批结果返回 null。
 */
export function readApprovalSignal(
  raw: unknown,
): { pendingApproval: true; inboxId?: string } | null {
  let value: unknown = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      // 非 JSON（普通文本工具结果）⇒ 无审批信号，非错误路径
      return null;
    }
  }
  if (typeof value !== "object" || value === null) return null;
  const rec = value as { pendingApproval?: unknown; inboxId?: unknown };
  if (rec.pendingApproval !== true) return null;
  return {
    pendingApproval: true,
    inboxId: typeof rec.inboxId === "string" ? rec.inboxId : undefined,
  };
}

/** 兼容入口：仅接受 JSON 文本的审批信号解析（既有调用方不变） */
export function parseApprovalSignal(
  raw: unknown,
): { pendingApproval: true; inboxId?: string } | null {
  return typeof raw === "string" ? readApprovalSignal(raw) : null;
}

/**
 * 2026-11-12：用**最近一次工具结果**刷新工具卡上的审批等待标记。
 *
 * 规则：结果是 `awaiting_approval` ⇒ 置位；任何**终态结果**（成功/失败/普通文本）⇒ 清除。
 * 原实现只置位、从不清除 ⇒ 批准后同一次调用既显示服务端合成的「已处理」Inbox 卡，
 * 又保留工具卡上的「等待审批 + 批准/拒绝」按钮 ⇒ 用户看到**两张卡**（真机
 * `session_mwd632bob8d4318050`：1 个 tool_call、0 次重复执行，卡片却为 2 张）。
 */
export function resolveApprovalFlags(rawResult: unknown): {
  pendingApproval?: boolean;
  inboxId?: string;
} {
  const signal = readApprovalSignal(rawResult);
  if (signal) {
    return { pendingApproval: true, inboxId: signal.inboxId };
  }
  // 终态 ⇒ 显式清除（含 inboxId：就地审批入口随之消失）
  return { pendingApproval: undefined, inboxId: undefined };
}

/**
 * 2026-11-12：同一 toolCallId 的两条工具结果（审批占位 + 批准后的真实结果）谁进映射表。
 *
 * 落盘/事件顺序不可靠（占位可能后到）⇒ 不能只靠"后写覆盖"：**终态优先**。
 */
export function preferToolResult(
  previous: string | undefined,
  next: string,
): boolean {
  if (previous === undefined) return true;
  const prevAwaiting = readApprovalSignal(previous) !== null;
  const nextAwaiting = readApprovalSignal(next) !== null;
  // 终态结果一律采用（两条都终态时保持"后写覆盖"）；唯一拒绝：终态已被记下后，占位又迟到
  return !nextAwaiting || prevAwaiting;
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

/** P2-2: 移除指定会话的流控制器，返回新对象（不可变更新）
 * F2 修复（2026-08-24）：新增 expected 引用校验——同会话新流替换旧流时，
 * 旧流 A 结束清理若按 sid 直接 delete，会误删新流 B 已注册的 controller
 * （B 无法停止、isStreaming 提前 false）。传本流 controller 后仅在
 * `controllers[sid] === expected` 时才删除，否则保留（B 的注册不被干扰）。
 * 不传 expected 时保持旧行为（按 sid 删除），供非竞态清理点使用。
 */
export function removeStreamController(
  controllers: Record<string, AbortController>,
  sid: string,
  expected?: AbortController,
): Record<string, AbortController> {
  const next = { ...controllers };
  if (expected !== undefined && next[sid] !== expected) {
    return next; // 已被新流替换，不误删新流 controller
  }
  delete next[sid];
  return next;
}
