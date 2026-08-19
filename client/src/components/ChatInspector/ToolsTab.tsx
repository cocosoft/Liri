/**
 * 工具 Tab — 工具调用列表（进行中/完成/失败）+ 详情 + 重试
 */

import React from "react";
import { useMemo, useState } from "react";
import { useChatStore } from "../../stores/chat";
import type { ToolCall } from "../../types";
import {
  getToolDisplayName,
  getToolHumanSummary,
} from "../../utils/toolHumanSummary";
import { getToolResultFull } from "../../stores/chat/chat-message.slice";

interface ToolCallRecord {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  status: "running" | "completed" | "failed";
  messageId?: string;
  error?: string;
  _hasFullResult?: boolean;
}

function extractToolCalls(
  messages: ReturnType<typeof useChatStore.getState>["messages"],
): ToolCallRecord[] {
  const seen = new Set<string>();
  const records: ToolCallRecord[] = [];

  /** 插入或合并记录：blocks 中的 tool_call 携带完整 result，优先补齐到已存在的消息级记录 */
  const upsert = (tc: ToolCall, messageId?: string) => {
    const existing = records.find((r) => r.id === tc.id);
    if (existing) {
      // 消息级 tool_calls 通常无 result，blocks 中才有完整结果 → 合并补齐（根因修复）
      if (existing.result === undefined && tc.result !== undefined) {
        existing.result = tc.result;
      }
      if (
        existing._hasFullResult === undefined &&
        (tc as { _hasFullResult?: boolean })._hasFullResult
      ) {
        existing._hasFullResult = true;
      }
      if (tc.status) existing.status = tc.status;
      return;
    }
    seen.add(tc.id);
    records.push({
      id: tc.id,
      name: tc.name,
      arguments: tc.arguments || {},
      result: tc.result,
      status: tc.status || "completed",
      messageId,
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
      const existing = records.find((r) => r.id === msg.toolCallId);
      if (existing && existing.result === undefined) {
        existing.result = msg.content;
        existing.status = "completed";
      }
    }
  }

  return records;
}

function ToolCallCardImpl({ record }: { record: ToolCallRecord }) {
  const [expanded, setExpanded] = useState(false);
  const displayName = getToolDisplayName(record.name);
  const humanSummary = getToolHumanSummary({
    name: record.name,
    arguments: record.arguments,
    id: record.id,
  } as ToolCall);
  const hasArgs = record.arguments && Object.keys(record.arguments).length > 0;
  const hasResult = record.result !== undefined && record.result !== null;

  const statusIcon =
    record.status === "running"
      ? "🔄"
      : record.status === "completed"
        ? "✅"
        : "❌";
  const statusColor =
    record.status === "running"
      ? "border-l-blue-500"
      : record.status === "completed"
        ? "border-l-green-500"
        : "border-l-red-500";

  const handleCopy = () => {
    let text: string;
    if (record._hasFullResult) {
      const full = getToolResultFull(record.id);
      text = typeof full === "string" ? full : JSON.stringify(full, null, 2);
    } else {
      text =
        typeof record.result === "string"
          ? record.result
          : JSON.stringify(record.result, null, 2);
    }
    navigator.clipboard.writeText(text).catch(() => {});
  };

  /** 从 result 中提取错误信息 */
  const errorText = extractError(record);

  return (
    <div
      className={`p-2.5 rounded bg-gray-50 dark:bg-gray-800 border-l-2 ${statusColor} text-xs`}
    >
      {/* 标题行：图标 + 工具名 + 状态 */}
      <div className="flex items-center gap-1.5 mb-1">
        <span>{statusIcon}</span>
        <span className="font-medium text-gray-700 dark:text-gray-300 truncate">
          {displayName}
        </span>
        {record.status === "running" && (
          <span className="ml-auto text-blue-500 animate-pulse shrink-0">
            进行中
          </span>
        )}
      </div>

      {/* 人话摘要 */}
      {humanSummary && (
        <p className="text-gray-500 dark:text-gray-400 mb-1 line-clamp-2">
          {humanSummary}
        </p>
      )}

      {/* 参数（始终可展开，摘要与参数并不互斥） */}
      {hasArgs && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-gray-400 dark:text-gray-500 mb-1 hover:text-gray-600 dark:hover:text-gray-300 transition-colors text-left"
        >
          {expanded
            ? "收起参数 ▲"
            : `展开参数 (${Object.keys(record.arguments).length} 项) ▼`}
        </button>
      )}
      {expanded && hasArgs && (
        <pre className="text-gray-400 dark:text-gray-500 mb-1 text-[10px] overflow-auto max-h-32 bg-gray-100 dark:bg-gray-900 rounded p-1.5">
          {JSON.stringify(record.arguments, null, 2)}
        </pre>
      )}

      {/* 结果摘要 */}
      {record.status === "completed" && hasResult && (
        <div>
          <p className="text-gray-600 dark:text-gray-400 mb-1 line-clamp-3 break-all">
            {summarizeResult(record.result)}
          </p>
          {record._hasFullResult && (
            <span className="text-blue-400 text-[10px]">
              （结果已截断，点击复制获取完整内容）
            </span>
          )}
        </div>
      )}
      {/* 兜底：完成但无结果时给出说明，避免卡片空白只剩"复制"按钮 */}
      {record.status === "completed" && !hasResult && (
        <p className="text-gray-400 dark:text-gray-500 mb-1">
          该工具已执行完成（无文本结果）
        </p>
      )}

      {/* 错误信息 */}
      {errorText && (
        <p className="text-red-500 dark:text-red-400 mb-1 line-clamp-3">
          {errorText}
        </p>
      )}

      {/* 操作按钮 */}
      <div className="flex gap-1 mt-1">
        {record.status === "completed" && hasResult && (
          <button
            onClick={handleCopy}
            className="px-2 py-0.5 rounded text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            title="复制结果"
          >
            复制
          </button>
        )}
        {record.status === "failed" && (
          <button
            className="px-2 py-0.5 rounded text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
            title="重试该工具调用"
          >
            重试
          </button>
        )}
      </div>
    </div>
  );
}
const ToolCallCard = React.memo(ToolCallCardImpl);

/** 从 result 中提取错误信息 */
function extractError(record: ToolCallRecord): string | null {
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

/** 结果人性化摘要：结构化 {success, data} 取 data 主体，避免整段 JSON 刷屏 */
function summarizeResult(result: unknown): string {
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

function ToolsTab() {
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const toolCalls = useMemo(() => extractToolCalls(messages), [messages]);

  const running = toolCalls.filter((t) => t.status === "running");
  const completed = toolCalls.filter((t) => t.status === "completed");
  const failed = toolCalls.filter((t) => t.status === "failed");

  if (toolCalls.length === 0) {
    return (
      <div>
        {/* 面板说明 */}
        <div className="px-3 pt-3 pb-2">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            AI 工具调用记录
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
            这里展示 AI
            在回答过程中实际调用的工具（读取/写入文件、执行命令、网络搜索、生成内容等），
            按进行中 / 已完成 / 失败分组，可查看每次调用的参数与结果。
          </p>
        </div>
        <div className="px-3 pb-3">
          <div className="text-center py-8 text-sm text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 rounded">
            <p>AI 尚未调用工具</p>
            <p className="text-xs mt-1">
              {isStreaming
                ? "AI 正在生成回复..."
                : "AI 在需要时会自动调用工具，调用记录会实时出现在这里"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* 面板说明 */}
      <div className="px-3 pt-3 pb-2">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
          AI 工具调用记录
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
          展示 AI 在回答过程中实际调用的工具，按进行中 / 已完成 / 失败分组，
          点击「展开参数」可查看调用细节。
        </p>
      </div>
      <div className="px-3 pb-3 space-y-4">
        {running.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-blue-500 uppercase tracking-wider">
              进行中 ({running.length})
            </h4>
            <div className="space-y-1.5">
              {running.map((tc) => (
                <ToolCallCard key={tc.id} record={tc} />
              ))}
            </div>
          </div>
        )}
        {completed.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              已完成 ({completed.length})
            </h4>
            <div className="space-y-1.5">
              {completed.map((tc) => (
                <ToolCallCard key={tc.id} record={tc} />
              ))}
            </div>
          </div>
        )}
        {failed.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-red-500 uppercase tracking-wider">
              失败 ({failed.length})
            </h4>
            <div className="space-y-1.5">
              {failed.map((tc) => (
                <ToolCallCard key={tc.id} record={tc} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default React.memo(ToolsTab);
