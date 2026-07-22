import { useMemo } from "react";
import type { FilePreview } from "../../types";

/** @ 提及条目 */
export interface MentionItem {
  id: string;
  label: string;
  type: "file";
  path: string;
}

interface MentionMenuProps {
  /** @ 后的查询文本 */
  query: string;
  /** 是否显示菜单 */
  show: boolean;
  /** 当前选中项索引 */
  selectedIndex: number;
  /** 当前会话已上传的文件列表 */
  sessionFiles: FilePreview[];
  /** 选中条目 */
  onSelect: (item: MentionItem) => void;
  /** 悬停条目 */
  onHover: (index: number) => void;
}

/**
 * MentionMenu — @ 引用自动补全菜单
 *
 * 用户在输入框中输入 @ 时弹出，显示当前会话已上传的文件列表，
 * 支持模糊搜索过滤和键盘上下选择。
 */
export default function MentionMenu({
  query,
  show,
  selectedIndex,
  sessionFiles,
  onSelect,
  onHover,
}: MentionMenuProps) {
  /** 根据 @ 后的文本过滤匹配的文件 */
  const filteredItems = useMemo((): MentionItem[] => {
    const q = query.toLowerCase();
    return sessionFiles
      .filter((f) => f.name.toLowerCase().includes(q))
      .map((f) => ({
        id: f.path,
        label: f.name,
        type: "file" as const,
        path: f.path,
      }));
  }, [query, sessionFiles]);

  if (!show || filteredItems.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-xl overflow-hidden max-h-56 overflow-y-auto">
      <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
        <span>@</span>
        <span>引用文件</span>
        {query && <span className="text-blue-500 font-mono">"{query}"</span>}
      </div>
      {filteredItems.map((item, idx) => (
        <button
          key={item.id}
          onClick={() => onSelect(item)}
          onMouseEnter={() => onHover(idx)}
          className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
            idx === selectedIndex
              ? "bg-blue-50 dark:bg-blue-900/30"
              : "hover:bg-gray-50 dark:hover:bg-gray-700/50"
          }`}
        >
          <span className="text-base shrink-0">
            {item.type === "file" ? "📄" : "📚"}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-gray-800 dark:text-gray-200 font-medium truncate">
              {item.label}
            </div>
            <div className="text-xs text-gray-400 dark:text-gray-500 truncate font-mono">
              {item.path}
            </div>
          </div>
          <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">
            Tab
          </span>
        </button>
      ))}
    </div>
  );
}
