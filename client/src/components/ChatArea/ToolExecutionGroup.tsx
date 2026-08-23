import { useState, useRef, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { MessageBlock } from "../../types";
import ToolCallGroup from "./ToolCallGroup";
import MarkdownRenderer from "./MarkdownRenderer";
import { useChatStore } from "../../stores/chat";
import {
  getToolDisplayName,
  getToolHumanSummary,
} from "../../utils/toolHumanSummary";
import { useFeatureFlagStore } from "../../stores/featureFlags";
import GroupStatusLine from "./GroupStatusLine";
import BlockItem from "./BlockItem";
import { createLogger } from "@/utils/logger";

const logger = createLogger("components:toolExecutionGroup");

interface ToolExecutionGroupProps {
  blocks: MessageBlock[];
}

function ToolExecutionGroup({ blocks }: ToolExecutionGroupProps) {
  const { t } = useTranslation();
  // P0-5 修复：精准 selector 订阅，避免每个 chunk 触发工具卡片重渲染
  const readFileToPreview = useChatStore((s) => s.readFileToPreview);
  const toolcallFlat = useFeatureFlagStore((s) => s.flags.toolcall_flat);

  /** P0-5 日志：流式状态切换边界（流式中工具卡片渲染频率监控，每 complete→streaming 边沿记录） */
  const isGroupStreaming = useMemo(
    () => blocks.some((b) => b.isStreaming),
    [blocks],
  );
  const prevGroupStreamingRef = useRef(isGroupStreaming);
  useEffect(() => {
    if (prevGroupStreamingRef.current !== isGroupStreaming) {
      prevGroupStreamingRef.current = isGroupStreaming;
      logger.debug("[P0-5:ToolGroup] isStreaming 切换", {
        isGroupStreaming,
        blockCount: blocks.length,
        toolCallCount: blocks.filter((b) => b.type === "tool_call").length,
      });
    }
  }, [isGroupStreaming, blocks]);
  const [collapsed, setCollapsed] = useState(!isGroupStreaming);
  const [innerCollapsed, setInnerCollapsed] = useState(true);
  const prevStreaming = useRef(false);

  useEffect(() => {
    const wasStreaming = prevStreaming.current;
    prevStreaming.current = isGroupStreaming;

    if (wasStreaming && !isGroupStreaming) {
      setCollapsed(true);
      setInnerCollapsed(true);
    }
  }, [isGroupStreaming]);

  const toolName = useMemo(() => {
    for (const block of blocks) {
      if (block.type === "tool_call" && block.toolCall?.name) {
        return getToolDisplayName(block.toolCall.name);
      }
    }
    return t("chat.toolExecution");
  }, [blocks]);

  const status = useMemo(() => {
    // P2-2: 审批等待态优先（结构化标记，非字符串匹配）
    for (const block of blocks) {
      if (block.type === "tool_call" && block.toolCall?.pendingApproval) {
        return "pending_approval";
      }
    }
    // 优先使用 tool_call 块自带的状态字段
    for (const block of blocks) {
      if (block.type === "tool_call" && block.toolCall?.status) {
        return block.toolCall.status;
      }
    }

    // 回退：基于 isStreaming 判断（避免字符串匹配 CS02 违规）
    return blocks.some((b) => b.isStreaming) ? "running" : "completed";
  }, [blocks]);

  const statusConfig = useMemo(() => {
    switch (status) {
      case "completed":
        return {
          icon: "\u{2705}",
          label: t("chat.completed"),
          color: "#9ece6a",
        };
      case "pending_approval":
        return {
          icon: "\u{23F3}",
          label: t("chat.pendingApproval"),
          color: "#e6c384",
        };
      case "failed":
        return { icon: "\u{274C}", label: t("chat.failed"), color: "#f7768e" };
      default:
        return {
          icon: "\u{23F3}",
          label: t("chat.executing"),
          color: "#e6c384",
        };
    }
  }, [status, t]);

  /** 从 tool_call 块提取人话摘要 */
  const summaryText = useMemo(() => {
    for (const block of blocks) {
      if (block.type === "tool_call" && block.toolCall) {
        return getToolHumanSummary(block.toolCall);
      }
    }
    return "";
  }, [blocks]);

  /** 从失败的工具调用中提取错误信息 */
  const errorMessage = useMemo(() => {
    for (const block of blocks) {
      if (
        block.type === "tool_call" &&
        block.toolCall?.status === "failed" &&
        block.toolCall?.result
      ) {
        const result = block.toolCall.result;
        if (
          result &&
          typeof result === "object" &&
          "error" in (result as Record<string, unknown>)
        ) {
          const err = (result as Record<string, unknown>).error;
          return String(err).slice(0, 100);
        }
        if (typeof result === "string") {
          return result.slice(0, 100);
        }
      }
    }
    return null;
  }, [blocks]);

  /** 聚合统计：对同组工具调用进行计数，折叠态展示凝练总结（"已执行 N 个工具调用"） */
  const aggregateStats = useMemo(() => {
    const toolCalls = blocks.filter(
      (b) => b.type === "tool_call" && b.toolCall,
    );
    // 关键修复（2026-08-23）：阈值从 3 降到 2 —— 2 个及以上工具调用
    // 就在折叠态展示"已执行 N 个工具调用"总结，展开才看明细，
    // 避免"执行2个工具调用"标题下堆积一堆工具过程输出（用户反馈视觉混乱）。
    if (toolCalls.length < 2) return null;

    // 按工具名称分组
    const groups = new Map<
      string,
      { total: number; completed: number; running: number; failed: number }
    >();
    for (const b of toolCalls) {
      const name = b.toolCall?.name || "unknown";
      if (!groups.has(name)) {
        groups.set(name, { total: 0, completed: 0, running: 0, failed: 0 });
      }
      const stat = groups.get(name)!;
      stat.total++;
      if (b.toolCall?.status === "completed") stat.completed++;
      else if (b.toolCall?.status === "running" || b.isStreaming)
        stat.running++;
      else if (b.toolCall?.status === "failed") stat.failed++;
    }

    // 汇总总调用数与失败数（不局限于单一工具类型）
    let total = 0;
    let completed = 0;
    let running = 0;
    let failed = 0;
    for (const stat of groups.values()) {
      total += stat.total;
      completed += stat.completed;
      running += stat.running;
      failed += stat.failed;
    }

    return {
      label: `${total} 个工具调用`,
      total,
      completed,
      running,
      failed,
      allDone: completed + failed === total,
    };
  }, [blocks]);

  /** P1-6 修复：status 块按 toolCallId 去重（消除 CS02 正则解析） */
  const filteredBlocks = useMemo(() => {
    return blocks.filter((block, idx) => {
      if (block.type !== "status") return true;
      if (idx === 0) return true;

      const prev = blocks[idx - 1];
      if (prev?.type === "status") {
        // P1-6：优先按 toolCallId 去重（数据模型已有字段）
        const prevToolId = prev.toolCallId;
        const currToolId = block.toolCallId;
        if (prevToolId && currToolId && prevToolId === currToolId) {
          return false;
        }
        // Fallback：无 toolCallId 时仍用正则（标记 TODO: CS05-ROOTFIX）
        if (!prevToolId && !currToolId) {
          const prevTool = prev.content.match(
            /(?:Running tool|Tool) (.+?)(?:\.\.\.| completed)/,
          );
          const currTool = block.content.match(
            /(?:Running tool|Tool) (.+?)(?:\.\.\.| completed)/,
          );
          if (prevTool && currTool && prevTool[1] === currTool[1]) {
            return false;
          }
        }
      }

      return true;
    });
  }, [blocks]);

  return (
    <div className="border border-gray-400/20 rounded-[10px] overflow-hidden mb-1">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-1.5 px-2.5 py-1 bg-gray-400/[0.05] w-full cursor-pointer text-[#a9b1d6] text-[12px] text-left"
      >
        {/* 状态图标 */}
        <span className="text-sm shrink-0 flex items-center">
          {blocks.some((b) => b.isStreaming) ? (
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-300 animate-pulse" />
          ) : (
            statusConfig.icon
          )}
        </span>

        {/* 工具名称 + 参数摘要（聚合态：凝练总结 + 完成数；单工具态：工具名 + 摘要） */}
        <span className="font-semibold text-gray-200 shrink overflow-hidden text-ellipsis whitespace-nowrap min-w-0">
          {aggregateStats ? (
            <>
              {/* 凝练总结话语：如 "✅ 已执行 2 个工具调用" / "2 个工具调用 (1/2)" */}
              {aggregateStats.allDone && !aggregateStats.failed
                ? `已执行 ${aggregateStats.total} 个工具调用`
                : aggregateStats.label}
              <span className="font-normal text-xs text-gray-400 ml-1">
                {aggregateStats.completed}/{aggregateStats.total}
                {aggregateStats.failed > 0 && (
                  <span className="text-red-400 ml-1">
                    ({aggregateStats.failed} {t("chat.failed")})
                  </span>
                )}
                {!aggregateStats.allDone && (
                  <span className="text-amber-400/80 ml-1">执行中</span>
                )}
              </span>
            </>
          ) : (
            <>
              {toolName}
              {summaryText && (
                <span className="font-normal text-xs text-gray-500/60">
                  {" "}
                  — {summaryText}
                </span>
              )}
            </>
          )}
        </span>

        {/* J-2.2: 审批等待态琥珀色徽标（分组折叠态也可见，区别于失败红） */}
        {status === "pending_approval" && (
          <span className="shrink-0 rounded bg-amber-400/20 px-1.5 py-0.5 text-[10px] text-amber-300">
            ⏳ {t("chat.pendingApproval")}
          </span>
        )}

        {/* 错误信息 */}
        {status === "failed" && errorMessage && (
          <span className="text-[11px] text-red-400 truncate max-w-[200px] shrink">
            {errorMessage}
          </span>
        )}

        {/* 展开/折叠箭头 */}
        <span className="text-[10px] shrink-0">
          {collapsed ? "\u25B6" : "\u25BC"}
        </span>
      </button>

      {!collapsed && (
        <div className="border-t border-gray-400/[0.1]">
          {innerCollapsed ? (
            <button
              onClick={() => setInnerCollapsed(false)}
              className="block w-full px-2.5 py-1 bg-transparent text-gray-400 text-xs cursor-pointer text-left"
            >
              📋 {t("chat.expandDetail")} ({blocks.length} 项)
            </button>
          ) : (
            <div className="px-2 py-1 flex flex-col gap-0.5">
              {/* 时间线连接器：在左侧绘制垂直连接线 */}
              {toolcallFlat
                ? // 扁平化模式：ToolCallGroup inline 行内展示，带时间线连接
                  filteredBlocks.map((block, idx) => {
                    const isLast = idx === filteredBlocks.length - 1;
                    const blockStatus =
                      block.type === "tool_call" && block.toolCall?.status
                        ? block.toolCall.status
                        : null;
                    const timelineColor =
                      blockStatus === "running"
                        ? "border-blue-400"
                        : blockStatus === "failed"
                          ? "border-red-400"
                          : "border-gray-300 dark:border-gray-600";

                    return (
                      <div key={block.id} className="flex gap-1.5">
                        {/* 时间线 */}
                        <div className="flex flex-col items-center w-3 shrink-0 pt-1">
                          <div
                            className={`w-2 h-2 rounded-full border-2 ${timelineColor} ${blockStatus === "running" ? "bg-blue-400 animate-pulse" : blockStatus === "failed" ? "bg-red-400" : "bg-gray-300 dark:bg-gray-600"}`}
                          />
                          {!isLast && (
                            <div
                              className={`w-0.5 flex-1 min-h-[12px] ${timelineColor}`}
                            />
                          )}
                        </div>
                        {/* 内容 */}
                        <div className="flex-1 min-w-0">
                          {block.type === "tool_call" && block.toolCall ? (
                            <ToolCallGroup
                              key={block.id}
                              toolCall={block.toolCall}
                              isStreaming={block.isStreaming}
                              variant="inline"
                            />
                          ) : block.type === "status" ? (
                            <GroupStatusLine
                              key={block.id}
                              content={block.content}
                              isStreaming={block.isStreaming}
                              status={block.status}
                            />
                          ) : (
                            <MarkdownRenderer
                              key={block.id}
                              content={block.content}
                              isStreaming={block.isStreaming}
                              onPreviewFile={readFileToPreview}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })
                : // 旧版模式：BlockItem 嵌套卡片
                  filteredBlocks.map((block) => {
                    // P1-5 修复：孤立 tool_call 结果块（无配对 tool_call 但有 content）显示为独立结果卡片
                    // 注：MessageBlock 无 tool_result 类型，用 content 非空但 toolCall 缺失判断孤立结果
                    if (
                      block.type === "tool_call" &&
                      !block.toolCall &&
                      block.content
                    ) {
                      logger.warn(
                        "[P1-5] 孤立 tool_call 结果块（无配对调用）",
                        {
                          blockId: block.id,
                          contentLength: block.content?.length ?? 0,
                        },
                      );
                      return (
                        <div
                          key={block.id}
                          className="border border-amber-400/30 rounded-[8px] p-2 bg-amber-400/[0.05]"
                        >
                          <div className="text-[11px] text-amber-300 mb-1">
                            ⚠️{" "}
                            {t(
                              "chat.orphanToolResult",
                              "孤立工具结果（未配对调用）",
                            )}
                          </div>
                          <MarkdownRenderer
                            content={block.content}
                            isStreaming={block.isStreaming}
                            onPreviewFile={readFileToPreview}
                          />
                        </div>
                      );
                    }
                    return (
                      <BlockItem
                        key={block.id}
                        block={block}
                        onPreviewFile={readFileToPreview}
                      />
                    );
                  })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ToolExecutionGroup;
