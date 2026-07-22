/**
 * GallerySearchBar
 * 图库搜索筛选栏（Phase 1）
 *
 * 支持关键词搜索 + 日期范围筛选
 */

import React from "react";
import type { GallerySearchParams } from "../../../stores/mediaStore";

interface GallerySearchBarProps {
  params: GallerySearchParams;
  onChange: (params: Partial<GallerySearchParams>) => void;
  onRefresh?: () => void;
}

const DATE_RANGE_OPTIONS: {
  value: GallerySearchParams["dateRange"];
  label: string;
}[] = [
  { value: "all", label: "全部" },
  { value: "today", label: "今天" },
  { value: "7days", label: "近 7 天" },
  { value: "30days", label: "近 30 天" },
];

export const GallerySearchBar: React.FC<GallerySearchBarProps> = ({
  params,
  onChange,
  onRefresh,
}) => {
  return (
    <div className="flex items-center gap-2">
      {/* 搜索框 */}
      <div className="relative flex-1">
        <input
          type="text"
          placeholder="搜索图片…"
          value={params.keyword}
          onChange={(e) => onChange({ keyword: e.target.value })}
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 pl-8 text-sm text-gray-700 placeholder-gray-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:placeholder-gray-500"
        />
        <svg
          className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
      </div>

      {/* 日期筛选 */}
      <select
        value={params.dateRange}
        onChange={(e) =>
          onChange({
            dateRange: e.target.value as GallerySearchParams["dateRange"],
          })
        }
        className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-600 focus:border-blue-400 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
      >
        {DATE_RANGE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      {/* 刷新按钮 */}
      {onRefresh && (
        <button
          onClick={onRefresh}
          className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-500 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
          title="刷新"
        >
          ↻
        </button>
      )}
    </div>
  );
};
