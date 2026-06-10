import React, { useState, useRef, useEffect } from "react";
import type { ToolCall } from "../../types";
import MarkdownRenderer from "./MarkdownRenderer";
import { useChatStore } from "../../stores/chatStore";

interface ToolCallBlockProps {
  toolCall: ToolCall;
  isStreaming?: boolean;
}

/**
 * 将下划线命名转换为更易读的格式
 */
function formatKey(key: string): string {
  const keyMap: Record<string, string> = {
    url: "链接",
    query: "查询词",
    maxResults: "最大结果数",
    maxContentLength: "最大内容长度",
    timeout: "超时时间",
    retries: "重试次数",
    category: "分类",
    keywords: "关键词",
    date: "日期",
    startDate: "开始日期",
    endDate: "结束日期",
    limit: "限制数量",
    offset: "偏移量",
    page: "页码",
    pageSize: "每页数量",
    sortBy: "排序方式",
    filter: "过滤器",
    type: "类型",
    name: "名称",
    description: "描述",
    enabled: "启用",
    disabled: "禁用",
    async: "异步",
    recursive: "递归",
    verbose: "详细模式",
    force: "强制执行",
    dryRun: "试运行",
    output: "输出",
    input: "输入",
    path: "路径",
    file: "文件",
    directory: "目录",
    filename: "文件名",
    extension: "扩展名",
    mode: "模式",
    format: "格式",
    encoding: "编码",
    language: "语言",
    locale: "地区",
    timezone: "时区",
    currency: "货币",
    amount: "数量",
    price: "价格",
    title: "标题",
    content: "内容",
    body: "正文",
    message: "消息",
    text: "文本",
    html: "HTML内容",
    markdown: "Markdown内容",
    schema: "结构定义",
    options: "选项",
    params: "参数",
    args: "参数",
    arguments: "参数",
    callback: "回调函数",
    handler: "处理器",
    fn: "函数",
    endpoint: "接口地址",
    headers: "请求头",
    bodyType: "body类型",
    status: "状态",
    statusCode: "状态码",
    code: "代码",
    error: "错误",
    data: "数据",
    result: "结果",
    success: "成功",
    failure: "失败",
    count: "数量",
    total: "总计",
    hasMore: "还有更多",
    nextPage: "下一页",
    prevPage: "上一页",
    id: "ID",
    ids: "ID列表",
    uuid: "UUID",
    token: "令牌",
    secret: "密钥",
    key: "键",
    value: "值",
    env: "环境变量",
    version: "版本",
    tag: "标签",
    tags: "标签列表",
    author: "作者",
    createdAt: "创建时间",
    updatedAt: "更新时间",
    deletedAt: "删除时间",
    expiresAt: "过期时间",
    retryCount: "重试次数",
    attempt: "尝试次数",
  };

  if (keyMap[key]) {
    return keyMap[key];
  }

  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase())
    .trim();
}

/**
 * 格式化值，根据类型返回更友好的展示
 */
function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined) {
    return "无";
  }

  if (typeof value === "boolean") {
    return value ? "是" : "否";
  }

  if (typeof value === "number") {
    if (
      key.toLowerCase().includes("time") ||
      key.toLowerCase().includes("duration")
    ) {
      if (value < 1000) return `${value} 毫秒`;
      if (value < 60000) return `${(value / 1000).toFixed(1)} 秒`;
      return `${(value / 60000).toFixed(1)} 分钟`;
    }
    if (
      key.toLowerCase().includes("length") ||
      key.toLowerCase().includes("size")
    ) {
      if (value < 1024) return `${value} 字符`;
      if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
      return `${(value / 1024 / 1024).toFixed(1)} MB`;
    }
    if (
      key.toLowerCase().includes("count") ||
      key.toLowerCase().includes("limit")
    ) {
      return `${value}`;
    }
    return `${value}`;
  }

  if (typeof value === "string") {
    if (key === "url" || key === "link" || key === "href") {
      try {
        const url = new URL(value);
        return url.hostname + (url.pathname !== "/" ? url.pathname : "");
      } catch {
        return value.length > 60 ? value.substring(0, 60) + "..." : value;
      }
    }
    if (value.length > 200) {
      return value.substring(0, 200) + "...";
    }
    return value;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return "（空列表）";
    if (value.length <= 3) {
      return value.map((v, i) => `${i + 1}. ${formatValue(key, v)}`).join("\n");
    }
    return `共 ${value.length} 项：\n${value
      .slice(0, 3)
      .map((v, i) => `${i + 1}. ${formatValue(key, v)}`)
      .join("\n")}\n...`;
  }

  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }

  return String(value);
}

/**
 * 以自然语言格式展示参数
 * 文件路径类参数渲染为可点击预览链接
 */
function formatArgumentsNatural(
  args: Record<string, unknown>,
  onPreviewFile?: (path: string) => void,
): React.ReactNode[] {
  const entries = Object.entries(args);
  if (entries.length === 0) return [];

  return entries.map(([key, value]) => {
    const label = formatKey(key);
    const formattedValue = formatValue(key, value);
    const isFilePathKey =
      key === "file_path" || key === "path" || key === "filePath";

    return (
      <div key={key} style={styles.argLine}>
        <span style={styles.argLabel}>{label}:</span>
        {isFilePathKey && onPreviewFile && typeof value === "string" ? (
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              onPreviewFile(value);
            }}
            style={{
              ...styles.argValue,
              color: "#7aa2f7",
              textDecoration: "underline",
              cursor: "pointer",
            }}
          >
            {formattedValue}
          </a>
        ) : (
          <span style={styles.argValue}>{formattedValue}</span>
        )}
      </div>
    );
  });
}

function ToolCallBlock({ toolCall, isStreaming }: ToolCallBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const prevStreaming = useRef(isStreaming);
  const { readFileToPreview } = useChatStore();
  const sessionFiles = useChatStore((s) => s.sessionFiles);
  const knownFilePaths = sessionFiles.map((f) => f.path);

  useEffect(() => {
    const wasStreaming = prevStreaming.current;
    prevStreaming.current = isStreaming;

    if (wasStreaming && !isStreaming) {
      setExpanded(false);
    }
  }, [isStreaming]);

  const statusIcon = isStreaming
    ? "⏳"
    : toolCall.status === "completed"
      ? "✅"
      : toolCall.status === "failed"
        ? "❌"
        : "🔧";

  const statusColor = isStreaming
    ? "#e6c384"
    : toolCall.status === "completed"
      ? "#9ece6a"
      : toolCall.status === "failed"
        ? "#f7768e"
        : "#7aa2f7";

  const toolNameMap: Record<string, string> = {
    "web-search": "网络搜索",
    "web-fetch": "网页获取",
    search: "搜索",
    fetch: "获取",
    execute: "执行",
    run: "运行",
    bash: "终端命令",
    shell: "Shell命令",
    read: "读取",
    write: "写入",
    delete: "删除",
    create: "创建",
    update: "更新",
    list: "列出",
    query: "查询",
    build_index: "构建索引",
    search_knowledge: "搜索知识库",
  };

  const displayName = toolNameMap[toolCall.name] || toolCall.name;

  // 生成折叠态参数摘要
  const argSummary = React.useMemo(() => {
    const args = toolCall.arguments as Record<string, unknown> | undefined;
    if (!args || Object.keys(args).length === 0) return "";
    const parts: string[] = [];
    for (const [key, value] of Object.entries(args)) {
      if (parts.join(", ").length > 30) break;
      const v = typeof value === "string" ? value : JSON.stringify(value);
      parts.push(`${key}=${v.length > 15 ? v.slice(0, 15) + "…" : v}`);
    }
    return parts.join(", ");
  }, [toolCall.arguments]);

  return (
    <div style={styles.container}>
      <button onClick={() => setExpanded(!expanded)} style={styles.header}>
        <span>{statusIcon}</span>
        <span style={styles.name}>{displayName}</span>
        {argSummary && (
          <span style={styles.summary}>{argSummary}</span>
        )}
        <span style={{ ...styles.badge, background: statusColor }}>
          {isStreaming ? "running" : toolCall.status || "completed"}
        </span>
        <span style={styles.toggle}>{expanded ? "▼" : "▶"}</span>
      </button>
      {expanded && (
        <div style={styles.body}>
          {toolCall.arguments && Object.keys(toolCall.arguments).length > 0 && (
            <div style={styles.section}>
              <div style={styles.sectionTitle}>参数:</div>
              <div style={styles.argsContainer}>
                {formatArgumentsNatural(
                  toolCall.arguments as Record<string, unknown>,
                  readFileToPreview,
                )}
              </div>
            </div>
          )}
          {toolCall.result !== undefined && (
            <div style={styles.section}>
              <div style={styles.sectionTitle}>结果:</div>
              {typeof toolCall.result === "string" ? (
                <MarkdownRenderer
                  content={toolCall.result}
                  onPreviewFile={readFileToPreview}
                  knownFilePaths={knownFilePaths}
                />
              ) : (
                <pre style={styles.pre}>
                  {JSON.stringify(toolCall.result, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    border: "1px solid rgba(122, 162, 247, 0.25)",
    borderRadius: "8px",
    overflow: "hidden",
    marginBottom: "8px",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "6px 12px",
    background: "rgba(122, 162, 247, 0.06)",
    border: "none",
    width: "100%",
    cursor: "pointer",
    color: "#a9b1d6",
    fontSize: "13px",
    textAlign: "left",
    fontFamily: "inherit",
  },
  name: {
    flex: 1,
    fontWeight: 500,
    color: "#e0e0e0",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0,
  },
  summary: {
    color: "#565f89",
    fontSize: "11px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: "200px",
    flexShrink: 1,
  },
  badge: {
    fontSize: "11px",
    padding: "2px 8px",
    borderRadius: "10px",
    color: "#1a1b26",
    fontWeight: 600,
  },
  toggle: {
    fontSize: "10px",
    flexShrink: 0,
  },
  body: {
    padding: "8px 12px",
    borderTop: "1px solid rgba(122, 162, 247, 0.12)",
  },
  section: {
    marginBottom: "8px",
  },
  sectionTitle: {
    fontSize: "11px",
    fontWeight: 600,
    color: "#565f89",
    marginBottom: "4px",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  },
  pre: {
    margin: 0,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    fontSize: "12px",
    lineHeight: "1.5",
    color: "#a9b1d6",
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    background: "rgba(0,0,0,0.15)",
    padding: "8px",
    borderRadius: "4px",
    maxHeight: "200px",
    overflowY: "auto",
  },
  argsContainer: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  argLine: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
    alignItems: "baseline",
    fontSize: "12px",
    lineHeight: "1.4",
  },
  argLabel: {
    color: "#7aa2f7",
    fontWeight: 500,
    flexShrink: 0,
  },
  argValue: {
    color: "#e0e0e0",
    wordBreak: "break-word",
    whiteSpace: "pre-wrap",
  },
};

export default ToolCallBlock;
