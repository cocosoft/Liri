import { memo } from "react";

interface FAQCategoryFilterProps {
  categories: string[];
  selected: string;
  onSelect: (category: string) => void;
  isDark: boolean;
}

export const FAQCategoryFilter = memo(function FAQCategoryFilter({
  categories,
  selected,
  onSelect,
  isDark,
}: FAQCategoryFilterProps) {
  return (
    <div className="flex flex-col gap-1">
      <span className={`text-[10px] uppercase font-semibold px-1 ${isDark ? "text-gray-500" : "text-gray-400"}`}>
        分类
      </span>
      <button
        onClick={() => onSelect("")}
        className={`text-xs text-left px-2 py-1 rounded transition-colors ${
          selected === ""
            ? "bg-blue-500/20 text-blue-600 dark:text-blue-400 font-medium"
            : isDark
              ? "text-gray-400 hover:bg-gray-800"
              : "text-gray-600 hover:bg-gray-100"
        }`}
      >
        全部
      </button>
      {categories.map((cat) => (
        <button
          key={cat}
          onClick={() => onSelect(cat)}
          className={`text-xs text-left px-2 py-1 rounded transition-colors truncate ${
            selected === cat
              ? "bg-blue-500/20 text-blue-600 dark:text-blue-400 font-medium"
              : isDark
                ? "text-gray-400 hover:bg-gray-800"
                : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          {cat}
        </button>
      ))}
    </div>
  );
});
