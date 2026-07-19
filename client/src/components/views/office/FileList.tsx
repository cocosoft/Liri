/**
 * FileList — 文档列表组件
 * 虚拟滚动 + 搜索过滤 + 上传按钮 + hover 操作（重命名/删除）+ 拖拽
 */

import { useState, useMemo, useCallback } from "react";
import { List } from "react-window";
import { useTranslation } from "react-i18next";
import { useOfficeStore, type FileInfo } from "../../../stores/officeStore";
import { officeApi } from "../../../services/officeApi";

/** 虚拟滚动行高 */
const ROW_HEIGHT = 44;

/** 文件扩展名 → 图标映射 */
const FILE_ICONS: Record<string, string> = {
  docx: "📄",
  xlsx: "📊",
  pptx: "📽️",
  pdf: "📕",
  html: "🌐",
};

/** 根据扩展名获取图标 */
function getFileIcon(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return FILE_ICONS[ext] ?? "📁";
}

export function FileList() {
  const { t } = useTranslation();
  const {
    fileList,
    selectedFile,
    searchQuery,
    filterType,
    selectFile,
    setSearchQuery,
    setFilterType,
    setPreviewState,
    refreshFileList,
  } = useOfficeStore();

  const [hoveredFile, setHoveredFile] = useState<string | null>(null);
  const [renamingFile, setRenamingFile] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  /** 前端过滤：搜索 + 类型 */
  const filteredFiles = useMemo(() => {
    return fileList.filter((f) => {
      if (filterType !== "all" && !f.name.endsWith(`.${filterType}`)) {
        return false;
      }
      if (searchQuery && !f.name.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [fileList, searchQuery, filterType]);

  /** 文件拖拽开始 */
  const handleDragStart = useCallback(
    (e: React.DragEvent, file: FileInfo) => {
      e.dataTransfer.setData("text/plain", file.id);
      e.dataTransfer.effectAllowed = "move";
    },
    [],
  );

  /** 文件点击 → 预览 */
  const handleFileClick = useCallback(
    (file: FileInfo) => {
      selectFile(file);
      setPreviewState("loading");
    },
    [selectFile, setPreviewState],
  );

  /** 键盘导航 */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, file: FileInfo) => {
      if (e.key === "Enter") {
        handleFileClick(file);
      }
    },
    [handleFileClick],
  );

  /** 上传文件 */
  const handleUpload = useCallback(async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".docx,.xlsx,.pptx,.pdf,.doc,.xls,.ppt";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        await officeApi.uploadDoc(file);
        await refreshFileList();
      } catch {
        // 静默失败
      }
    };
    input.click();
  }, [refreshFileList]);

  /** 删除文件 */
  const handleDelete = useCallback(
    async (name: string) => {
      if (!window.confirm(t("office.confirmDelete", "确定要删除此文件吗？"))) return;
      try {
        await officeApi.deleteDoc(name);
        // 若当前预览此文件，清空预览
        if (selectedFile?.name === name) {
          selectFile(null);
        }
        await refreshFileList();
      } catch {
        // 静默失败
      }
    },
    [selectedFile, selectFile, refreshFileList, t],
  );

  /** 开始重命名 */
  const handleStartRename = useCallback((file: FileInfo) => {
    setRenamingFile(file.id);
    setRenameValue(file.name);
  }, []);

  /** 确认重命名 */
  const handleConfirmRename = useCallback(
    async (oldName: string) => {
      if (renameValue && renameValue !== oldName) {
        try {
          await officeApi.renameDoc(oldName, renameValue);
          await refreshFileList();
        } catch {
          // 静默失败
        }
      }
      setRenamingFile(null);
      setRenameValue("");
    },
    [renameValue, refreshFileList],
  );

  /** 格式化文件大小 */
  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  /** 单行渲染（react-window） */
  const Row = useCallback(
    ({ index, style }: { index: number; style: React.CSSProperties }) => {
      const file = filteredFiles[index];
      const isSelected = selectedFile?.id === file.id;
      const isHovered = hoveredFile === file.id;
      const isRenaming = renamingFile === file.id;

      return (
        <div
          style={style}
          draggable
          data-file-id={file.id}
          onDragStart={(e) => handleDragStart(e, file)}
          onClick={() => handleFileClick(file)}
          onKeyDown={(e) => handleKeyDown(e, file)}
          onMouseEnter={() => setHoveredFile(file.id)}
          onMouseLeave={() => setHoveredFile(null)}
          role="option"
          aria-selected={isSelected}
          tabIndex={0}
          className={`flex items-center gap-2 px-2 cursor-pointer outline-none
            ${isSelected ? "bg-blue-100 dark:bg-blue-900" : "hover:bg-gray-100 dark:hover:bg-gray-800"}
          `}
        >
          <span className="text-base flex-shrink-0" aria-hidden="true">
            {getFileIcon(file.name)}
          </span>

          {isRenaming ? (
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={() => handleConfirmRename(file.name)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleConfirmRename(file.name);
                if (e.key === "Escape") {
                  setRenamingFile(null);
                  setRenameValue("");
                }
              }}
              className="flex-1 text-sm px-1 py-0.5 border border-blue-400 rounded bg-white dark:bg-gray-800"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <>
              <span className="flex-1 text-sm truncate text-gray-900 dark:text-white">
                {file.name}
              </span>
              <span className="text-xs text-gray-400 flex-shrink-0">
                {formatSize(file.size)}
              </span>
            </>
          )}

          {/* hover 操作按钮 */}
          {isHovered && !isRenaming && (
            <div className="flex gap-1 flex-shrink-0">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleStartRename(file);
                }}
                className="px-1.5 py-0.5 text-xs rounded bg-gray-200 dark:bg-gray-700 
                  hover:bg-gray-300 dark:hover:bg-gray-600"
                title={t("office.rename", "重命名")}
                aria-label={t("office.rename", "重命名")}
              >
                ✏️
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(file.name);
                }}
                className="px-1.5 py-0.5 text-xs rounded bg-gray-200 dark:bg-gray-700 
                  hover:bg-red-200 dark:hover:bg-red-900"
                title={t("office.delete", "删除")}
                aria-label={t("office.delete", "删除")}
              >
                🗑️
              </button>
            </div>
          )}
        </div>
      );
    },
    [
      filteredFiles,
      selectedFile,
      hoveredFile,
      renamingFile,
      renameValue,
      handleDragStart,
      handleFileClick,
      handleKeyDown,
      handleStartRename,
      handleConfirmRename,
      handleDelete,
    ],
  );

  /** 过滤标签按钮 */
  const filterTypes: Array<{ key: string; label: string }> = [
    { key: "all", label: "全部" },
    { key: "docx", label: "📄 文档" },
    { key: "xlsx", label: "📊 表格" },
    { key: "pptx", label: "📽️ 演示" },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* 搜索框 + 过滤标签 */}
      <div className="px-2 space-y-2">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t("office.searchFiles", "搜索文件...")}
          aria-label={t("office.searchFiles", "搜索文件")}
          className="w-full px-2 py-1.5 text-sm border border-gray-200 dark:border-gray-700 
            rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white 
            placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
        />

        <div className="flex gap-1 flex-wrap">
          {filterTypes.map((ft) => (
            <button
              key={ft.key}
              onClick={() => setFilterType(ft.key)}
              className={`px-2 py-0.5 text-xs rounded-full transition-colors
                ${filterType === ft.key
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
                }
              `}
              aria-pressed={filterType === ft.key}
            >
              {ft.label}
            </button>
          ))}
        </div>

        {/* 上传按钮 */}
        <button
          onClick={handleUpload}
          className="w-full px-2 py-1.5 text-sm border border-dashed border-gray-300 
            dark:border-gray-600 rounded-lg text-gray-500 dark:text-gray-400 
            hover:border-blue-400 hover:text-blue-600 transition-colors"
          aria-label={t("office.uploadFile", "上传文件")}
        >
          + {t("office.uploadFile", "上传文件")}
        </button>
      </div>

      {/* 文件列表（虚拟滚动） */}
      <div className="flex-1 mt-2" role="listbox" aria-label={t("office.fileList", "文件列表")}>
        {filteredFiles.length === 0 ? (
          <p className="text-xs text-center text-gray-400 dark:text-gray-500 py-4">
            {searchQuery
              ? t("office.noSearchResults", "无匹配文件")
              : t("office.noFiles", "暂无文件")}
          </p>
        ) : (
          <div style={{ height: 300, width: "100%" }}>
            <List
              rowCount={filteredFiles.length}
              rowHeight={ROW_HEIGHT}
              rowComponent={Row as any}
              rowProps={{} as any}
            />
          </div>
        )}
      </div>
    </div>
  );
}
