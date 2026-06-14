import { useState } from "react";
import type { FileEntry } from "../../types";

/**
 * 详细文件列表组件属性
 */
interface DetailedFileListProps {
  /** 文件条目列表 */
  entries: FileEntry[];
  /** 当前选中的文件 */
  selectedFile: { name: string; path: string } | null;
  /** 是否正在加载 */
  loading: boolean;
  /** 文件点击回调 */
  onItemClick: (entry: FileEntry) => void;
  /** 文件预览回调 */
  onPreview: (entry: FileEntry) => void;
  /** 发送给 AI */
  onSendToAI: (path: string) => void;
  /** 存入知识库 */
  onSaveToKnowledge: (path: string) => void;
  /** 存入记忆 */
  onSaveToMemory: (path: string) => void;
}

type SortField = "name" | "size" | "type" | "modified_at";
type SortOrder = "asc" | "desc";

/**
 * 格式化文件大小
 */
function formatSize(bytes?: number): string {
  if (bytes === undefined || bytes === null) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * 格式化日期
 */
function formatDate(ts?: number): string {
  if (!ts) return "-";
  return new Date(ts).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * 获取文件类型图标
 */
function getFileIcon(entry: FileEntry): string {
  if (entry.type === "directory") return "📁";
  const ext = entry.name.split(".").pop()?.toLowerCase() || "";
  const imageExts = ["jpg", "jpeg", "png", "gif", "bmp", "webp", "svg"];
  const codeExts = ["js", "ts", "tsx", "jsx", "py", "java", "cpp", "c", "go", "rs", "rb", "php", "css", "scss", "less"];
  const docExts = ["md", "markdown", "txt", "pdf", "doc", "docx"];
  const archiveExts = ["zip", "tar", "gz", "rar", "7z"];
  const dataExts = ["json", "yaml", "yml", "xml", "csv", "toml"];

  if (imageExts.includes(ext)) return "🖼️";
  if (codeExts.includes(ext)) return "💻";
  if (docExts.includes(ext)) return "📄";
  if (archiveExts.includes(ext)) return "📦";
  if (dataExts.includes(ext)) return "📊";
  return "📎";
}

/**
 * 获取文件类型标签
 */
function getFileTypeLabel(entry: FileEntry): string {
  if (entry.type === "directory") return "文件夹";
  const ext = entry.name.split(".").pop()?.toLowerCase() || "";
  return ext.toUpperCase();
}

/**
 * 详细文件列表组件
 * 以表格形式展示文件，支持排序和操作
 */
function DetailedFileList({
  entries,
  selectedFile,
  loading,
  onItemClick,
  onPreview,
  onSendToAI,
  onSaveToKnowledge,
  onSaveToMemory,
}: DetailedFileListProps) {
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    entry: FileEntry;
  } | null>(null);

  /** 切换排序 */
  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("asc");
    }
  };

  /** 排序后的条目 */
  const sortedEntries = [...entries].sort((a, b) => {
    // 目录始终排在前面
    if (a.type === "directory" && b.type !== "directory") return -1;
    if (a.type !== "directory" && b.type === "directory") return 1;

    let comparison = 0;
    switch (sortField) {
      case "name":
        comparison = a.name.localeCompare(b.name);
        break;
      case "type":
        comparison = getFileTypeLabel(a).localeCompare(getFileTypeLabel(b));
        break;
      case "size":
        comparison = (a.size || 0) - (b.size || 0);
        break;
      case "modified_at":
        comparison = (a.modified_at || 0) - (b.modified_at || 0);
        break;
    }
    return sortOrder === "asc" ? comparison : -comparison;
  });

  /** 排序列指示器 */
  const sortIndicator = (field: SortField) => {
    if (sortField !== field) return null;
    return <span className="ml-1">{sortOrder === "asc" ? "↑" : "↓"}</span>;
  };

  return (
    <div className="flex-1 overflow-auto">
      <table className="w-full text-sm">
        {/* 表头 */}
        <thead className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800">
          <tr className="border-b border-gray-200 dark:border-gray-700">
            <th
              className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-700 dark:hover:text-gray-200 w-10"
            >
              类型
            </th>
            <th
              onClick={() => toggleSort("name")}
              className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-700 dark:hover:text-gray-200"
            >
              名称{sortIndicator("name")}
            </th>
            <th
              onClick={() => toggleSort("type")}
              className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-700 dark:hover:text-gray-200 w-20"
            >
              类型{sortIndicator("type")}
            </th>
            <th
              onClick={() => toggleSort("size")}
              className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-700 dark:hover:text-gray-200 w-24"
            >
              大小{sortIndicator("size")}
            </th>
            <th
              onClick={() => toggleSort("modified_at")}
              className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-700 dark:hover:text-gray-200 w-44"
            >
              修改时间{sortIndicator("modified_at")}
            </th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider w-48">
              操作
            </th>
          </tr>
        </thead>

        {/* 表体 */}
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
          {loading ? (
            <tr>
              <td colSpan={6} className="px-4 py-12 text-center text-gray-400">
                加载中...
              </td>
            </tr>
          ) : sortedEntries.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-4 py-12 text-center text-gray-400">
                <p className="mb-1">暂无文件</p>
                <p className="text-xs text-gray-400">拖拽文件到此处或点击上传按钮添加文件</p>
              </td>
            </tr>
          ) : (
            sortedEntries.map((entry) => {
              const isSelected = selectedFile?.path === entry.path;

              return (
                <tr
                  key={entry.path}
                  onClick={() => onItemClick(entry)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenu({ x: e.clientX, y: e.clientY, entry });
                  }}
                  className={`cursor-pointer transition-colors ${
                    isSelected
                      ? "bg-blue-50 dark:bg-blue-900/20"
                      : "hover:bg-gray-50 dark:hover:bg-gray-700/30"
                  }`}
                >
                  {/* 图标 */}
                  <td className="px-4 py-2.5 text-center">
                    <span className="text-base">{getFileIcon(entry)}</span>
                  </td>

                  {/* 名称 */}
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span
                        className={`font-medium truncate max-w-xs ${
                          isSelected
                            ? "text-blue-700 dark:text-blue-300"
                            : "text-gray-900 dark:text-gray-100"
                        }`}
                        title={entry.name}
                      >
                        {entry.name}
                      </span>
                      {entry.type === "file" && entry.size === 0 && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
                          空
                        </span>
                      )}
                    </div>
                  </td>

                  {/* 类型 */}
                  <td className="px-4 py-2.5">
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {getFileTypeLabel(entry)}
                    </span>
                  </td>

                  {/* 大小 */}
                  <td className="px-4 py-2.5 text-right text-xs text-gray-500 dark:text-gray-400 font-mono">
                    {entry.type === "file" ? formatSize(entry.size) : "-"}
                  </td>

                  {/* 修改时间 */}
                  <td className="px-4 py-2.5 text-right text-xs text-gray-500 dark:text-gray-400">
                    {formatDate(entry.modified_at)}
                  </td>

                  {/* 操作按钮 */}
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {entry.type === "file" && (
                        <>
                          <ActionButton
                            label="预览"
                            icon="👁️"
                            onClick={(e) => {
                              e.stopPropagation();
                              onPreview(entry);
                            }}
                          />
                          <ActionButton
                            label="AI"
                            icon="🤖"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSendToAI(entry.path);
                            }}
                          />
                          <ActionButton
                            label="知识库"
                            icon="📚"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSaveToKnowledge(entry.path);
                            }}
                          />
                          <ActionButton
                            label="记忆"
                            icon="🧠"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSaveToMemory(entry.path);
                            }}
                          />
                        </>
                      )}
                      {entry.type === "directory" && (
                        <span className="text-xs text-gray-400 px-2">点击进入</span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      {/* 右键菜单 */}
      {contextMenu && (
        <>
          <div
            className="fixed inset-0 z-50"
            onClick={() => setContextMenu(null)}
          />
          <div
            className="fixed z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl py-1 min-w-[160px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <ContextMenuItem
              label="发送给 AI 分析"
              icon="🤖"
              onClick={() => {
                onSendToAI(contextMenu.entry.path);
                setContextMenu(null);
              }}
            />
            <ContextMenuItem
              label="存入知识库"
              icon="📚"
              onClick={() => {
                onSaveToKnowledge(contextMenu.entry.path);
                setContextMenu(null);
              }}
            />
            <ContextMenuItem
              label="存入记忆"
              icon="🧠"
              onClick={() => {
                onSaveToMemory(contextMenu.entry.path);
                setContextMenu(null);
              }}
            />
            <hr className="my-1 border-gray-200 dark:border-gray-700" />
            <ContextMenuItem
              label="复制路径"
              icon="📋"
              onClick={() => {
                navigator.clipboard.writeText(contextMenu.entry.path).catch(() => {});
                setContextMenu(null);
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}

/**
 * 表格操作按钮
 */
function ActionButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: string;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      onClick={onClick}
      className="px-1.5 py-1 text-xs rounded-md text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-200 transition-colors whitespace-nowrap"
      title={label}
    >
      {icon} {label}
    </button>
  );
}

/**
 * 右键菜单项
 */
function ContextMenuItem({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full px-3 py-1.5 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
    >
      <span>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

export default DetailedFileList;
