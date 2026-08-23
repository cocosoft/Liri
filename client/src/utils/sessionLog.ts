/**
 * Session Log — 会话日志共享模块（CS01 归一化）
 *
 * 会话日志面板（LogTab）使用：
 * - extractToolCalls：从 messages 提取工具调用记录（blocks 优先 + upsert 合并）
 * - buildLogEvents：把消息归一化为会话日志事件流（thinking / tool / system）
 * - summarizeResult / extractError：结果人性化摘要与错误提取
 */

import type { LiriEvent, Message, ToolCall } from "../types";
import { getToolDisplayName, getToolHumanSummary } from "./toolHumanSummary";
import { createLogger } from "./logger";

const logger = createLogger("chat:sessionLog");

// ─── 工具调用记录 ─────────────────────────────────

export interface ToolCallRecord {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  status: "running" | "completed" | "failed" | "canceled";
  messageId?: string;
  error?: string;
  _hasFullResult?: boolean;
}

/**
 * 从消息列表中提取（并合并）全部工具调用记录。
 * Map<toolCallId, record> 提供 O(1) 查找，替代原线性 find（O(n²) → O(n)）。
 * 跨消息合并依赖全局视角（消息级 tool_calls / blocks / tool 角色消息分散在不同消息），
 * per-message 增量缓存会破坏该合并，故保持全量派生 + Map 索引（2026-08-19，见计划 P0）。
 */
export function extractToolCalls(messages: Message[]): ToolCallRecord[] {
  const start = performance.now();
  // Map 保持插入顺序，与返回数组顺序一致
  const recordMap = new Map<string, ToolCallRecord>();
  let setCount = 0; // 新建记录数
  let mergeCount = 0; // 合并补齐记录数
  logger.info("extractToolCalls: Map 构建开始", {
    messages: messages.length,
  });

  /** 插入或合并记录：blocks 中的 tool_call 携带完整 result，优先补齐到已存在的消息级记录 */
  const upsert = (tc: ToolCall, messageId?: string) => {
    const existing = recordMap.get(tc.id);
    if (existing) {
      mergeCount++;
      // 消息级 tool_calls 通常无 result，blocks 中才有完整结果 → 合并补齐
      if (existing.result === undefined && tc.result !== undefined) {
        existing.result = tc.result;
      }
      if (
        existing._hasFullResult === undefined &&
        (tc as { _hasFullResult?: boolean })._hasFullResult
      ) {
        existing._hasFullResult = true;
      }
      // 失败原因合并补齐（tool_end 失败块携带 error，消息级 tool_calls 通常无）
      if (existing.error === undefined && tc.error) {
        existing.error = tc.error;
      }
      if (tc.status) existing.status = tc.status;
      return;
    }
    setCount++;
    recordMap.set(tc.id, {
      id: tc.id,
      name: tc.name,
      arguments: tc.arguments || {},
      result: tc.result,
      status: tc.status || "completed",
      messageId,
      error: tc.error,
      _hasFullResult: !!(tc as { _hasFullResult?: boolean })._hasFullResult,
    });
  };

  for (const msg of messages) {
    // 路径 1：blocks 中的 tool_call（含完整参数/结果/状态，优先）
    if (msg.blocks) {
      for (const block of msg.blocks) {
        if (block.type === "tool_call" && block.toolCall) {
          const tc = block.toolCall;
          upsert(
            {
              ...tc,
              status:
                tc.status || (block.isStreaming ? "running" : "completed"),
            },
            msg.id,
          );
        }
      }
    }
    // 路径 2：消息级 tool_calls（blocks 缺失时的兜底）
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        upsert(tc, msg.id);
      }
    }
    // 路径 3：tool 角色消息补充结果
    if (msg.role === "tool" && msg.toolCallId) {
      const existing = recordMap.get(msg.toolCallId);
      if (existing && existing.result === undefined) {
        existing.result = msg.content;
        existing.status = "completed";
      }
    }
  }

  const elapsed = performance.now() - start;
  logger.info("extractToolCalls: Map 构建完成", {
    messages: messages.length,
    recordCount: recordMap.size,
    setCount,
    mergeCount,
    elapsedMs: Number(elapsed.toFixed(3)),
  });

  return Array.from(recordMap.values());
}

// ─── 会话日志事件 ─────────────────────────────────

export type LogEventKind = "thinking" | "tool" | "system";

export interface LogEvent {
  /** 稳定 React key（block.id / toolCall.id，streaming 不重排） */
  key: string;
  kind: LogEventKind;
  /** 近似时序：同消息内按数组序，跨消息用 message.timestamp */
  time: number;
  status?: "running" | "completed" | "failed" | "canceled";
  /** 摘要锚点行 */
  title: string;
  /** thinking / system 正文 */
  content?: string;
  /** tool 事件（含参数/结果/状态） */
  record?: ToolCallRecord;
}

function firstLine(text: string): string {
  const line = (text || "").split("\n")[0].trim();
  return line.length > 60 ? `${line.slice(0, 60)}…` : line || "（空）";
}

function toolEventTitle(rec: ToolCallRecord): string {
  const name = getToolDisplayName(rec.name);
  const summary = getToolHumanSummary({
    name: rec.name,
    arguments: rec.arguments,
    id: rec.id,
  } as ToolCall);
  return summary ? `${name} — ${summary}` : name;
}

function toolEvent(msg: Message, rec: ToolCallRecord): LogEvent {
  return {
    key: `tool-${rec.id}`,
    kind: "tool",
    time: msg.timestamp,
    status: rec.status,
    title: toolEventTitle(rec),
    record: rec,
  };
}

/**
 * 把消息归一化为会话日志事件流（thinking / tool / system 混排的时序流）。
 * 事件 key 稳定，streaming 状态切换只更新该行不重排。
 */
export function buildLogEvents(messages: Message[]): LogEvent[] {
  const events: LogEvent[] = [];
  const toolRecords = extractToolCalls(messages);
  const recordById = new Map(toolRecords.map((r) => [r.id, r]));
  const emittedTools = new Set<string>();

  for (const msg of messages) {
    if (msg.blocks) {
      for (const block of msg.blocks) {
        if (block.type === "thinking" && block.content) {
          events.push({
            key: `thinking-${block.id}`,
            kind: "thinking",
            time: msg.timestamp,
            title: firstLine(block.content),
            content: block.content,
          });
        } else if (block.type === "status" && block.content) {
          events.push({
            key: `status-${block.id}`,
            kind: "system",
            time: msg.timestamp,
            title: firstLine(block.content),
            content: block.content,
          });
        } else if (block.type === "tool_call" && block.toolCall) {
          const rec = recordById.get(block.toolCall.id);
          if (rec && !emittedTools.has(rec.id)) {
            emittedTools.add(rec.id);
            events.push(toolEvent(msg, rec));
          }
        }
      }
    }
    // 消息级 tool_calls 兜底（blocks 缺失）
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        const rec = recordById.get(tc.id);
        if (rec && !emittedTools.has(rec.id)) {
          emittedTools.add(rec.id);
          events.push(toolEvent(msg, rec));
        }
      }
    }
  }

  return events;
}

// ─── 事件流 → 会话日志（R-3：LogTab 消费事件流） ───

/**
 * R-3（2026-08-23）：从事件流（LiriEvent[]，seq 升序）构建会话日志事件。
 * 替代 buildLogEvents（从 messages 投影重建）——事件流保留精确 seq 序、
 * 流式实时性与工具终态（assistant/tool_call → tool/result 配对）。
 *
 * 不可变更新：tool/result 到达时**替换**对应 LogEvent 引用（React.memo 依赖
 * 引用变化触发重渲染），工具行状态 running → completed/failed 实时刷新。
 */
export function buildLogEventsFromEvents(events: LiriEvent[]): LogEvent[] {
  const logEvents: LogEvent[] = [];
  const toolIdxById = new Map<string, number>();

  for (const event of events) {
    switch (event.type) {
      case "assistant/thinking": {
        const content = (event.data as { content?: string }).content ?? "";
        if (!content) break;
        logEvents.push({
          key: `evt-${event.seq}-thinking`,
          kind: "thinking",
          time: event.time,
          title: firstLine(content),
          content,
        });
        break;
      }
      case "assistant/tool_call": {
        const d = event.data as {
          toolCallId: string;
          name: string;
          args?: unknown;
        };
        const rec: ToolCallRecord = {
          id: d.toolCallId,
          name: d.name,
          arguments: (d.args as Record<string, unknown>) || {},
          status: "running",
        };
        toolIdxById.set(d.toolCallId, logEvents.length);
        logEvents.push({
          key: `tool-${d.toolCallId}`,
          kind: "tool",
          time: event.time,
          status: "running",
          title: toolEventTitle(rec),
          record: rec,
        });
        break;
      }
      case "tool/result": {
        const d = event.data as {
          toolCallId: string;
          result?: string;
          isError?: boolean;
        };
        const idx = toolIdxById.get(d.toolCallId);
        if (idx === undefined) break;
        const prev = logEvents[idx];
        if (prev.kind !== "tool" || !prev.record) break;
        const merged: ToolCallRecord = {
          ...prev.record,
          result: d.result,
          status: d.isError ? "failed" : "completed",
        };
        merged.error = d.isError
          ? (extractError(merged) ?? undefined)
          : undefined;
        logEvents[idx] = {
          ...prev,
          status: merged.status,
          title: toolEventTitle(merged),
          record: merged,
        };
        break;
      }
      case "tool/canceled": {
        // B-3（2026-08-23）：工具未完成终态——配对到 tool 记录并置为 canceled
        const d = event.data as { toolCallId: string; reason?: string };
        const idx = toolIdxById.get(d.toolCallId);
        if (idx === undefined) break;
        const prev = logEvents[idx];
        if (prev.kind !== "tool" || !prev.record) break;
        const merged: ToolCallRecord = {
          ...prev.record,
          status: "canceled",
          error: d.reason,
        };
        logEvents[idx] = {
          ...prev,
          status: "canceled",
          title: toolEventTitle(merged),
          record: merged,
        };
        break;
      }
      case "assistant/status": {
        const content = (event.data as { content?: string }).content ?? "";
        if (!content) break;
        logEvents.push({
          key: `evt-${event.seq}-status`,
          kind: "system",
          time: event.time,
          title: firstLine(content),
          content,
        });
        break;
      }
      default:
        break;
    }
  }
  return logEvents;
}

// ─── 结果/错误辅助 ───────────────────────────────

/** 结果人性化摘要：结构化 {success, data} 取 data 主体，避免整段 JSON 刷屏 */
export function summarizeResult(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    // 常见的 {success:true, data:"..."} / {data: "..."} 包装结构 → 取 data
    if ("data" in r) {
      const data = r.data;
      if (typeof data === "string" && data.trim()) return data;
      if (data && typeof data === "object") {
        const summary = JSON.stringify(data);
        return summary && summary.length > 500
          ? summary.slice(0, 500) + "..."
          : summary;
      }
    }
    // 单 key 包装（如 {output: "..."} / {message: "..."}）→ 取该值
    const keys = Object.keys(r);
    if (keys.length === 1) {
      const v = r[keys[0]];
      if (typeof v === "string" && v.trim()) return v;
    }
  }
  const text = JSON.stringify(result);
  return text && text.length > 500
    ? text.slice(0, 500) + "..."
    : text || String(result);
}

/** 从工具记录中提取错误信息（失败时展示，不依赖字符串匹配状态判断） */
export function extractError(record: ToolCallRecord): string | null {
  if (record.error) return record.error;
  if (record.status !== "failed") return null;
  if (!record.result) return "未知错误";
  if (typeof record.result === "string") return record.result.slice(0, 200);
  if (typeof record.result === "object" && record.result !== null) {
    const r = record.result as Record<string, unknown>;
    if (typeof r.error === "string") return r.error;
    if (typeof r.message === "string") return r.message;
    if (typeof r.detail === "string") return r.detail;
    return JSON.stringify(r).slice(0, 200);
  }
  return String(record.result).slice(0, 200);
}
