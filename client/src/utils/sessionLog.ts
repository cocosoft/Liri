/**
 * Session Log — 会话日志共享模块（CS01 归一化）
 *
 * 会话日志面板（LogTab）使用：
 * - buildLogEventsFromEvents：以事件流为准构建会话日志（thinking / text / tool / system）
 * - summarizeResult / extractError：结果人性化摘要与错误提取
 *
 * 2026-11-24（P2-2 死代码清理 / CD06）：已删除无生产消费者的 `extractToolCalls` /
 * `buildLogEvents`（消息投影重建路径），事件流路径为唯一实现。
 */

import type { LiriEvent, ToolCall } from "../types";
import { getToolDisplayName, getToolHumanSummary } from "./toolHumanSummary";
// G6（2026-11-03）：审批等待信号复用 U-06-5 的**唯一**结构化解析（CS01，禁止另写字符串匹配）
import { parseApprovalSignal } from "../stores/chat/chat-message-shared";
import i18n from "../i18n";

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
  /**
   * G6（2026-11-03）：工具结果为 `awaiting_approval`（等待人审批）。
   *
   * 修复前该结果按普通成功结果投影 ⇒ 面板显示"已完成/进行中"，用户无从得知它在等审批。
   * 结构化信号由 `parseApprovalSignal` 解析（不按字符串匹配，CS02）。
   */
  pendingApproval?: boolean;
  /** G6：审批收件箱 id（就地批准用；无则退回收件箱） */
  inboxId?: string;
  /** G7（2026-11-03）：本卡合并了多少条原始 `tool/result`（面板卡片是合并视图） */
  rawResultCount?: number;
}

// ─── 会话日志事件 ─────────────────────────────────

export type LogEventKind = "thinking" | "text" | "tool" | "system";

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
  return line.length > 60
    ? `${line.slice(0, 60)}…`
    : line || i18n.t("logs.empty");
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

// ─── 事件流 → 会话日志（R-3：LogTab 消费事件流） ───

/**
 * R-3（2026-08-23）：从事件流（LiriEvent[]，seq 升序）构建会话日志事件。
 * 事件流保留精确 seq 序、流式实时性与工具终态（assistant/tool_call → tool/result 配对）；
 * 2026-11-24 起它是**唯一实现**（消息投影重建路径已按 CD06 删除）。
 *
 * 不可变更新：tool/result 到达时**替换**对应 LogEvent 引用（React.memo 依赖
 * 引用变化触发重渲染），工具行状态 running → completed/failed 实时刷新。
 */
export function buildLogEventsFromEvents(events: LiriEvent[]): LogEvent[] {
  const logEvents: LogEvent[] = [];
  const toolIdxById = new Map<string, number>();

  // P0-A（2026-08-26）：thinking/text chunk 累积器——连续同类型 chunk 合并为一张卡片，
  // 解决"一段思考被拆成几十条记录"的碎片化；key 用首条 seq 保持稳定（流式追加不重排）。
  let pending: {
    kind: "thinking" | "text";
    messageId?: string;
    parts: string[];
    firstSeq: number;
    time: number;
  } | null = null;

  const flushPending = () => {
    if (!pending) return;
    const content = pending.parts.join("");
    logEvents.push({
      key: `evt-${pending.firstSeq}-${pending.kind}`,
      kind: pending.kind,
      time: pending.time,
      title: firstLine(content),
      content,
    });
    pending = null;
  };

  for (const event of events) {
    switch (event.type) {
      case "assistant/thinking":
      case "assistant/text":
      // F-2（2026-09-02）：text-batch（聚合批）与逐条 text 同语义展示
      case "assistant/text-batch": {
        // P0-B：assistant/text（AI 回复正文）现在也会产出 kind:"text" 的 LogEvent，
        // 成为日志的语义分隔锚点（"这一轮 AI 最终给了什么"）
        const d = event.data as { content?: string; messageId?: string };
        if (!d.content) break;
        const kind = event.type === "assistant/thinking" ? "thinking" : "text";
        // 合并条件：同 kind + 同 messageId（历史事件无 messageId 时退化为"相邻同类型"）
        if (
          pending &&
          pending.kind === kind &&
          (pending.messageId ?? null) === (d.messageId ?? null)
        ) {
          pending.parts.push(d.content);
        } else {
          flushPending();
          pending = {
            kind,
            messageId: d.messageId,
            parts: [d.content],
            firstSeq: event.seq,
            time: event.time,
          };
        }
        break;
      }
      case "assistant/tool_call": {
        flushPending();
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
        flushPending();
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
          // G7：同一 toolCallId 的多次结果被合并成一张卡，卡片据此自述"N 条原始记录"
          rawResultCount: (prev.record.rawResultCount ?? 0) + 1,
        };
        merged.error = d.isError
          ? (extractError(merged) ?? undefined)
          : undefined;
        // G6：审批等待结果是**结构化信号**（`{ pendingApproval: true, inboxId }`），
        // 不是"已完成"——投影为待审批态，避免面板把它当成成功执行。
        // 2026-11-24（状态口径统一）：终态结果必须**清除**旧标记，否则批准后
        // 面板会一直显示「等待审批」（与 `updateToolCallResult` 同一缺陷模式）。
        const approval = parseApprovalSignal(d.result);
        merged.pendingApproval = approval ? true : undefined;
        merged.inboxId = approval?.inboxId;
        logEvents[idx] = {
          ...prev,
          status: merged.status,
          title: toolEventTitle(merged),
          record: merged,
        };
        break;
      }
      case "tool/canceled": {
        flushPending();
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
        flushPending();
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
        // 其它事件（turn/start、turn/end 等）同样封口，避免跨段合并
        flushPending();
        break;
    }
  }
  flushPending();
  return logEvents;
}

/**
 * P0（2026-11-03，cwd 方案 §六.2）：原始 `tool/result` 错误记录数。
 *
 * `buildLogEventsFromEvents` 把同一 toolCallId 的多次结果**合并成一张卡**
 *（后到的 result 覆盖前者），面板的 failed 计数是「合并卡片数」；
 * 本函数数的是「原始错误记录数」。两者并列展示（卡片 N / 原始 M 条），
 * 消除「面板 17 卡 vs 导出 36 条」的口径困惑。
 */
export function countRawToolErrorRecords(events: LiriEvent[]): number {
  let count = 0;
  for (const event of events) {
    if (event.type !== "tool/result") continue;
    const d = event.data as { isError?: boolean } | undefined;
    if (d?.isError === true) count++;
  }
  return count;
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
  if (!record.result) return i18n.t("logs.unknownError");
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
