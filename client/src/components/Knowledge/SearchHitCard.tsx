import { memo } from "react";
import type { KnowledgeSearchHit } from "../../types";

const MATCH_TYPE_LABELS: Record<KnowledgeSearchHit["matchType"], string> = {
  keyword: "关键词",
  semantic: "语义",
  graph_rag: "图谱",
  knowledge: "知识库",
};

const MATCH_TYPE_COLORS: Record<KnowledgeSearchHit["matchType"], string> = {
  keyword: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  semantic:
    "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  graph_rag:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  knowledge:
    "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
};

function scoreColor(score: number): string {
  if (score >= 0.8) return "text-green-600 dark:text-green-400";
  if (score >= 0.5) return "text-yellow-600 dark:text-yellow-400";
  return "text-gray-400 dark:text-gray-500";
}

interface SearchHitCardProps {
  hit: KnowledgeSearchHit;
  index: number;
  isDark: boolean;
  onClick?: () => void;
}

export const SearchHitCard = memo(function SearchHitCard({
  hit,
  index,
  isDark,
  onClick,
}: SearchHitCardProps) {
  const percent = Math.round(hit.score * 100);

  return (
    <div
      className={`p-3 rounded-lg border cursor-pointer transition-colors hover:border-blue-400 ${
        isDark
          ? "border-gray-700 bg-gray-800/50 hover:bg-gray-800"
          : "border-gray-200 bg-white hover:bg-gray-50"
      }`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClick?.();
      }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className={`text-xs font-mono font-medium ${
            isDark ? "text-gray-500" : "text-gray-400"
          }`}
        >
          #{index + 1}
        </span>
        <span className="text-sm font-medium truncate flex-1">
          {hit.file.title}
        </span>
        <span
          className={`text-xs font-mono font-semibold ${scoreColor(hit.score)}`}
        >
          {percent}%
        </span>
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
            MATCH_TYPE_COLORS[hit.matchType] ?? MATCH_TYPE_COLORS.keyword
          }`}
        >
          {MATCH_TYPE_LABELS[hit.matchType] ?? hit.matchType}
        </span>
      </div>

      <p
        className={`text-xs line-clamp-3 ${
          isDark ? "text-gray-400" : "text-gray-500"
        }`}
      >
        {hit.snippet ?? hit.file.content.slice(0, 200)}
      </p>

      {hit.domain && (
        <div className="mt-1.5">
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded ${
              isDark ? "bg-gray-700 text-gray-400" : "bg-gray-100 text-gray-500"
            }`}
          >
            {hit.domain}
          </span>
        </div>
      )}
    </div>
  );
});
