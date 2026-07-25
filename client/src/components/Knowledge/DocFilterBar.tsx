/**
 * DocFilterBar — 文档搜索/排序/筛选栏 (Phase 1 W1 + W3)
 *
 * W3: 搜索改为调用服务端 hybridSearch，来源/分类筛选独立于搜索（正交）。
 */
import { useCallback } from "react";
import { SearchTargetFilter } from "./SearchTargetFilter";

export type SortBy = "updated" | "title" | "created";

interface DocFilterBarProps {
  isDark: boolean;
  searchQuery: string;
  sortBy: SortBy;
  selectedSource: string | null;
  selectedCategory: string | null;
  categories: string[];
  docCount: number;
  selectedBase: string | null;
  onSearchQueryChange: (query: string) => void;
  onSearch: (query: string, base: string | null, searchTags?: string[]) => void;
  onSortByChange: (sortBy: SortBy) => void;
  onSourceChange: (source: string | null) => void;
  onCategoryChange: (category: string | null) => void;
  onSearchTagsChange?: (tags: string[]) => void;
  searchTags?: string[];
}

function DocFilterBar({
  isDark,
  searchQuery,
  sortBy,
  selectedSource,
  selectedCategory,
  categories,
  docCount,
  selectedBase,
  onSearchQueryChange,
  onSearch,
  onSortByChange,
  onSourceChange,
  onCategoryChange,
  onSearchTagsChange,
  searchTags,
}: DocFilterBarProps) {
  const textMuted = isDark ? "text-gray-500" : "text-gray-400";
  const inputBg = isDark
    ? "bg-gray-700 border-gray-600 text-white placeholder-gray-400"
    : "bg-white border-gray-300 text-gray-900 placeholder-gray-400";

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        onSearch(searchQuery, selectedBase, searchTags);
      }
    },
    [searchQuery, selectedBase, searchTags, onSearch],
  );

  return (
    <div className="px-4 pb-2 space-y-1.5">
      {/* 搜索框 */}
      <div className="flex gap-1">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="搜索知识文档..."
          className={`flex-1 px-3 py-1.5 rounded-md text-xs border ${inputBg} focus:outline-none focus:ring-1 focus:ring-blue-500`}
        />
        <button
          onClick={() => onSearch(searchQuery, selectedBase, searchTags)}
          disabled={!searchQuery.trim()}
          className="px-2 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-md"
        >
          搜索
        </button>
      </div>

      {/* 标签过滤 (SearchTarget) */}
      {onSearchTagsChange && (
        <div className="py-0.5">
          <SearchTargetFilter
            onTagsChange={onSearchTagsChange}
            isDark={isDark}
            tags={searchTags}
          />
        </div>
      )}

      {/* 排序 + 来源筛选 */}
      <div className="flex items-center justify-between">
        <span className={`text-[10px] ${textMuted}`}>
          {docCount} 个文档
          {selectedCategory && (
            <span className="ml-1 opacity-60">（已筛选）</span>
          )}
        </span>
        <select
          value={sortBy}
          onChange={(e) => onSortByChange(e.target.value as SortBy)}
          className={`text-[10px] px-1.5 py-0.5 rounded border ${inputBg} focus:outline-none cursor-pointer`}
        >
          <option value="updated">最近更新</option>
          <option value="title">按名称</option>
          <option value="created">按创建</option>
        </select>
        <select
          value={selectedSource || "all"}
          onChange={(e) => {
            const val = e.target.value;
            onSourceChange(val === "all" ? null : val);
          }}
          className={`text-[10px] px-1.5 py-0.5 rounded border ${inputBg} focus:outline-none cursor-pointer`}
        >
          <option value="all">全部来源</option>
          <option value="manual">手动创建</option>
          <option value="upload">文件上传</option>
          <option value="chat-save">聊天保存</option>
          <option value="dream">梦境生成</option>
          <option value="compiled">LLM编译</option>
        </select>
      </div>

      {/* 分类筛选 */}
      {categories.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-thin">
          <button
            onClick={() => onCategoryChange(null)}
            className={`flex-shrink-0 px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
              selectedCategory === null
                ? "bg-blue-500 text-white"
                : isDark
                  ? "bg-gray-700 text-gray-400 hover:text-gray-200"
                  : "bg-gray-100 text-gray-500 hover:text-gray-700"
            }`}
          >
            全部分类
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() =>
                onCategoryChange(cat === selectedCategory ? null : cat)
              }
              className={`flex-shrink-0 px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                selectedCategory === cat
                  ? "bg-blue-500 text-white"
                  : isDark
                    ? "bg-gray-700 text-gray-400 hover:text-gray-200"
                    : "bg-gray-100 text-gray-500 hover:text-gray-700"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default DocFilterBar;
