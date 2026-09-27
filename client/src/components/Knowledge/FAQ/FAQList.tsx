import { memo } from "react";
import { useTranslation } from "react-i18next";
import type { FAQEntry } from "../../../types/knowledge";
import { FAQStatusBadge } from "./FAQStatusBadge";
import { Pencil, Trash2, Star } from "lucide-react";

interface FAQListProps {
  entries: FAQEntry[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleAll: () => void;
  onEdit: (entry: FAQEntry) => void;
  onDelete: (id: string) => void;
  isDark: boolean;
}

export const FAQList = memo(function FAQList({
  entries,
  selectedIds,
  onToggleSelect,
  onToggleAll,
  onEdit,
  onDelete,
  isDark,
}: FAQListProps) {
  const { t } = useTranslation();
  if (entries.length === 0) {
    return (
      <div
        className={`text-center py-12 ${isDark ? "text-gray-500" : "text-gray-400"}`}
      >
        <p className="text-sm">{t("knowledge.faq.empty")}</p>
        <p className="text-xs mt-1">{t("knowledge.faq.emptyHint")}</p>
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
        <span className="flex-1">{t("knowledge.faq.questionLabel")}</span>
        <span className="w-12 text-center">{t("knowledge.faq.colStatus")}</span>
        <span className="w-14 text-center">
          {t("knowledge.faq.colActions")}
        </span>
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
              {/* L1：answer 可能缺失，空值兜底避免 slice TypeError */}
              {(entry.answer ?? "").slice(0, 100)}
            </p>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              {entry.tags.map((tag) => (
                <span
                  key={tag}
                  className={`text-[10px] px-1 py-0 rounded ${isDark ? "bg-gray-700 text-gray-400" : "bg-gray-100 text-gray-500"}`}
                >
                  {tag}
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
            <FAQStatusBadge status={entry.embeddingStatus} />
          </div>

          <div className="w-14 flex items-center justify-center gap-1 shrink-0">
            <button
              onClick={() => onEdit(entry)}
              className={`p-1 rounded hover:bg-gray-700/50 ${isDark ? "text-gray-400 hover:text-blue-400" : "text-gray-400 hover:text-blue-500"}`}
              title={t("common.edit")}
            >
              <Pencil size={14} />
            </button>
            <button
              onClick={() => onDelete(entry.id)}
              className={`p-1 rounded hover:bg-gray-700/50 ${isDark ? "text-gray-400 hover:text-red-400" : "text-gray-400 hover:text-red-500"}`}
              title={t("common.delete")}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
});
