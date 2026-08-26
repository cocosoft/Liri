import { useState } from "react";
import type { CodeRunBlockData } from "../../types";

interface CodeRunCardProps {
  data: CodeRunBlockData;
}

const STATUS_META: Record<
  CodeRunBlockData["status"],
  { label: string; icon: string; color: string }
> = {
  completed: {
    label: "完成",
    icon: "\u2705",
    color: "text-green-600 dark:text-green-400",
  },
  failed: {
    label: "失败",
    icon: "\u274C",
    color: "text-red-600 dark:text-red-400",
  },
  "compiled-error": {
    label: "编译错误",
    icon: "\u26A0\uFE0F",
    color: "text-amber-600 dark:text-amber-400",
  },
  "security-rejected": {
    label: "安全拒绝",
    icon: "\uD83D\uDD12",
    color: "text-red-600 dark:text-red-400",
  },
  timeout: {
    label: "超时",
    icon: "\u23F0",
    color: "text-amber-600 dark:text-amber-400",
  },
  canceled: { label: "已取消", icon: "\u2716\uFE0F", color: "text-gray-500" },
};

/**
 * Code Mode 执行卡片
 * 展示 code_run 编排执行：代码 / 状态 / 结构化结果 / 内部工具调用摘要 / 日志
 * CM-5 读侧（独立执行块，待确认③按独立块实施）
 */
export default function CodeRunCard({ data }: CodeRunCardProps) {
  const {
    code,
    round,
    status,
    output,
    error,
    structuredError,
    toolCalls,
    logs,
    durationMs,
  } = data;
  const meta = STATUS_META[status] || {
    label: status,
    icon: "\u2753",
    color: "text-gray-500",
  };

  const [showCode, setShowCode] = useState(false);
  const [showLogs, setShowLogs] = useState(false);

  const outputText =
    output !== undefined
      ? typeof output === "string"
        ? output
        : JSON.stringify(output, null, 2)
      : "";
  const errorText =
    error ||
    (structuredError
      ? `${structuredError.type}: ${structuredError.message}`
      : "");

  return (
    <div className="my-2 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 overflow-hidden shadow-sm">
      {/* 标题栏 */}
      <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
        <span className="text-sm flex-shrink-0">{meta.icon}</span>
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
          Code Run #{round}
        </span>
        <span className={`text-xs flex-shrink-0 ${meta.color}`}>
          {meta.label}
        </span>
        {typeof durationMs === "number" && (
          <span className="text-xs text-gray-400 flex-shrink-0 ml-auto">
            {durationMs}ms
          </span>
        )}
      </div>

      {/* 错误信息 */}
      {errorText && (
        <div className="px-3 py-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 font-mono whitespace-pre-wrap break-all">
          {errorText}
          {structuredError?.stack && (
            <details className="mt-1 text-red-400/80">
              <summary className="cursor-pointer">堆栈</summary>
              <pre className="mt-1 whitespace-pre-wrap break-all">
                {structuredError.stack}
              </pre>
            </details>
          )}
        </div>
      )}

      {/* 结构化输出 */}
      {outputText && (
        <div className="px-3 py-2 border-t border-gray-100 dark:border-gray-700">
          <div className="text-xs text-gray-400 mb-1">结果</div>
          <pre className="text-xs text-gray-700 dark:text-gray-300 font-mono whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
            {outputText}
          </pre>
        </div>
      )}

      {/* 内部工具调用摘要 */}
      {toolCalls && toolCalls.length > 0 && (
        <div className="px-3 py-2 border-t border-gray-100 dark:border-gray-700 space-y-1">
          <div className="text-xs text-gray-400 mb-1">
            内部工具调用（{toolCalls.length}）
          </div>
          {toolCalls.map((tc, idx) => (
            <div key={idx} className="flex items-center gap-2 text-xs">
              <span className={tc.ok ? "text-green-500" : "text-red-500"}>
                {tc.ok ? "\u2713" : "\u2717"}
              </span>
              <span className="text-gray-700 dark:text-gray-300 font-mono truncate flex-1">
                {tc.name}
              </span>
              {tc.truncatedResult && (
                <span className="text-gray-400 font-mono truncate max-w-[40%]">
                  {tc.truncatedResult}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 日志 */}
      {logs && logs.length > 0 && (
        <div className="px-3 py-2 border-t border-gray-100 dark:border-gray-700">
          <button
            type="button"
            onClick={() => setShowLogs((v) => !v)}
            className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            {showLogs ? "\u25BC" : "\u25B6"} 日志（{logs.length}）
          </button>
          {showLogs && (
            <pre className="mt-1 text-xs text-gray-500 dark:text-gray-400 font-mono whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
              {logs.join("")}
            </pre>
          )}
        </div>
      )}

      {/* 代码（折叠） */}
      <div className="px-3 py-2 border-t border-gray-100 dark:border-gray-700">
        <button
          type="button"
          onClick={() => setShowCode((v) => !v)}
          className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
        >
          {showCode ? "\u25BC" : "\u25B6"} 编排代码
        </button>
        {showCode && (
          <pre className="mt-1 text-xs text-gray-700 dark:text-gray-300 font-mono whitespace-pre-wrap break-all max-h-48 overflow-y-auto bg-gray-50 dark:bg-gray-900 rounded-lg p-2">
            {code}
          </pre>
        )}
      </div>
    </div>
  );
}
