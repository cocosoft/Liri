/**
 * ToolResultGroup —— 连续「孤儿工具结果」的折叠树
 *
 * 2026-11-24（真机 `session_mwr473pd502e995dd1`）：
 * 无事件日志的存量会话里，assistant 的 `tool_calls` 往往不完整，后续
 * `role=tool` 结果找不到调用定义。原实现把它们逐条渲染成「工具返回」气泡
 * （一屏 22 个，每个都铺满整段结果）。`setMessages` 现在把**连续**的这类结果
 * 合并成一条消息（`metadata.groupedToolResults`），由本组件折叠成树：
 * 组头一行 → 每行一条结果 → 点击展开该条结果正文。
 *
 * 单条结果仍由 `ToolResultMessage` 渲染（零行为变化）。
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GroupedToolResult } from "../../types";
import MarkdownRenderer from "./MarkdownRenderer";
import { useChatStore } from "../../stores/chat";
import { decodeToolResultContent } from "../../utils/toolResultText";

/** 首行摘要（用于折叠态的一行预览） */
function firstLine(text: string, maxLen = 70): string {
  const line =
    text
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? "";
  return line.length > maxLen ? `${line.slice(0, maxLen)}…` : line;
}

interface ToolResultGroupProps {
  results: GroupedToolResult[];
}

function ToolResultGroup({ results }: ToolResultGroupProps) {
  const { t } = useTranslation();
  const readFileToPreview = useChatStore((s) => s.readFileToPreview);
  const [collapsed, setCollapsed] = useState(true);
  /** 当前展开正文的结果 id（同时只展开一条，避免树被撑爆） */
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // 解码只做一次（信封 JSON → 可读文本），展开时直接用
  const items = useMemo(
    () =>
      results.map((r) => {
        const decoded = decodeToolResultContent(r.content).trim() || "—";
        return { ...r, decoded };
      }),
    [results],
  );

  const interceptedCount = items.filter((i) => i.securityIntercepted).length;

  return (
    <div className="border border-gray-400/20 rounded-[10px] overflow-hidden mb-1">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
        className="flex items-center gap-1.5 px-2.5 py-1 bg-gray-400/[0.05] w-full cursor-pointer text-gray-600 dark:text-gray-300 text-[12px] text-left"
      >
        <span className="text-sm shrink-0 flex items-center">📦</span>
        <span className="font-semibold text-gray-800 dark:text-gray-200 shrink overflow-hidden text-ellipsis whitespace-nowrap min-w-0">
          {t("chat.toolReturnGroup", {
            count: items.length,
            defaultValue: "工具返回 · {{count}} 次",
          })}
          {interceptedCount > 0 && (
            <span className="font-normal text-xs text-orange-500 dark:text-orange-400 ml-1">
              ⚠️ {interceptedCount}
            </span>
          )}
        </span>
        {items.length === 1 && items[0].toolCallId && (
          <span className="shrink-0 text-[10px] text-gray-400 dark:text-gray-500">
            #{items[0].toolCallId.slice(-8)}
          </span>
        )}
        <span className="ml-auto shrink-0 text-[10px]">
          {collapsed ? "\u25B6" : "\u25BC"}
        </span>
      </button>

      {!collapsed && (
        <div className="border-t border-gray-400/[0.1] px-2 py-1.5">
          {items.length === 1 ? (
            // 单条：展开组头即见正文（少一层点击，避免"为一条结果套两级折叠"）
            <div className="max-h-[320px] overflow-y-auto rounded bg-gray-50 dark:bg-gray-900/50 p-2 border border-gray-200 dark:border-gray-700">
              <MarkdownRenderer
                content={items[0].decoded}
                onPreviewFile={readFileToPreview}
              />
            </div>
          ) : (
            <>
              <div className="mb-1 flex items-center justify-between px-1 text-[10px] text-gray-500 dark:text-gray-400">
                <span>
                  {t("chat.toolReturnGroupHint", {
                    count: items.length,
                    defaultValue: "共 {{count}} 条 · 点击任一行展开结果",
                  })}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                {items.map((item, idx) => {
                  const isExpanded = expandedId === item.id;
                  const isLast = idx === items.length - 1;
                  const railColor = item.isError
                    ? "bg-red-400"
                    : "bg-gray-300 dark:bg-gray-600";
                  return (
                    <div key={item.id} className="flex gap-1.5">
                      <div className="flex flex-col items-center w-3 shrink-0 pt-1">
                        <div
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${railColor}`}
                        />
                        <div
                          className={`w-px flex-1 min-h-[10px] ${railColor} ${isLast ? "opacity-30" : "opacity-70"}`}
                        />
                      </div>
                      <div className="flex-1 min-w-0 pb-0.5">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedId((prev) =>
                              prev === item.id ? null : item.id,
                            )
                          }
                          aria-expanded={isExpanded}
                          className="flex w-full items-center gap-1 text-left text-[11px] leading-relaxed text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-200"
                        >
                          <span className="shrink-0 font-medium">
                            {t("chat.toolReturn", "工具返回")}
                          </span>
                          {item.toolCallId && (
                            <span className="shrink-0 text-gray-400 dark:text-gray-500">
                              #{item.toolCallId.slice(-8)}
                            </span>
                          )}
                          {item.securityIntercepted && (
                            <span className="shrink-0 text-orange-500 dark:text-orange-400">
                              ⚠️
                            </span>
                          )}
                          <span className="min-w-0 flex-1 truncate text-gray-400 dark:text-gray-500">
                            {firstLine(item.decoded)}
                          </span>
                          <span className="ml-auto shrink-0 text-[9px] opacity-60">
                            {isExpanded ? "▲" : "▼"}
                          </span>
                        </button>
                        {isExpanded && (
                          <div className="mt-0.5 mb-1 max-h-[320px] overflow-y-auto rounded bg-gray-50 dark:bg-gray-900/50 p-2 border border-gray-200 dark:border-gray-700">
                            <MarkdownRenderer
                              content={item.decoded}
                              onPreviewFile={readFileToPreview}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default ToolResultGroup;
