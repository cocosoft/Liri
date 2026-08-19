/**
 * ToolInlineTags — 普通工具调用的行内小标签（P2）
 *
 * 会话日志改造的一部分：ChatArea 中普通工具从「边框卡片」降级为行内小标签，
 * 轻量不抢眼；详细过程（参数/结果/思考）统一到右侧「会话日志」面板查看。
 * 审批等待 / 多媒体展示 / 安全拦截 / question 块仍走各自专用渲染，不经此组件。
 */

import type { MessageBlock } from "../../types";
import {
  getToolDisplayName,
  getToolHumanSummary,
} from "../../utils/toolHumanSummary";

interface ToolInlineTagsProps {
  blocks: MessageBlock[];
}

function ToolInlineTags({ blocks }: ToolInlineTagsProps) {
  const toolCalls = blocks.filter((b) => b.type === "tool_call" && b.toolCall);
  const statusBlocks = blocks.filter((b) => b.type === "status");

  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 my-0.5">
      {toolCalls.map((b) => {
        const tc = b.toolCall!;
        const displayName = getToolDisplayName(tc.name);
        const summary = getToolHumanSummary(tc);
        const isRunning = b.isStreaming || tc.status === "running";
        const isFailed = tc.status === "failed";
        const icon = isRunning ? "🔄" : isFailed ? "✗" : "✓";
        const argsText = tc.arguments
          ? JSON.stringify(tc.arguments)
          : undefined;

        return (
          <span
            key={tc.id}
            title={argsText}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] leading-none border ${
              isFailed
                ? "bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-500 dark:text-red-400"
                : "bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400"
            }`}
          >
            <span>{icon}</span>
            <span className="font-medium whitespace-nowrap">{displayName}</span>
            {summary && (
              <span className="opacity-75 truncate max-w-[160px]">
                {summary}
              </span>
            )}
            {isRunning && (
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            )}
          </span>
        );
      })}
      {statusBlocks.map((b) => (
        <span
          key={b.id}
          className="text-[10px] text-gray-400 dark:text-gray-500"
        >
          {b.content}
        </span>
      ))}
    </div>
  );
}

export default ToolInlineTags;
