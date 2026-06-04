import React, { useState, useRef, useEffect } from "react";
import type { MessageBlock, TaskCardData, TaskCardTask } from "../../types";
import StatusBlock from "./StatusBlock";
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

  const toolName = React.useMemo(() => {
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

  const status = React.useMemo(() => {
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

  const statusIcon = isStreaming
    ? "⏳"
    : status === "completed"
      ? "✅"
      : status === "failed"
        ? "❌"
        : "🔧";

  const statusColor = isStreaming
    ? "#e6c384"
    : status === "completed"
      ? "#9ece6a"
      : status === "failed"
        ? "#f7768e"
        : "#7aa2f7";

  const summaryText = React.useMemo(() => {
    for (const block of blocks) {
      if (block.type === "tool_call" && block.toolCall?.arguments) {
        const args = block.toolCall.arguments;
        const entries = Object.entries(args);
        if (entries.length > 0) {
          const preview = entries
            .slice(0, 2)
            .map(([k, v]) => {
              const keyLabel: Record<string, string> = {
                url: "链接",
                query: "查询",
                pattern: "模式",
                command: "命令",
                path: "路径",
                keywords: "关键词",
              };
              const label = keyLabel[k] || k;
              const value =
                typeof v === "string"
                  ? v.length > 30
                    ? v.substring(0, 30) + "..."
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

  /** 检测是否为 todo_write 工具调用，若是则提取 TaskCard 数据 */
  const taskCardData = React.useMemo((): TaskCardData | null => {
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

  if (taskCardData) {
    return <TaskCard data={taskCardData} />;
  }

  return (
    <div style={styles.container}>
      <button onClick={() => setCollapsed(!collapsed)} style={styles.header}>
        <span>{statusIcon}</span>
        <span style={styles.title}>{toolName}</span>
        {summaryText && (
          <span style={styles.summary}>
            {collapsed ? `📋 ${summaryText}` : ""}
          </span>
        )}
        <span style={{ ...styles.badge, background: statusColor }}>
          {hasStreamEnded.current
            ? "completed"
            : isStreaming && status === "running"
              ? "running"
              : status}
        </span>
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
              {blocks.map((block) => (
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
        <StatusBlock
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
  title: {
    fontWeight: 600,
    color: "#e0e0e0",
    flexShrink: 0,
  },
  summary: {
    flex: 1,
    fontSize: "12px",
    color: "#565f89",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  badge: {
    fontSize: "11px",
    padding: "2px 8px",
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
