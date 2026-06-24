/**
 * AgentProgressBlock — 单 Agent 进度面板
 *
 * 展示单个 Agent 的执行过程：
 * - Thinking 状态（逐 token 流式呈现）
 * - Tool Call 状态（调用参数 + 结果）
 * - 完成 / 失败状态
 * - 执行计时
 */

import { useState, useEffect, useRef } from "react";

// ========== 类型定义 ==========

/** Tool Call 状态 */
interface ToolCallState {
  toolName: string;
  args: Record<string, unknown>;
  result?: string;
  startTime: number;
  endTime?: number;
  status: "running" | "completed" | "failed";
}

/** Agent 执行状态 */
type AgentExecStatus = "idle" | "thinking" | "tool_call" | "completed" | "failed";

/** AgentProgressBlock 属性 */
interface AgentProgressBlockProps {
  /** Agent ID */
  agentId: string;
  /** Agent 名称 */
  agentName: string;
  /** 当前执行状态 */
  status: AgentExecStatus;
  /** Thinking 内容（已在外部拼接的完整文本） */
  thinkingContent?: string;
  /** 流式 delta（逐段追加） */
  delta?: string;
  /** 当前执行的 Tool Call */
  currentToolCall?: ToolCallState;
  /** Tool Call 历史 */
  toolCallHistory?: ToolCallState[];
  /** 最终输出内容 */
  output?: string;
  /** 错误信息 */
  error?: string;
  /** 执行耗时（ms） */
  durationMs?: number;
  /** 进度百分比（0-100） */
  progress?: number;
  /** 深色模式 */
  isDark: boolean;
}

// ========== 状态配色 ==========

const STATUS_CONFIG: Record<AgentExecStatus, { label: string; dot: string; bg: string }> = {
  idle: { label: "等待中", dot: "bg-gray-400", bg: "bg-gray-50 dark:bg-gray-800" },
  thinking: { label: "思考中", dot: "bg-blue-500", bg: "bg-blue-50 dark:bg-blue-900/20" },
  tool_call: { label: "调用工具", dot: "bg-yellow-500", bg: "bg-yellow-50 dark:bg-yellow-900/20" },
  completed: { label: "已完成", dot: "bg-green-500", bg: "bg-green-50 dark:bg-green-900/20" },
  failed: { label: "已失败", dot: "bg-red-500", bg: "bg-red-50 dark:bg-red-900/20" },
};

/**
 * AgentProgressBlock 组件
 */
function AgentProgressBlock({
  agentId,
  agentName,
  status,
  thinkingContent,
  delta,
  currentToolCall,
  toolCallHistory,
  output,
  error,
  durationMs,
  progress,
  isDark,
}: AgentProgressBlockProps) {
  // 流式文本拼接
  const [displayedText, setDisplayedText] = useState(thinkingContent || "");
  const prevDelta = useRef("");

  // delta 追加：当新的 delta 到达时追加到 displayedText
  useEffect(() => {
    if (delta && delta !== prevDelta.current) {
      // 如果 delta 比上次的长，说明是追加内容
      if (delta.startsWith(prevDelta.current)) {
        setDisplayedText(delta);
      } else {
        // 全新的 delta 流，覆盖
        setDisplayedText(delta);
      }
      prevDelta.current = delta;
    }
  }, [delta]);

  // 外部 thinkingContent 变化时同步
  useEffect(() => {
    if (thinkingContent !== undefined) {
      setDisplayedText(thinkingContent);
    }
  }, [thinkingContent]);

  // 计时器
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (status === "thinking" || status === "tool_call") {
      const start = Date.now();
      const timer = setInterval(() => {
        setElapsed(Date.now() - start);
      }, 100);
      return () => clearInterval(timer);
    } else if (durationMs !== undefined) {
      setElapsed(durationMs);
    }
    return;
  }, [status, durationMs]);

  const config = STATUS_CONFIG[status];
  const progressValue = progress ?? (status === "completed" ? 100 : status === "thinking" ? 50 : 0);

  return (
    <div
      className={`rounded-lg border p-3 ${
        isDark ? "border-gray-700" : "border-gray-200"
      } ${config.bg}`}
      data-agent-id={agentId}
    >
      {/* 头部：Agent 名称 + 状态 */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${config.dot} animate-pulse`} />
          <span className="text-sm font-medium">{agentName}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded ${
            isDark ? "bg-gray-700 text-gray-300" : "bg-gray-100 text-gray-600"
          }`}>
            {config.label}
          </span>
        </div>
        <span className="text-xs text-gray-500">
          {elapsed > 0 ? `${(elapsed / 1000).toFixed(1)}s` : ""}
        </span>
      </div>

      {/* 进度条 */}
      {(status === "thinking" || status === "tool_call" || status === "completed") && (
        <div className="mb-2">
          <div className={`w-full h-1 rounded-full ${isDark ? "bg-gray-700" : "bg-gray-200"}`}>
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                status === "completed" ? "bg-green-500" : "bg-blue-500"
              }`}
              style={{ width: `${progressValue}%` }}
            />
          </div>
        </div>
      )}

      {/* Thinking 内容 */}
      {status === "thinking" && displayedText && (
        <div className={`mb-2 p-2 rounded text-sm whitespace-pre-wrap ${
          isDark ? "bg-gray-800 text-gray-300" : "bg-white text-gray-700"
        }`}>
          <span className="text-xs text-blue-500 mb-1 block">思考过程</span>
          {displayedText}
          <span className="inline-block w-1 h-4 bg-blue-500 ml-0.5 animate-pulse" />
        </div>
      )}

      {/* Tool Call */}
      {currentToolCall && (
        <div className={`mb-2 p-2 rounded text-sm ${
          isDark ? "bg-gray-800 text-gray-300" : "bg-white text-gray-700"
        }`}>
          <span className="text-xs text-yellow-600 mb-1 block">
            🔧 {currentToolCall.toolName}
          </span>
          <pre className="text-xs overflow-x-auto">
            {JSON.stringify(currentToolCall.args, null, 2)}
          </pre>
          {currentToolCall.result && (
            <>
              <span className="text-xs text-green-600 mt-1 block">结果</span>
              <pre className="text-xs overflow-x-auto">
                {currentToolCall.result.slice(0, 500)}
                {currentToolCall.result.length > 500 ? "..." : ""}
              </pre>
            </>
          )}
        </div>
      )}

      {/* Tool Call 历史 */}
      {toolCallHistory && toolCallHistory.length > 0 && (
        <details className="mb-1">
          <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700">
            Tool Call 历史（{toolCallHistory.length}）
          </summary>
          <div className="mt-1 space-y-1">
            {toolCallHistory.map((tc, i) => (
              <div key={i} className={`text-xs p-1 rounded ${
                isDark ? "bg-gray-800" : "bg-gray-50"
              }`}>
                <span className="font-medium">{tc.toolName}</span> —{" "}
                {tc.status === "completed" ? "✅" : tc.status === "failed" ? "❌" : "⏳"}
                {tc.endTime !== undefined && ` (${((tc.endTime - tc.startTime) / 1000).toFixed(1)}s)`}
              </div>
            ))}
          </div>
        </details>
      )}

      {/* 输出内容 */}
      {output && (
        <div className={`text-sm whitespace-pre-wrap ${
          isDark ? "text-gray-300" : "text-gray-700"
        }`}>
          <span className="text-xs text-green-600 mb-1 block">输出</span>
          {output.slice(0, 300)}
          {output.length > 300 ? "..." : ""}
        </div>
      )}

      {/* 错误信息 */}
      {error && (
        <div className="mt-1 text-sm text-red-500 bg-red-50 dark:bg-red-900/20 p-2 rounded">
          {error}
        </div>
      )}
    </div>
  );
}

export default AgentProgressBlock;
export type { AgentExecStatus, ToolCallState, AgentProgressBlockProps };
