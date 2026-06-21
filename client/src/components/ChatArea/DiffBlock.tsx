import { useState } from "react";
import type { DiffData } from "../../types";

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
 * Diff 预览组件
 * 内嵌 diff 预览，支持展开/折叠、行号显示、语法高亮
 */
export default function DiffBlock({ data, collapsible = true }: DiffBlockProps) {
  const { file, diff, stats } = data;
  const [isExpanded, setIsExpanded] = useState(!collapsible);

  const lines = diff.split("\n");

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
    </div>
  );
}