import { useState } from "react";
import type { DiffData } from "../../types";
import { createLogger } from "@/utils/logger";

const logger = createLogger("components:diffBlock");

interface DiffBlockProps {
  data: DiffData;
  collapsible?: boolean;
}

/**
 * 解析 diff 结果中的单个行，返回行类型和样式
 */
function parseDiffLine(line: string): { type: "add" | "del" | "header" | "normal"; content: string } {
  if (line.startsWith("@@")) {
    return { type: "header", content: line };
  }
  if (line.startsWith("+")) {
    return { type: "add", content: line };
  }
  if (line.startsWith("-")) {
    return { type: "del", content: line };
  }
  return { type: "normal", content: line };
}

const LINE_STYLES: Record<string, string> = {
  add:    "bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-300",
  del:    "bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-300",
  header: "bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300 font-medium",
  normal: "text-gray-700 dark:text-gray-300",
};

const LINE_PREFIX: Record<string, string> = {
  add:    "+",
  del:    "-",
  header: " ",
  normal: " ",
};

/**
 * 格式化 diff 内容为可复制文本（不带行号和样式前缀）
 */
function formatRawDiff(lines: string[]): string {
  return lines
    .map((line) => {
      const { type, content } = parseDiffLine(line);
      // header 行保留原始内容（包含 @@），其余行去掉前缀字符
      if (type === "header") return content;
      if (type === "add" || type === "del") return content;
      return content;
    })
    .join("\n");
}

/**
 * Diff 预览组件
 * 内嵌 diff 预览，支持展开/折叠、行号显示、语法高亮、应用/拒绝操作
 */
export default function DiffBlock({ data, collapsible = true }: DiffBlockProps) {
  const { file, diff, stats } = data;
  const [isExpanded, setIsExpanded] = useState(!collapsible);
  const [applying, setApplying] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [copied, setCopied] = useState(false);

  const lines = diff.split("\n");

  /** 接受 diff：复制 diff 内容到剪贴板 */
  const handleApply = async () => {
    setApplying(true);
    try {
      const rawDiffText = formatRawDiff(lines);
      const formatted = `文件：${file}\n\n\`\`\`diff\n${rawDiffText}\n\`\`\``;
      await navigator.clipboard.writeText(formatted);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      logger.error("复制失败", err);
    } finally {
      setApplying(false);
    }
  };

  /** 拒绝 diff：折叠当前 diff 块 */
  const handleReject = () => {
    setRejected(true);
  };

  // 已拒绝：显示占位提示
  if (rejected) {
    return (
      <div className="my-2 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 overflow-hidden shadow-sm opacity-60">
        <div className="px-3 py-2 flex items-center justify-between">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-sm flex-shrink-0">{"\u{1F4C4}"}</span>
            <span className="text-sm font-mono text-gray-500 dark:text-gray-400 line-through truncate">
              {file}
            </span>
          </div>
          <span className="text-xs text-gray-400 dark:text-gray-500">已拒绝</span>
        </div>
      </div>
    );
  }

  return (
    <div className="my-2 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 overflow-hidden shadow-sm">
      {/* 标题栏 */}
      <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm flex-shrink-0">{"\u{1F4C4}"}</span>
          <span className="text-sm font-mono font-semibold text-gray-900 dark:text-gray-100 truncate">
            {file}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
          {stats && (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              <span className="text-green-600 dark:text-green-400">+{stats.additions}</span>
              {" / "}
              <span className="text-red-600 dark:text-red-400">-{stats.deletions}</span>
            </span>
          )}
          {collapsible && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
            >
              {isExpanded ? "\u25B2 收起" : "\u25BC 展开"}
            </button>
          )}
        </div>
      </div>

      {/* diff 内容 */}
      {isExpanded && (
        <div className="overflow-x-auto">
          <pre className="text-xs font-mono leading-relaxed p-2 m-0">
            {lines.map((line, idx) => {
              const { type, content } = parseDiffLine(line);
              return (
                <div
                  key={idx}
                  className={`px-2 py-0.5 ${LINE_STYLES[type] || LINE_STYLES.normal}`}
                >
                  <span className="select-none inline-block w-8 text-right mr-3 text-gray-400 dark:text-gray-600">
                    {idx + 1}
                  </span>
                  <span className="inline-block w-4 text-center mr-1">
                    {LINE_PREFIX[type]}
                  </span>
                  {content}
                </div>
              );
            })}
          </pre>
        </div>
      )}

      {/* 操作栏：接受 / 拒绝 */}
      <div className="px-3 py-1.5 border-t border-gray-100 dark:border-gray-700 flex items-center gap-2">
        <button
          onClick={handleApply}
          disabled={applying || copied}
          className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
            copied
              ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300"
              : "bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/40"
          } disabled:opacity-70`}
        >
          {copied ? "\u2713 已复制" : applying ? "复制中..." : "\u2713 接受"}
        </button>
        <button
          onClick={handleReject}
          className="px-3 py-1 text-xs font-medium rounded-md bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
        >
          {"\u2717 拒绝"}
        </button>
        <span className="text-[10px] text-gray-400 dark:text-gray-500 ml-1">
          接受将复制 diff 到剪贴板，可粘贴到编辑器中应用
        </span>
      </div>
    </div>
  );
}
