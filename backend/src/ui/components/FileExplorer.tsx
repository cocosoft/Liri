/**
 * 文件浏览器组件
 * 用于浏览和管理文件系统
 */

import React, { useState } from 'react';

export interface FileItem {
  id: string;
  name: string;
  type: 'file' | 'directory';
  size?: number;
  modifiedAt?: Date;
  children?: FileItem[];
}

export interface FileExplorerProps {
  root: FileItem;
  onSelect?: (item: FileItem) => void;
  onDoubleClick?: (item: FileItem) => void;
}

export const FileExplorer: React.FC<FileExplorerProps> = ({
  root,
  onSelect,
  onDoubleClick,
}) => {
  const [expanded, setExpanded] = useState<Set<string>>(new Set([root.id]));
  const [selected, setSelected] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelect = (item: FileItem) => {
    setSelected(item.id);
    onSelect?.(item);
  };

  const handleDoubleClick = (item: FileItem) => {
    if (item.type === 'directory') {
      toggleExpand(item.id);
    }
    onDoubleClick?.(item);
  };

  const renderTree = (items: FileItem[], depth: number = 0) => {
    return items.map((item) => {
      const isExpanded = expanded.has(item.id);
      const isSelected = selected === item.id;

      return (
        <div key={item.id}>
          <div
            onClick={() => handleSelect(item)}
            onDoubleClick={() => handleDoubleClick(item)}
            className={`flex items-center gap-2 px-2 py-1 cursor-pointer transition-colors ${
              isSelected ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50 text-gray-700'
            }`}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
          >
            {item.type === 'directory' && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleExpand(item.id);
                }}
                className="w-4 h-4 flex items-center justify-center text-gray-400 hover:text-gray-600"
              >
                {isExpanded ? '▼' : '▶'}
              </button>
            )}
            {item.type === 'file' && <span className="w-4" />}
            
            <span className="text-sm">
              {item.type === 'directory' ? '📁' : '📄'}
            </span>
            
            <span className="flex-1 truncate text-sm">{item.name}</span>
            
            {item.type === 'file' && item.size && (
              <span className="text-xs text-gray-400">
                {formatFileSize(item.size)}
              </span>
            )}
            
            {item.modifiedAt && (
              <span className="text-xs text-gray-400">
                {formatDate(item.modifiedAt)}
              </span>
            )}
          </div>
          
          {item.type === 'directory' && isExpanded && item.children && (
            <div>{renderTree(item.children, depth + 1)}</div>
          )}
        </div>
      );
    });
  };

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="px-4 py-2 bg-gray-50 border-b border-gray-200">
        <h3 className="text-sm font-semibold text-gray-700">Files</h3>
      </div>
      <div className="flex-1 overflow-y-auto">
        {renderTree([root])}
      </div>
    </div>
  );
};

/**
 * 格式化文件大小
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * 格式化日期
 */
function formatDate(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (days === 1) return 'Yesterday';
  if (days < 7) return date.toLocaleDateString([], { weekday: 'short' });
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/**
 * 创建文件浏览器组件
 */
export function createFileExplorer(props: FileExplorerProps): React.ReactElement {
  return <FileExplorer {...props} />;
}
