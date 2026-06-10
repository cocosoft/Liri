import React, { useState, useRef, useEffect, useMemo } from "react";
import type { MessageBlock, TaskCardData, TaskCardTask } from "../../types";
import ToolCallBlock from "./ToolCallBlock";
import MarkdownRenderer from "./MarkdownRenderer";
import TaskCard from "./TaskCard";
import { useChatStore } from "../../stores/chatStore";

interface ToolExecutionGroupProps {
  blocks: MessageBlock[];
  isStreaming?: boolean;
}

function ToolExecutionGroup({ blocks, isStreaming }: ToolExecutionGroupProps) {
  const [collapsed, setCollapsed] = useState(!isStreaming);
  const [innerCollapsed, setInnerCollapsed] = useState(true);
  const prevStreaming = useRef(isStreaming);
  const hasStreamEnded = useRef(!isStreaming);
  const { readFileToPreview } = useChatStore();

  useEffect(() => {
    const wasStreaming = prevStreaming.current;
    prevStreaming.current = isStreaming;

    if (wasStreaming && !isStreaming) {
      setCollapsed(true);
      setInnerCollapsed(true);
      hasStreamEnded.current = true;
    }
  }, [isStreaming]);

  const toolName = useMemo(() => {
    for (const block of blocks) {
      if (block.type === "tool_call" && block.toolCall?.name) {
        const nameMap: Record<string, string> = {
          "web-search": "🌐 网络搜索",
          "web-fetch": "📄 网页获取",
          search: "🔍 搜索",
          fetch: "📥 获取",
          execute: "⚡ 执行",
          run: "🚀 运行",
          bash: "💻 终端命令",
          shell: "🐚 Shell命令",
          read: "📖 读取",
          write: "💾 写入",
          delete: "🗑️ 删除",
          create: "✨ 创建",
          update: "🔄 更新",
          list: "📋 列出",
          query: "❓ 查询",
          build_index: "🔧 构建索引",
          search_knowledge: "📚 搜索知识库",
          glob: "📁 文件搜索",
          grep: "🔎 文本搜索",
        };
        return nameMap[block.toolCall.name] || block.toolCall.name;
      }
    }
    return "🔧 工具执行";
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
          block.content.includes("✅")
        ) {
          return "completed";
        }
        if (block.content.includes("失败") || block.content.includes("❌")) {
          return "failed";
        }
        if (block.content.includes("Running")) {
          return "running";
        }
      }
    }

    return isStreaming ? "running" : "completed";
  }, [blocks, isStreaming]);

  const statusConfig = useMemo(() => {
    if (isStreaming) {
      return { icon: "⏳", label: "执行中", color: "#e6c384" };
    }
    switch (status) {
      case "completed":
        return { icon: "✅", label: "完成", color: "#9ece6a" };
      case "failed":
        return { icon: "❌", label: "失败", color: "#f7768e" };
      default:
        return { icon: "🔧", label: status, color: "#7aa2f7" };
    }
  }, [status, isStreaming]);

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

  /** 检测是否为 todo_write 工具调用 */
  const taskCardData = useMemo((): TaskCardData | null => {
    for (const block of blocks) {
      if (
        block.type === "tool_call" &&
        block.toolCall?.name === "todo_write" &&
        block.toolCall?.status === "completed"
      ) {
        const args = block.toolCall.arguments as Record<string, unknown> | undefined;
        if (args?.action === "write" && args?.todos) {
          const todos = args.todos as Array<{
            id?: string; name?: string; status?: string;
            dependsOn?: string[]; activeForm?: string; metadata?: Record<string, unknown>;
          }>;
          if (Array.isArray(todos) && todos.length > 0) {
            const tasks: TaskCardTask[] = todos.map((t, i) => ({
              id: t.id || String(i + 1),
              name: t.name || `步骤 ${i + 1}`,
              status: (t.status as TaskCardTask["status"]) || "pending",
              dependsOn:
                t.dependsOn ||
                (t.metadata as Record<string, unknown> | undefined)?.dependsOn as string[] ||
                [],
            }));
            const title =
              (args?.title as string) ||
              (typeof args?.description === "string" ? args.description : "") ||
              `任务 (${todos.length} 步)`;
            return { title, tasks, status: "planning" };
          }
        }
      }
    }
    return null;
  }, [blocks]);

  /** 过滤冗余状态块：连续相似的 tool 状态只显示最后一条 */
  const filteredBlocks = useMemo(() => {
    return blocks.filter((block, idx) => {
      // 保留非 status 块
      if (block.type !== "status") return true;

      // 保留第一条 status
      if (idx === 0) return true;

      const prev = blocks[idx - 1];
      // 如果上一条也是 status 且都包含相同的工具名，只保留后一条
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

  if (taskCardData) {
    return <TaskCard data={taskCardData} />;
  }

  return (
    <div style={styles.container}>
      <button
        onClick={() => setCollapsed(!collapsed)}
        style={styles.header}
      >
        {/* 状态图标 */}
        <span style={styles.statusIcon}>
          {isStreaming ? (
            <span style={styles.pulsingDot} />
          ) : (
            statusConfig.icon
          )}
        </span>

        {/* 工具名称 + 参数摘要 */}
        <span style={styles.title}>
          {toolName}
          {summaryText && (
            <span style={styles.titleArgs}> — {summaryText}</span>
          )}
        </span>

        {/* 错误信息 */}
        {status === "failed" && errorMessage && (
          <span style={styles.errorMsg}>{errorMessage}</span>
        )}

        {/* 状态徽章 */}
        <span
          style={{
            ...styles.badge,
            background: statusConfig.color,
            opacity: isStreaming ? 0.8 : 1,
          }}
        >
          {isStreaming ? (
            <span>{statusConfig.label}…</span>
          ) : (
            statusConfig.label
          )}
        </span>

        {/* 展开/折叠箭头 */}
        <span style={styles.toggle}>{collapsed ? "▶" : "▼"}</span>
      </button>

      {!collapsed && (
        <div style={styles.body}>
          {innerCollapsed ? (
            <button
              onClick={() => setInnerCollapsed(false)}
              style={styles.expandBtn}
            >
              📋 点击展开详情 ({blocks.length} 项)
            </button>
          ) : (
            <div style={styles.blocks}>
              {filteredBlocks.map((block) => (
                <BlockItem
                  key={block.id}
                  block={block}
                  isStreaming={isStreaming}
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
  const isCompleted = content.includes("completed") || content.includes("✅");

  return (
    <div style={groupStatusStyles.line}>
      <span style={groupStatusStyles.dot}>
        {isRunning ? (
          <span style={groupStatusStyles.pulse} />
        ) : isCompleted ? (
          "✓"
        ) : (
          "·"
        )}
      </span>
      <span
        style={{
          ...groupStatusStyles.text,
          color: isRunning ? "#e6c384" : isCompleted ? "#9ece6a" : "#7aa2f7",
          fontStyle: isRunning ? "italic" : "normal",
        }}
      >
        {content}
        {isStreaming && <span style={groupStatusStyles.cursor}>|</span>}
      </span>
    </div>
  );
}

const groupStatusStyles: Record<string, React.CSSProperties> = {
  line: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "2px 4px",
    fontSize: "12px",
  },
  dot: {
    fontSize: "11px",
    flexShrink: 0,
    width: "14px",
    textAlign: "center" as const,
  },
  pulse: {
    display: "inline-block",
    width: "6px",
    height: "6px",
    borderRadius: "50%",
    background: "#e6c384",
    animation: "pulse 1.5s ease-in-out infinite",
  },
  text: {
    flex: 1,
    textAlign: "left" as const,
    fontFamily: "inherit",
  },
  cursor: {
    animation: "blink 1s step-end infinite",
    marginLeft: "2px",
  },
};

function BlockItem({
  block,
  isStreaming,
  onPreviewFile,
}: {
  block: MessageBlock;
  isStreaming?: boolean;
  onPreviewFile?: (path: string) => void;
}) {
  const sessionFiles = useChatStore((s) => s.sessionFiles);
  const knownFilePaths = sessionFiles.map((f) => f.path);

  switch (block.type) {
    case "status":
      return (
        <GroupStatusLine
          content={block.content}
          isStreaming={block.isStreaming || isStreaming}
        />
      );
    case "tool_call":
      return block.toolCall ? (
        <ToolCallBlock
          toolCall={block.toolCall}
          isStreaming={block.isStreaming || isStreaming}
        />
      ) : null;
    case "text":
    default:
      return (
        <MarkdownRenderer
          content={block.content}
          isStreaming={block.isStreaming || isStreaming}
          onPreviewFile={onPreviewFile}
          knownFilePaths={knownFilePaths}
        />
      );
  }
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    border: "1px solid rgba(122, 162, 247, 0.3)",
    borderRadius: "10px",
    overflow: "hidden",
    marginBottom: "8px",
    background: "rgba(122, 162, 247, 0.03)",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "10px 14px",
    background: "rgba(122, 162, 247, 0.08)",
    border: "none",
    width: "100%",
    cursor: "pointer",
    color: "#a9b1d6",
    fontSize: "13px",
    textAlign: "left",
    fontFamily: "inherit",
  },
  statusIcon: {
    fontSize: "14px",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
  },
  pulsingDot: {
    display: "inline-block",
    width: "10px",
    height: "10px",
    borderRadius: "50%",
    background: "#e6c384",
    animation: "pulse 1.5s ease-in-out infinite",
  },
  title: {
    fontWeight: 600,
    color: "#e0e0e0",
    flexShrink: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0,
  },
  titleArgs: {
    fontWeight: 400,
    fontSize: "12px",
    color: "#565f89",
  },
  errorMsg: {
    fontSize: "11px",
    color: "#f7768e",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: "200px",
    flexShrink: 1,
  },
  badge: {
    fontSize: "11px",
    padding: "2px 10px",
    borderRadius: "10px",
    color: "#1a1b26",
    fontWeight: 600,
    flexShrink: 0,
  },
  toggle: {
    fontSize: "10px",
    flexShrink: 0,
  },
  body: {
    borderTop: "1px solid rgba(122, 162, 247, 0.12)",
  },
  expandBtn: {
    display: "block",
    width: "100%",
    padding: "8px 14px",
    background: "transparent",
    border: "none",
    color: "#7aa2f7",
    fontSize: "12px",
    cursor: "pointer",
    textAlign: "left",
    fontFamily: "inherit",
  },
  blocks: {
    padding: "8px 12px",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
};

export default ToolExecutionGroup;
