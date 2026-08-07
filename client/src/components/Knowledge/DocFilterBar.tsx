/**
 * DocFilterBar — 文档搜索/排序/筛选栏 (Phase 1 W1 + W3)
 *
 * W3: 搜索改为调用服务端 hybridSearch，来源/分类筛选独立于搜索（正交）。
 * P4: 排序/来源收进「筛选」弹层，工具条行只留 文档数 + 标签过滤，缓解侧边栏拥挤。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { SearchTargetFilter } from "./SearchTargetFilter";
import type { KnowledgeSortBy as SortBy } from "../../types";

export type { KnowledgeSortBy as SortBy } from "../../types";

/** P4: 「筛选」弹层 — 收纳排序 + 来源（默认收起，点漏斗图标展开） */
function FilterPopover({
  isDark,
  sortBy,
  selectedSource,
  onSortByChange,
  onSourceChange,
}: {
  isDark: boolean;
  sortBy: SortBy;
  selectedSource: string | null;
  onSortByChange: (sortBy: SortBy) => void;
  onSourceChange: (source: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 点击弹层外部时关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const inputBg = isDark
    ? "bg-gray-700 border-gray-600 text-white placeholder-gray-400"
    : "bg-white border-gray-300 text-gray-900 placeholder-gray-400";
  const labelCls = isDark ? "text-gray-400" : "text-gray-500";

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="筛选（排序/来源）"
        className={`p-1.5 rounded border ${inputBg} hover:opacity-80 transition-opacity ${
          open || sortBy !== "updated" || selectedSource
            ? "border-blue-500 text-blue-500"
            : ""
        }`}
      >
        {/* 漏斗图标 */}
        <svg
          className="w-3.5 h-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 4a1 1 0 011-1h16a1 1 0 01.7 1.7l-6.7 6.5V18a1 1 0 01-.6.9l-4 1.8A1 1 0 018 19.8V11.2L2.3 4.7A1 1 0 013 4z"
          />
        </svg>
      </button>
      {open && (
        <div
          className={`absolute right-0 top-full mt-1 z-50 w-44 p-2 space-y-2 rounded-md shadow-lg border ${
            isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"
          }`}
        >
          <label className="block">
            <span className={`block text-[10px] mb-0.5 ${labelCls}`}>排序</span>
            <select
              value={sortBy}
              onChange={(e) => onSortByChange(e.target.value as SortBy)}
              className={`w-full text-xs px-1.5 py-1 rounded border ${inputBg} focus:outline-none cursor-pointer`}
            >
              <option value="updated">最近更新</option>
              <option value="title">按名称</option>
              <option value="created">按创建</option>
            </select>
          </label>
          <label className="block">
            <span className={`block text-[10px] mb-0.5 ${labelCls}`}>来源</span>
            <select
              value={selectedSource || "all"}
              onChange={(e) => {
                const val = e.target.value;
                onSourceChange(val === "all" ? null : val);
              }}
              className={`w-full text-xs px-1.5 py-1 rounded border ${inputBg} focus:outline-none cursor-pointer`}
            >
              <option value="all">全部来源</option>
              <option value="manual">手动创建</option>
              <option value="upload">文件上传</option>
              <option value="chat-save">聊天保存</option>
              <option value="dream">梦境生成</option>
              <option value="compiled">LLM编译</option>
            </select>
          </label>
        </div>
      )}
    </div>
  );
}

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

      {/* P4: 工具条行 — 文档数 + 标签过滤 + 筛选弹层；flex-wrap 防止标签 chips 挤压溢出 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`text-[10px] ${textMuted} shrink-0`}>
          {docCount} 个文档
          {selectedCategory && (
            <span className="ml-1 opacity-60">（已筛选）</span>
          )}
        </span>
        {onSearchTagsChange && (
          <SearchTargetFilter
            onTagsChange={onSearchTagsChange}
            isDark={isDark}
            tags={searchTags}
          />
        )}
        <div className="ml-auto shrink-0">
          <FilterPopover
            isDark={isDark}
            sortBy={sortBy}
            selectedSource={selectedSource}
            onSortByChange={onSortByChange}
            onSourceChange={onSourceChange}
          />
        </div>
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
