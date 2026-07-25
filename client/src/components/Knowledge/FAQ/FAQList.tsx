import { memo } from "react";
import type { FAQEntry } from "../../../types/faq";
import { FAQStatusBadge } from "./FAQStatusBadge";
import { Pencil, Trash2, Star } from "lucide-react";

interface FAQListProps {
  entries: FAQEntry[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleAll: () => void;
  onEdit: (entry: FAQEntry) => void;
  onDelete: (id: string) => void;
  onRetryEmbed: (id: string) => void;
  isDark: boolean;
}

export const FAQList = memo(function FAQList({
  entries,
  selectedIds,
  onToggleSelect,
  onToggleAll,
  onEdit,
  onDelete,
  onRetryEmbed,
  isDark,
}: FAQListProps) {
  if (entries.length === 0) {
    return (
      <div
        className={`text-center py-12 ${isDark ? "text-gray-500" : "text-gray-400"}`}
      >
        <p className="text-sm">暂无 FAQ 条目</p>
        <p className="text-xs mt-1">点击「新建」创建第一条 FAQ</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {/* 表头 */}
      <div
        className={`flex items-center gap-2 px-3 py-2 text-[11px] font-medium ${isDark ? "text-gray-500" : "text-gray-400"}`}
      >
        <input
          type="checkbox"
          checked={selectedIds.size === entries.length && entries.length > 0}
          onChange={onToggleAll}
          className="rounded"
        />
        <span className="flex-1">问题</span>
        <span className="w-12 text-center">状态</span>
        <span className="w-14 text-center">操作</span>
      </div>

      {entries.map((entry) => (
        <div
          key={entry.id}
          className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm transition-colors ${
            selectedIds.has(entry.id)
              ? "bg-blue-500/10"
              : isDark
                ? "hover:bg-gray-800/50"
                : "hover:bg-gray-50"
          }`}
        >
          <input
            type="checkbox"
            checked={selectedIds.has(entry.id)}
            onChange={() => onToggleSelect(entry.id)}
            className="rounded shrink-0"
          />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span
                className={`font-medium truncate ${isDark ? "text-gray-200" : "text-gray-800"}`}
              >
                {entry.question}
              </span>
              {entry.recommended && (
                <Star size={12} className="text-amber-500 shrink-0" />
              )}
            </div>
            <p
              className={`text-xs mt-0.5 line-clamp-1 ${isDark ? "text-gray-500" : "text-gray-400"}`}
            >
              {entry.answer.slice(0, 100)}
            </p>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              {entry.tags.map((t) => (
                <span
                  key={t}
                  className={`text-[10px] px-1 py-0 rounded ${isDark ? "bg-gray-700 text-gray-400" : "bg-gray-100 text-gray-500"}`}
                >
                  {t}
                </span>
              ))}
              {entry.category && (
                <span
                  className={`text-[10px] px-1 py-0 rounded ${isDark ? "bg-gray-700/50 text-gray-500" : "bg-gray-50 text-gray-400"}`}
                >
                  {entry.category}
                </span>
              )}
            </div>
          </div>

          <div className="w-12 flex justify-center shrink-0">
            <FAQStatusBadge
              status={entry.embeddingStatus}
              onRetry={() => onRetryEmbed(entry.id)}
            />
          </div>

          <div className="w-14 flex items-center justify-center gap-1 shrink-0">
            <button
              onClick={() => onEdit(entry)}
              className={`p-1 rounded hover:bg-gray-700/50 ${isDark ? "text-gray-400 hover:text-blue-400" : "text-gray-400 hover:text-blue-500"}`}
              title="编辑"
            >
              <Pencil size={14} />
            </button>
            <button
              onClick={() => onDelete(entry.id)}
              className={`p-1 rounded hover:bg-gray-700/50 ${isDark ? "text-gray-400 hover:text-red-400" : "text-gray-400 hover:text-red-500"}`}
              title="删除"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
});
