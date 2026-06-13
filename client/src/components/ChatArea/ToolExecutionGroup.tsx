import { useState, useRef, useEffect, useMemo } from "react";
import type { MessageBlock } from "../../types";
import ToolCallBlock from "./ToolCallBlock";
import MarkdownRenderer from "./MarkdownRenderer";
import { useChatStore } from "../../stores/chatStore";

interface ToolExecutionGroupProps {
  blocks: MessageBlock[];
}

function ToolExecutionGroup({ blocks }: ToolExecutionGroupProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [innerCollapsed, setInnerCollapsed] = useState(true);
  const prevStreaming = useRef(false);
  const { readFileToPreview } = useChatStore();

  const isGroupStreaming = useMemo(() => blocks.some(b => b.isStreaming), [blocks]);

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
        const nameMap: Record<string, string> = {
          "web-search": "\u{1F310} 网络搜索",
          "web-fetch": "\u{1F4C4} 网页获取",
          search: "\u{1F50D} 搜索",
          fetch: "\u{1F4E5} 获取",
          execute: "\u{26A1} 执行",
          run: "\u{1F680} 运行",
          bash: "\u{1F4BB} 终端命令",
          shell: "\u{1F41A} Shell命令",
          read: "\u{1F4D6} 读取",
          write: "\u{1F4BE} 写入",
          delete: "\u{1F5D1}\u{FE0F} 删除",
          create: "\u{2728} 创建",
          update: "\u{1F504} 更新",
          list: "\u{1F4CB} 列出",
          query: "\u{2753} 查询",
          build_index: "\u{1F527} 构建索引",
          search_knowledge: "\u{1F4DA} 搜索知识库",
          glob: "\u{1F4C1} 文件搜索",
          grep: "\u{1F50E} 文本搜索",
        };
        return nameMap[block.toolCall.name] || block.toolCall.name;
      }
    }
    return "\u{1F527} 工具执行";
  }, [blocks]);

  const status = useMemo(() => {
    for (const block of blocks) {
      if (block.type === "tool_call" && block.toolCall?.status) {
        return block.toolCall.status;
      }
    }

    for (const block of blocks) {
      if (block.type === "status") {
        if (
          block.content.includes("completed") ||
          block.content.includes("\u{2705}")
        ) {
          return "completed";
        }
        if (block.content.includes("失败") || block.content.includes("\u{274C}")) {
          return "failed";
        }
        if (block.content.includes("Running")) {
          return "running";
        }
      }
    }

    return blocks.some(b => b.isStreaming) ? "running" : "completed";
  }, [blocks]);

  const statusConfig = useMemo(() => {
    switch (status) {
      case "completed":
        return { icon: "\u{2705}", label: "完成", color: "#9ece6a" };
      case "failed":
        return { icon: "\u{274C}", label: "失败", color: "#f7768e" };
      default:
        return { icon: "\u{23F3}", label: "执行中", color: "#e6c384" };
    }
  }, [status]);

  /** 从 tool_call 块提取关键参数摘要 */
  const summaryText = useMemo(() => {
    for (const block of blocks) {
      if (block.type === "tool_call" && block.toolCall?.arguments) {
        const args = block.toolCall.arguments as Record<string, unknown>;
        const entries = Object.entries(args);
        if (entries.length > 0) {
          const preview = entries
            .slice(0, 2)
            .map(([k, v]) => {
              const keyLabel: Record<string, string> = {
                file_path: "文件路径",
                url: "链接",
                query: "查询",
                pattern: "模式",
                command: "命令",
                path: "路径",
                keywords: "关键词",
                code: "代码",
                language: "语言",
                content: "内容",
                output: "输出",
              };
              const label = keyLabel[k] || k;
              const value =
                typeof v === "string"
                  ? v.length > 40
                    ? v.substring(0, 40) + "..."
                    : v
                  : String(v);
              return `${label}: ${value}`;
            })
            .join(", ");
          return entries.length > 2
            ? `${preview} 等${entries.length}项`
            : preview;
        }
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
        if (result && typeof result === "object" && "error" in (result as Record<string, unknown>)) {
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

  /** 聚合统计：对连续同类型工具调用进行计数 */
  const aggregateStats = useMemo(() => {
    const toolCalls = blocks.filter(b => b.type === "tool_call" && b.toolCall);
    if (toolCalls.length < 3) return null;

    // 按工具名称分组
    const groups = new Map<string, { total: number; completed: number; running: number; failed: number }>();
    for (const b of toolCalls) {
      const name = b.toolCall?.name || "unknown";
      if (!groups.has(name)) {
        groups.set(name, { total: 0, completed: 0, running: 0, failed: 0 });
      }
      const stat = groups.get(name)!;
      stat.total++;
      if (b.toolCall?.status === "completed") stat.completed++;
      else if (b.toolCall?.status === "running" || b.isStreaming) stat.running++;
      else if (b.toolCall?.status === "failed") stat.failed++;
    }

    // 找到数量最多的工具类型作为主要统计
    let primaryName = "";
    let primaryStat = { total: 0, completed: 0, running: 0, failed: 0 };
    for (const [name, stat] of groups) {
      if (stat.total > primaryStat.total) {
        primaryName = name;
        primaryStat = stat;
      }
    }

    const nameLabel: Record<string, string> = {
      read: "读取文件",
      write: "写入文件",
      grep: "搜索文本",
      glob: "文件搜索",
      "web-fetch": "获取网页",
      "web-search": "搜索网络",
      search: "搜索",
      fetch: "获取",
    };

    return {
      label: nameLabel[primaryName] || primaryName,
      total: primaryStat.total,
      completed: primaryStat.completed,
      running: primaryStat.running,
      failed: primaryStat.failed,
      allDone: primaryStat.completed + primaryStat.failed === primaryStat.total,
    };
  }, [blocks]);

  /** 过滤冗余状态块：连续相似的 tool 状态只显示最后一条 */
  const filteredBlocks = useMemo(() => {
    return blocks.filter((block, idx) => {
      if (block.type !== "status") return true;
      if (idx === 0) return true;

      const prev = blocks[idx - 1];
      if (prev?.type === "status") {
        const prevTool = prev.content.match(/(?:Running tool|Tool) (.+?)(?:\.\.\.| completed)/);
        const currTool = block.content.match(/(?:Running tool|Tool) (.+?)(?:\.\.\.| completed)/);
        if (prevTool && currTool && prevTool[1] === currTool[1]) {
          return false;
        }
      }

      return true;
    });
  }, [blocks]);

  return (
    <div className="border border-gray-400/20 rounded-[10px] overflow-hidden mb-2">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-2 px-3 py-1.5 bg-gray-400/[0.05] w-full cursor-pointer text-[#a9b1d6] text-[12px] text-left"
      >
        {/* 状态图标 */}
        <span className="text-sm shrink-0 flex items-center">
          {blocks.some(b => b.isStreaming) ? (
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-300 animate-pulse" />
          ) : (
            statusConfig.icon
          )}
        </span>

        {/* 工具名称 + 参数摘要 */}
        <span className="font-semibold text-gray-200 shrink overflow-hidden text-ellipsis whitespace-nowrap min-w-0">
          {aggregateStats ? (
            <>
              {aggregateStats.label}
              <span className="font-normal text-xs text-gray-400 ml-1">
                {aggregateStats.completed}/{aggregateStats.total}
                {aggregateStats.failed > 0 && (
                  <span className="text-red-400 ml-1">
                    ({aggregateStats.failed} 失败)
                  </span>
                )}
              </span>
            </>
          ) : (
            <>
              {toolName}
              {summaryText && (
                <span className="font-normal text-xs text-gray-500/60">
                  {" "}— {summaryText}
                </span>
              )}
            </>
          )}
        </span>

        {/* 错误信息 */}
        {status === "failed" && errorMessage && (
          <span className="text-[11px] text-red-400 truncate max-w-[200px] shrink">
            {errorMessage}
          </span>
        )}

        {/* 状态徽章 */}
        <span
          className="text-[11px] px-2.5 py-0.5 rounded-[10px] text-gray-900 font-semibold shrink-0"
          style={{
            background: statusConfig.color,
            opacity: blocks.some(b => b.isStreaming) ? 0.8 : 1,
          }}
        >
          {status === "running" ? (
            <span>{statusConfig.label}…</span>
          ) : (
            statusConfig.label
          )}
        </span>

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
              className="block w-full px-3 py-1.5 bg-transparent text-gray-400 text-xs cursor-pointer text-left"
            >
              📋 点击展开详情 ({blocks.length} 项)
            </button>
          ) : (
            <div className="px-2.5 py-1.5 flex flex-col gap-0.5">
              {filteredBlocks.map((block) => (
                <BlockItem
                  key={block.id}
                  block={block}
                  onPreviewFile={readFileToPreview}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** 组内状态行 — 简洁行内文本，不产生独立卡片边框 */
function GroupStatusLine({
  content,
  isStreaming,
}: {
  content: string;
  isStreaming?: boolean;
}) {
  const isRunning = content.includes("Running");
  const isCompleted = content.includes("completed") || content.includes("\u{2705}");

  const textColor = isRunning
    ? "text-amber-300"
    : isCompleted
      ? "text-green-400"
      : "text-blue-400";

  return (
    <div className="flex items-center gap-1.5 px-1 py-0.5 text-xs">
      <span className="text-[11px] shrink-0 w-3.5 text-center">
        {isRunning ? (
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-300 animate-pulse" />
        ) : isCompleted ? (
          "\u2713"
        ) : (
          "\u00B7"
        )}
      </span>
      <span
        className={`flex-1 text-left ${textColor} ${isRunning ? "italic" : ""}`}
      >
        {content}
        {isStreaming && (
          <span
            className="ml-0.5"
            style={{ animation: "blink 1s step-end infinite" }}
          >
            |
          </span>
        )}
      </span>
    </div>
  );
}

function BlockItem({
  block,
  onPreviewFile,
}: {
  block: MessageBlock;
  onPreviewFile?: (path: string) => void;
}) {
  const sessionFiles = useChatStore((s) => s.sessionFiles);
  const knownFilePaths = sessionFiles.map((f) => f.path);

  switch (block.type) {
    case "status":
      return (
        <GroupStatusLine
          content={block.content}
          isStreaming={block.isStreaming ?? false}
        />
      );
    case "tool_call":
      return block.toolCall ? (
        <ToolCallBlock
          toolCall={block.toolCall}
          isStreaming={block.isStreaming ?? false}
        />
      ) : null;
    case "text":
    default:
      return (
        <MarkdownRenderer
          content={block.content}
          isStreaming={block.isStreaming ?? false}
          onPreviewFile={onPreviewFile}
          knownFilePaths={knownFilePaths}
        />
      );
  }
}

export default ToolExecutionGroup;