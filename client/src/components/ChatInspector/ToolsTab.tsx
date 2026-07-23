/**
 * 工具 Tab — 工具调用列表（进行中/完成/失败）+ 详情 + 重试
 */

import React from "react";
import { useMemo } from "react";
import { useChatStore } from "../../stores/chat";

interface ToolCallRecord {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  status: "running" | "completed" | "failed";
  messageId?: string;
  error?: string;
}

function extractToolCalls(messages: ReturnType<typeof useChatStore.getState>["messages"]): ToolCallRecord[] {
  const seen = new Set<string>();
  const records: ToolCallRecord[] = [];

  for (const msg of messages) {
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        if (seen.has(tc.id)) continue;
        seen.add(tc.id);
        records.push({
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments || {},
          result: tc.result,
          status: tc.status || "completed",
          messageId: msg.id,
        });
      }
    }
    if (msg.blocks) {
      for (const block of msg.blocks) {
        if (block.type === "tool_call" && block.toolCall) {
          const tc = block.toolCall;
          if (seen.has(tc.id)) continue;
          seen.add(tc.id);
          records.push({
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments || {},
            result: tc.result,
            status: tc.status || (block.isStreaming ? "running" : "completed"),
            messageId: msg.id,
          });
        }
      }
    }
    if (msg.role === "tool" && msg.toolCallId) {
      const existing = records.find((r) => r.id === msg.toolCallId);
      if (existing) {
        existing.result = msg.content;
        existing.status = "completed";
      }
    }
  }

  return records;
}

function ToolCallCardImpl({ record }: { record: ToolCallRecord }) {
  const statusIcon =
    record.status === "running" ? "🔄" : record.status === "completed" ? "✅" : "❌";
  const statusColor =
    record.status === "running"
      ? "border-l-blue-500"
      : record.status === "completed"
        ? "border-l-green-500"
        : "border-l-red-500";

  const handleCopy = () => {
    const text =
      typeof record.result === "string"
        ? record.result
        : JSON.stringify(record.result, null, 2);
    navigator.clipboard.writeText(text).catch(() => {});
  };

  return (
    <div className={`p-2.5 rounded bg-gray-50 dark:bg-gray-800 border-l-2 ${statusColor} text-xs`}>
      <div className="flex items-center gap-1.5 mb-1">
        <span>{statusIcon}</span>
        <span className="font-medium text-gray-700 dark:text-gray-300 truncate">{record.name}</span>
        {record.status === "running" && (
          <span className="ml-auto text-blue-500 animate-pulse">进行中</span>
        )}
      </div>
      {record.arguments && Object.keys(record.arguments).length > 0 && (
        <p className="text-gray-400 dark:text-gray-500 mb-1 truncate">
          {JSON.stringify(record.arguments).slice(0, 80)}
        </p>
      )}
      {record.status === "completed" && record.result !== undefined && (
        <p className="text-gray-600 dark:text-gray-400 mb-1.5 truncate">
          {typeof record.result === "string"
            ? record.result.slice(0, 100)
            : JSON.stringify(record.result).slice(0, 100)}
        </p>
      )}
      {record.status === "failed" && record.error && (
        <p className="text-red-500 dark:text-red-400 mb-1.5 truncate">{record.error.slice(0, 100)}</p>
      )}
      <div className="flex gap-1 mt-1">
        {record.status === "completed" && (
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

function ToolsTab() {
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const toolCalls = useMemo(() => extractToolCalls(messages), [messages]);

  const running = toolCalls.filter((t) => t.status === "running");
  const completed = toolCalls.filter((t) => t.status === "completed");
  const failed = toolCalls.filter((t) => t.status === "failed");

  if (toolCalls.length === 0) {
    return (
      <div className="p-3">
        <div className="text-center py-8 text-sm text-gray-500 dark:text-gray-400">
          <p>尚未调用工具</p>
          <p className="text-xs mt-1">
            {isStreaming ? "AI 正在生成回复..." : "AI 在需要时会自动调用工具"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 space-y-4">
      {running.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-blue-500 uppercase tracking-wider">
            进行中 ({running.length})
          </h4>
          <div className="space-y-1.5">
            {running.map((tc) => <ToolCallCard key={tc.id} record={tc} />)}
          </div>
        </div>
      )}
      {completed.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            已完成 ({completed.length})
          </h4>
          <div className="space-y-1.5">
            {completed.map((tc) => <ToolCallCard key={tc.id} record={tc} />)}
          </div>
        </div>
      )}
      {failed.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-red-500 uppercase tracking-wider">
            失败 ({failed.length})
          </h4>
          <div className="space-y-1.5">
            {failed.map((tc) => <ToolCallCard key={tc.id} record={tc} />)}
          </div>
        </div>
      )}
    </div>
  );
}

export default React.memo(ToolsTab);
