import type { Memory } from "../../services/memoryService";
import { TYPE_LABELS, TYPE_COLORS } from "./memoryConstants";

const BORDER_COLORS: Record<string, string> = {
  user_identity: "border-l-indigo-500 dark:border-l-indigo-400",
  user_preference: "border-l-blue-500 dark:border-l-blue-400",
  project_context: "border-l-green-500 dark:border-l-green-400",
  knowledge: "border-l-yellow-500 dark:border-l-yellow-400",
  system_instruction: "border-l-gray-500 dark:border-l-gray-400",
};

interface MemoryListProps {
  memories: Memory[];
  isDark: boolean;
  onSelect: (memory: Memory) => void;
  selectedId?: string | null;
  onDelete: (id: string) => void;
  onEdit: (memory: Memory) => void;
  // 新增
  selectedIds?: Set<string>;
  isBatchMode?: boolean;
  onToggleSelect?: (id: string) => void;
  onTogglePin?: (id: string) => void;
  onTagClick?: (tag: string) => void;
}

function MemoryList({
  memories,
  isDark,
  onSelect,
  selectedId,
  onDelete,
  onEdit,
  selectedIds,
  isBatchMode,
  onToggleSelect,
  onTogglePin,
  onTagClick,
}: MemoryListProps) {
  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getWeightColor = (weight: number) => {
    if (weight >= 80) return "text-green-500";
    if (weight >= 50) return "text-yellow-500";
    return "text-red-500";
  };

  const getDreamSourceBadge = (memory: Memory) => {
    const dreamSource = memory.metadata?.dreamSource as
      { type: string; ids: string[]; dreamCycleId: string } | undefined;
    const dreamRefined = memory.metadata?.dreamRefined as boolean | undefined;

    if (!dreamSource) return null;

    let label: string;
    let colorClass: string;

    if (dreamSource.type === "knowledge_file") {
      label = "知识提炼";
      colorClass =
        "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300";
    } else if (dreamSource.type === "manual") {
      label = "手动创建";
      colorClass =
        "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400";
    } else if (dreamSource.type === "conversation") {
      if (dreamRefined) {
        label = "梦境精炼";
        colorClass =
          "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300";
      } else {
        label = "对话记忆";
        colorClass =
          "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300";
      }
    } else {
      return null;
    }

    return (
      <span
        className={`px-1.5 py-0.5 rounded text-xs font-medium ${colorClass}`}
      >
        {label}
      </span>
    );
  };

  if (memories.length === 0) {
    return (
      <div
        className={`text-center py-12 ${isDark ? "text-gray-400" : "text-gray-500"}`}
      >
        <svg
          className="w-16 h-16 mx-auto mb-4 opacity-30"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1}
            d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
          />
        </svg>
        <p className="text-base font-medium mb-2">暂无记忆</p>
        <p className="text-sm max-w-md mx-auto leading-relaxed">
          系统会在对话中自动提取并保存重要的上下文、偏好和知识。
          <br />
          点击上方「+ 创建记忆」手动添加，或继续对话让 AI 自动记录。
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {memories.map((memory) => {
        const isPinned = (memory.metadata?.isPinned as boolean) || false;

        return (
          <div
            key={memory.id}
            className={`group relative p-4 rounded-lg border transition-colors border-l-4 ${BORDER_COLORS[memory.type] || "border-l-gray-400"} ${
              isBatchMode && selectedIds?.has(memory.id)
                ? isDark
                  ? "bg-blue-900/30 border-blue-600"
                  : "bg-blue-50 border-blue-500"
                : selectedId === memory.id && !isBatchMode
                  ? isDark
                    ? "bg-blue-900/30 border-blue-500"
                    : "bg-blue-50 border-blue-500"
                  : isDark
                    ? "bg-gray-800 border-gray-700 hover:bg-gray-700"
                    : "bg-white border-gray-200 hover:bg-gray-50"
            }`}
          >
            <div
              onClick={() => {
                if (isBatchMode) {
                  onToggleSelect?.(memory.id);
                } else {
                  onSelect(memory);
                }
              }}
              className="cursor-pointer"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  {/* 批量选择 Checkbox */}
                  {isBatchMode && (
                    <input
                      type="checkbox"
                      checked={selectedIds?.has(memory.id) ?? false}
                      onChange={() => onToggleSelect?.(memory.id)}
                      className="w-4 h-4 rounded accent-blue-500"
                      onClick={(e) => e.stopPropagation()}
                    />
                  )}
                  {/* 置顶图标 */}
                  {isPinned && (
                    <span title="已置顶" className="text-yellow-500 text-xs">
                      📌
                    </span>
                  )}
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-medium ${
                      TYPE_COLORS[memory.type]
                    }`}
                  >
                    {TYPE_LABELS[memory.type]}
                  </span>
                  <span
                    className={`text-xs ${getWeightColor(memory.weight)} font-medium`}
                  >
                    权重: {memory.weight}
                  </span>
                  {getDreamSourceBadge(memory)}
                </div>
                <span
                  className={`text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}
                >
                  {formatDate(memory.updatedAt)}
                </span>
              </div>
              <p
                className={`text-sm line-clamp-2 ${isDark ? "text-gray-300" : "text-gray-700"}`}
              >
                {memory.summary || memory.content.substring(0, 100)}
              </p>
              {memory.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {[...new Set(memory.tags)].map((tag) => (
                    <button
                      key={tag}
                      onClick={(e) => {
                        e.stopPropagation();
                        onTagClick?.(tag);
                      }}
                      title="点击按此标签筛选"
                      className={`px-1.5 py-0.5 rounded text-xs cursor-pointer transition-colors ${
                        isDark
                          ? "bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-blue-400"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-blue-600"
                      }`}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 操作按钮 */}
            {!isBatchMode && (
              <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {/* 置顶按钮 */}
                {onTogglePin && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onTogglePin(memory.id);
                    }}
                    className={`p-1 rounded text-xs ${
                      isPinned
                        ? "text-yellow-500"
                        : isDark
                          ? "hover:bg-gray-600 text-gray-500 hover:text-yellow-400"
                          : "hover:bg-gray-100 text-gray-400 hover:text-yellow-600"
                    }`}
                    title={isPinned ? "取消置顶" : "置顶"}
                  >
                    📌
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(memory);
                  }}
                  className={`p-1 rounded text-xs ${
                    isDark
                      ? "hover:bg-gray-600 text-gray-400 hover:text-blue-400"
                      : "hover:bg-gray-100 text-gray-400 hover:text-blue-600"
                  }`}
                  title="编辑"
                >
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                    />
                  </svg>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(memory.id);
                  }}
                  className={`p-1 rounded text-xs ${
                    isDark
                      ? "hover:bg-gray-600 text-gray-400 hover:text-red-400"
                      : "hover:bg-gray-100 text-gray-400 hover:text-red-600"
                  }`}
                  title="删除"
                >
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default MemoryList;
