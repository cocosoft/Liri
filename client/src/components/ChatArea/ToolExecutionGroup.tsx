import { useState, useRef, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { MessageBlock } from "../../types";
import ToolCallGroup from "./ToolCallGroup";
import MarkdownRenderer from "./MarkdownRenderer";
import { useChatStore } from "../../stores/chat";
import {
  getToolDisplayName,
  getToolHumanSummary,
  resolveGroupStatus,
} from "../../utils/toolHumanSummary";
import GroupStatusLine from "./GroupStatusLine";
// 2026-11-17：`resolvedApprovalInboxIds` —— 审批已落定（已处理/已过期）的调用不再计入「等待审批」
import {
  getToolResultFull,
  resolvedApprovalInboxIds,
} from "../../stores/chat/chat-message-shared";
import { createLogger } from "@/utils/logger";

const logger = createLogger("components:toolExecutionGroup");

interface ToolExecutionGroupProps {
  blocks: MessageBlock[];
}

function ToolExecutionGroup({ blocks }: ToolExecutionGroupProps) {
  const { t } = useTranslation();
  // P0-5 修复：精准 selector 订阅，避免每个 chunk 触发工具卡片重渲染
  const readFileToPreview = useChatStore((s) => s.readFileToPreview);
  /** 2026-11-17：已处理/已过期审批的 inboxId（按数组引用缓存，全组只算一次） */
  const messages = useChatStore((s) => s.messages);
  const resolvedApprovalIds = resolvedApprovalInboxIds(messages);
  /** 该工具调用是否仍**有效等待审批**（残留标记 + 已落定卡 ⇒ false） */
  const isUnresolvedPending = useMemo(
    () =>
      (block: MessageBlock): boolean => {
        const tc = block.toolCall;
        if (tc?.pendingApproval !== true) return false;
        const inboxId = tc.inboxId;
        if (typeof inboxId === "string" && resolvedApprovalIds.has(inboxId)) {
          return false;
        }
        return true;
      },
    [resolvedApprovalIds],
  );

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
  const prevStreaming = useRef(false);

  useEffect(() => {
    const wasStreaming = prevStreaming.current;
    prevStreaming.current = isGroupStreaming;

    if (wasStreaming && !isGroupStreaming) {
      setCollapsed(true);
    }
  }, [isGroupStreaming]);

  const toolName = useMemo(() => {
    for (const block of blocks) {
      if (block.type === "tool_call" && block.toolCall?.name) {
        return getToolDisplayName(block.toolCall.name);
      }
    }
    return t("chat.toolExecution");
  }, [blocks, t]);

  /**
   * 2026-11-24：组内是否存在**没有任何终态**的调用（既非 completed/failed，
   * 也非 running / 待审批）—— 典型是「审批卡已处理/已过期，但后端未再写工具结果」
   * 的残留调用。原实现把这种组当成 completed（✅），聚合行却写成「0/2 执行中」，
   * 组头自相矛盾；这里显式识别，按「已中断」如实展示。
   */
  const hasUnfinishedCalls = useMemo(
    () =>
      blocks.some((b) => {
        if (b.type !== "tool_call" || !b.toolCall) return false;
        if (isUnresolvedPending(b)) return false;
        const status = b.toolCall.status;
        return (
          status !== "completed" &&
          status !== "failed" &&
          status !== "running" &&
          !b.isStreaming
        );
      }),
    [blocks, isUnresolvedPending],
  );

  const status = useMemo(() => {
    // #29（2026-10-30）：全组聚合（原实现取第一块 ⇒ 已完成组仍显示执行中/待审批）
    const raw = resolveGroupStatus(blocks);
    // 2026-11-17：组内「等待审批」全部已落定（卡已处理/已过期）⇒ 不再把整组标成待审批
    if (
      raw === "pending_approval" &&
      !blocks.some((b) => isUnresolvedPending(b))
    ) {
      return hasUnfinishedCalls ? "interrupted" : "executing";
    }
    if (raw === "completed" && hasUnfinishedCalls) return "interrupted";
    return raw;
  }, [blocks, isUnresolvedPending, hasUnfinishedCalls]);

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
      case "interrupted":
        // 2026-11-24：审批已落定但调用没有终态结果 ⇒ 不再谎报「已完成 / 执行中」
        return {
          icon: "\u{23F8}",
          label: t("chat.interrupted", "已中断"),
          color: "#e6c384",
        };
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

  /**
   * 从失败的工具调用中提取错误信息。
   *
   * T-⑥04（2026-10-02）：原实现只读 `block.toolCall.result`，但历史加载路径
   * 刻意不把结果内联进 block（`chat-message-set-messages.ts` 只写入 LRU 缓存，
   * 见 `ToolCall._hasFullResult` 注释），导致回放会话里失败工具卡只剩
   * "状态图标 + 工具名"（导出件中的 `❌ 文件搜索`）。改为按既有契约逐级取数：
   * ① 结构化 `ToolCall.error` → ② block 内联 result → ③ 结果缓存。
   */
  const errorMessage = useMemo(() => {
    for (const block of blocks) {
      if (block.type !== "tool_call" || !block.toolCall) continue;
      const toolCall = block.toolCall;
      if (toolCall.status !== "failed") continue;

      if (toolCall.error) {
        return toolCall.error.slice(0, 100);
      }

      const result = toolCall.result;
      if (
        result &&
        typeof result === "object" &&
        "error" in (result as Record<string, unknown>)
      ) {
        const err = (result as Record<string, unknown>).error;
        return String(err).slice(0, 100);
      }
      if (typeof result === "string" && result) {
        return result.slice(0, 100);
      }

      const cached = getToolResultFull(toolCall.id);
      if (cached) {
        return cached.slice(0, 100);
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
      {
        total: number;
        completed: number;
        running: number;
        failed: number;
        pending: number;
      }
    >();
    for (const b of toolCalls) {
      const name = b.toolCall?.name || "unknown";
      if (!groups.has(name)) {
        groups.set(name, {
          total: 0,
          completed: 0,
          running: 0,
          failed: 0,
          pending: 0,
        });
      }
      const stat = groups.get(name)!;
      stat.total++;
      // 2026-11-13：待审批不是完成 —— 否则组头写「已执行 N 个工具调用 · N/N」，
      // 用户在审批暂停期间读成"跑完了"。
      // 2026-11-17：审批已落定（已处理/已过期）的调用不再计入待审批。
      if (isUnresolvedPending(b)) stat.pending++;
      else if (b.toolCall?.status === "completed") stat.completed++;
      else if (b.toolCall?.status === "running" || b.isStreaming)
        stat.running++;
      else if (b.toolCall?.status === "failed") stat.failed++;
    }

    // 汇总总调用数与失败数（不局限于单一工具类型）
    let total = 0;
    let completed = 0;
    let running = 0;
    let failed = 0;
    let pending = 0;
    for (const stat of groups.values()) {
      total += stat.total;
      completed += stat.completed;
      running += stat.running;
      failed += stat.failed;
      pending += stat.pending;
    }

    return {
      total,
      completed,
      running,
      failed,
      pending,
      // 2026-11-24：既非完成/失败，也非运行/待审批 ⇒ 这些调用其实没有终态
      // （审批已落定后后端未再写结果），不能计入完成率，也不能谎报"执行中"
      interrupted: total - completed - failed - running - pending,
      allDone: completed + failed === total && pending === 0,
    };
  }, [blocks, isUnresolvedPending]);

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
        className="flex items-center gap-1.5 px-2.5 py-1 bg-gray-400/[0.05] w-full cursor-pointer text-gray-600 dark:text-[#a9b1d6] text-[12px] text-left"
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
        <span className="font-semibold text-gray-800 dark:text-gray-200 shrink overflow-hidden text-ellipsis whitespace-nowrap min-w-0">
          {aggregateStats ? (
            <>
              {/* 凝练总结话语：如 "✅ 已执行 2 个工具调用" / "2 个工具调用 (1/2)" */}
              {aggregateStats.allDone && !aggregateStats.failed
                ? t("chat.toolCallsExecutedCount", {
                    count: aggregateStats.total,
                    defaultValue: "已执行 {{count}} 个工具调用",
                  })
                : t("chat.toolCallsCount", {
                    count: aggregateStats.total,
                    defaultValue: "{{count}} 个工具调用",
                  })}
              <span className="font-normal text-xs text-gray-400 ml-1">
                {/* #29：补分隔符 —— 原实现直接拼成「118 个工具调用107/118」，两段粘在一起 */}
                {" · "}
                {aggregateStats.completed}/{aggregateStats.total}
                {aggregateStats.failed > 0 && (
                  <span className="text-red-500 dark:text-red-400 ml-1">
                    ({aggregateStats.failed} {t("chat.failed")})
                  </span>
                )}
                {!aggregateStats.allDone && (
                  <span className="text-amber-600 dark:text-amber-400/80 ml-1">
                    {status === "pending_approval" || aggregateStats.pending > 0
                      ? t("chat.pendingApproval")
                      : aggregateStats.running > 0
                        ? t("chat.executing", "执行中")
                        : aggregateStats.interrupted > 0
                          ? t("chat.interrupted", "已中断")
                          : t("chat.executing", "执行中")}
                  </span>
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
          <span className="text-[11px] text-red-500 dark:text-red-400 truncate max-w-[200px] shrink">
            {errorMessage}
          </span>
        )}

        {/* 展开/折叠箭头 */}
        <span className="text-[10px] shrink-0">
          {collapsed ? "\u25B6" : "\u25BC"}
        </span>
      </button>

      {!collapsed && (
        <div className="border-t border-gray-400/[0.1] px-2 py-1.5">
          {/* 2026-11-24：多级树 —— 组（本行）→ 每条工具调用（可逐行展开）→ 参数/结果。
              取消原来的"展开详情"中间层（两个折叠按钮叠在一起，用户要点两次）。 */}
          <div className="mb-1 flex items-center justify-between px-1 text-[10px] text-gray-500 dark:text-gray-400">
            <span>
              {t("chat.toolTreeHint", { count: filteredBlocks.length })}
            </span>
            <span className="hidden sm:inline">
              {t("chat.toolTreeHintAction")}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            {/* 树形缩进导轨：左侧竖线 + 每个节点圆点（运行中/失败按状态着色） */}
            {filteredBlocks.map((block, idx) => {
              // P1-5 修复：孤立 tool_call 结果块（无配对 tool_call 但有 content）
              // 显示为独立结果卡片
              // 注：MessageBlock 无 tool_result 类型，用 content 非空但 toolCall 缺失判断孤立结果
              if (
                block.type === "tool_call" &&
                !block.toolCall &&
                block.content
              ) {
                logger.warn("[P1-5] 孤立 tool_call 结果块（无配对调用）", {
                  blockId: block.id,
                  contentLength: block.content?.length ?? 0,
                });
                return (
                  <div
                    key={block.id}
                    className="border border-amber-400/30 rounded-[8px] p-2 bg-amber-400/[0.05]"
                  >
                    <div className="text-[11px] text-amber-600 dark:text-amber-300 mb-1">
                      ⚠️{" "}
                      {t("chat.orphanToolResult", "孤立工具结果（未配对调用）")}
                    </div>
                    <MarkdownRenderer
                      content={block.content}
                      isStreaming={block.isStreaming}
                      onPreviewFile={readFileToPreview}
                    />
                  </div>
                );
              }

              const isLast = idx === filteredBlocks.length - 1;
              const blockStatus =
                block.type === "tool_call" && block.toolCall?.status
                  ? block.toolCall.status
                  : null;
              const railColor =
                blockStatus === "running"
                  ? "bg-blue-400"
                  : blockStatus === "failed"
                    ? "bg-red-400"
                    : "bg-gray-300 dark:bg-gray-600";

              return (
                <div key={block.id} className="flex gap-1.5">
                  {/* 树形导轨：竖线贯穿到子树底部；末端节点收短 */}
                  <div className="flex flex-col items-center w-3 shrink-0 pt-1">
                    <div
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${railColor} ${blockStatus === "running" ? "animate-pulse" : ""}`}
                    />
                    <div
                      className={`w-px flex-1 min-h-[10px] ${railColor} ${isLast ? "opacity-30" : "opacity-70"}`}
                    />
                  </div>
                  {/* 内容 */}
                  <div className="flex-1 min-w-0 pb-0.5">
                    {block.type === "tool_call" && block.toolCall ? (
                      <ToolCallGroup
                        toolCall={block.toolCall}
                        isStreaming={block.isStreaming}
                        variant="inline"
                      />
                    ) : block.type === "status" ? (
                      <GroupStatusLine
                        content={block.content}
                        isStreaming={block.isStreaming}
                        status={block.status}
                      />
                    ) : (
                      <MarkdownRenderer
                        content={block.content}
                        isStreaming={block.isStreaming}
                        onPreviewFile={readFileToPreview}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default ToolExecutionGroup;
