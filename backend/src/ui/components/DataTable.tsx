// @ts-nocheck
/**
 * 数据表格组件
 * 支持排序、筛选、分页功能
 */

import React, { useState, useMemo } from 'react';

export interface Column<T> {
  id: string;
  label: string;
  render?: (value: T[keyof T], row: T) => React.ReactNode;
  sortable?: boolean;
  filterable?: boolean;
  width?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  onRowClick?: (row: T) => void;
  onRowDoubleClick?: (row: T) => void;
  pageSize?: number;
}

export const DataTable = <T extends Record<string, unknown>>({
  columns,
  data,
  onRowClick,
  onRowDoubleClick,
  pageSize = 10,
}: DataTableProps<T>) => {
  const [sortConfig, setSortConfig] = useState<{ key: keyof T; direction: 'asc' | 'desc' } | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [currentPage, setCurrentPage] = useState(1);

  // 筛选数据
  const filteredData = useMemo(() => {
    return data.filter(row => {
      return Object.entries(filters).every(([key, value]) => {
        if (!value) return true;
        const rowValue = row[key as keyof T];
        return String(rowValue).toLowerCase().includes(value.toLowerCase());
      });
    });
  }, [data, filters]);

  // 排序数据
  const sortedData = useMemo(() => {
    if (!sortConfig) return filteredData;
    return [...filteredData].sort((a, b) => {
      const aValue = a[sortConfig.key];
      const bValue = b[sortConfig.key];
      
      if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredData, sortConfig]);

  // 分页数据
  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;
    return sortedData.slice(start, end);
  }, [sortedData, currentPage, pageSize]);

  // 处理排序
  const handleSort = (key: keyof T) => {
    setSortConfig(prev => {
      if (prev?.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: 'asc' };
    });
  };

  // 处理筛选
  const handleFilterChange = (columnId: string, value: string) => {
    setFilters(prev => ({ ...prev, [columnId]: value }));
    setCurrentPage(1);
  };

  // 计算分页信息
  const totalPages = Math.ceil(sortedData.length / pageSize);
  const hasPrevPage = currentPage > 1;
  const hasNextPage = currentPage < totalPages;

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      {/* 表头 */}
      <table className="w-full">
        <thead className="bg-gray-50">
          <tr>
            {columns.map(column => (
              <th
                key={column.id}
                className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider"
                style={{ width: column.width }}
              >
                <div className="flex items-center gap-2">
                  {column.sortable ? (
                    <button
                      onClick={() => handleSort(column.id as keyof T)}
                      className="flex items-center gap-1 hover:text-blue-600 transition-colors"
                    >
                      {column.label}
                      {sortConfig?.key === column.id && (
                        <span>{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </button>
                  ) : (
                    <span>{column.label}</span>
                  )}
                </div>
                
                {/* 筛选输入框 */}
                {column.filterable && (
                  <input
                    type="text"
                    placeholder="Filter..."
                    value={filters[column.id] || ''}
                    onChange={(e) => handleFilterChange(column.id, e.target.value)}
                    className="mt-1 w-full px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                )}
              </th>
            ))}
          </tr>
        </thead>
        
        {/* 表体 */}
        <tbody className="divide-y divide-gray-200">
          {paginatedData.map((row, index) => (
            <tr
              key={index}
              className="hover:bg-gray-50 cursor-pointer transition-colors"
              onClick={() => onRowClick?.(row)}
              onDoubleClick={() => onRowDoubleClick?.(row)}
            >
              {columns.map(column => (
                <td
                  key={column.id}
                  className="px-4 py-3 text-sm text-gray-700"
                  style={{ width: column.width }}
                >
                  {column.render
                    ? column.render(row[column.id as keyof T], row)
                    : row[column.id as keyof T]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-t border-gray-200">
          <div className="text-sm text-gray-600">
            Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, sortedData.length)} of {sortedData.length} entries
          </div>
          
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={!hasPrevPage}
              className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            
            {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
              <button
                key={page}
                onClick={() => setCurrentPage(page)}
                className={`px-3 py-1 text-sm border rounded ${
                  page === currentPage
                    ? 'bg-blue-500 text-white border-blue-500'
                    : 'border-gray-300 hover:bg-gray-100'
                }`}
              >
                {page}
              </button>
            ))}
            
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={!hasNextPage}
              className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * 创建数据表格组件
 */
export function createDataTable<T extends Record<string, unknown>>(props: DataTableProps<T>): React.ReactElement {
  return <DataTable {...props} />;
}
