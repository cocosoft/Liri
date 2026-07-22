/**
 * 获取到的模型列表组件（含搜索+分页+批量导入）
 * 从 ModelPage 提取的独立组件
 */

import type { FetchedModel } from "../../types";

interface FetchedModelListProps {
  models: FetchedModel[];
  total: number;
  currentPage: number;
  pageSize: number;
  searchText: string;
  onSearchChange: (text: string) => void;
  onPageChange: (page: number) => void;
  onBulkImport: (modelIds: string[]) => void;
  importing: boolean;
}

export default function FetchedModelList({
  models,
  total,
  currentPage,
  pageSize,
  searchText,
  onSearchChange,
  onPageChange,
  onBulkImport,
  importing,
}: FetchedModelListProps) {
  return (
    <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-gray-500">可用模型 ({total}):</p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onBulkImport(models.map((m) => m.id))}
            disabled={importing || models.length === 0}
            className="px-2 py-1 text-xs bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/40 text-blue-600 dark:text-blue-400 rounded transition-colors disabled:opacity-30"
          >
            {importing ? "导入中..." : "导入到模型列表"}
          </button>
          <input
            type="text"
            value={searchText}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="搜索模型..."
            className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded"
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-1 mb-3">
        {models.map((m) => (
          <span
            key={m.id}
            className="px-1.5 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded"
          >
            {m.id}
            {m.ownedBy ? ` [${m.ownedBy}]` : ""}
          </span>
        ))}
      </div>
      {total > pageSize && (
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>
            显示 {(currentPage - 1) * pageSize + 1} -{" "}
            {Math.min(currentPage * pageSize, total)} 条
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onPageChange(Math.max(1, currentPage - 1))}
              disabled={currentPage <= 1}
              className="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 rounded disabled:opacity-30"
            >
              上一页
            </button>
            <span>{currentPage}</span>
            <button
              onClick={() =>
                onPageChange(
                  Math.min(Math.ceil(total / pageSize), currentPage + 1),
                )
              }
              disabled={currentPage >= Math.ceil(total / pageSize)}
              className="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 rounded disabled:opacity-30"
            >
              下一页
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
