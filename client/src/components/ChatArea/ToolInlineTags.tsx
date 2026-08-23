/**
 * ToolInlineTags — 普通工具调用的行内小标签（P2）
 *
 * 会话日志改造的一部分：ChatArea 中普通工具从「边框卡片」降级为行内小标签，
 * 轻量不抢眼；详细过程（参数/结果/思考）统一到右侧「会话日志」面板查看。
 * 审批等待 / 多媒体展示 / 安全拦截 / question 块仍走各自专用渲染，不经此组件。
 *
 * 增强（2026-08-21）：点击小标签可就地展开该工具的完整详情（复用 ToolExecutionGroup），
 * 避免用户必须切到右侧轨迹面板才能看 args/result。
 */

import { useState } from "react";
import type { MessageBlock } from "../../types";
import {
  getToolDisplayName,
  getToolHumanSummary,
} from "../../utils/toolHumanSummary";
import ToolExecutionGroup from "./ToolExecutionGroup";

interface ToolInlineTagsProps {
  blocks: MessageBlock[];
}

function ToolInlineTags({ blocks }: ToolInlineTagsProps) {
  const toolCalls = blocks.filter((b) => b.type === "tool_call" && b.toolCall);
  const statusBlocks = blocks.filter((b) => b.type === "status");
  // 当前展开的工具 block id（同一时间只展开一个，避免气泡被工具卡片撑爆）
  const [expandedBlockId, setExpandedBlockId] = useState<string | null>(null);

  const toggleExpand = (blockId: string): void => {
    setExpandedBlockId((prev) => (prev === blockId ? null : blockId));
  };

  return (
    <div className="flex flex-col gap-1 my-0.5">
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
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
          const isExpanded = expandedBlockId === b.id;

          return (
            <button
              type="button"
              key={b.id}
              title={isExpanded ? "点击收起详情" : (argsText ?? "点击查看详情")}
              onClick={() => toggleExpand(b.id)}
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] leading-none border cursor-pointer transition-colors ${
                isFailed
                  ? "bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-500 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/60"
                  : isExpanded
                    ? "bg-blue-50 dark:bg-blue-950/40 border-blue-300 dark:border-blue-700 text-blue-600 dark:text-blue-400"
                    : "bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
              }`}
            >
              <span>{icon}</span>
              <span className="font-medium whitespace-nowrap">
                {displayName}
              </span>
              {summary && (
                <span className="opacity-75 truncate max-w-[160px]">
                  {summary}
                </span>
              )}
              {isRunning && (
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              )}
              <span className="opacity-50 text-[9px]">
                {isExpanded ? "▲" : "▼"}
              </span>
            </button>
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
      {/* 展开面板：只渲染当前展开的那个工具的完整 ToolExecutionGroup（单 block） */}
      {expandedBlockId &&
        (() => {
          const target = toolCalls.find((b) => b.id === expandedBlockId);
          if (!target) return null;
          return (
            <div className="ml-1 border-l-2 border-blue-200 dark:border-blue-800 pl-2">
              <ToolExecutionGroup blocks={[target]} />
            </div>
          );
        })()}
    </div>
  );
}

export default ToolInlineTags;
