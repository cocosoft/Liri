/**
 * FileListViewer — 会话文件列表 + 文件预览
 *
 * 从 FilePreviewPanel 的 session Tab 抽取的纯内容组件。
 * 不包含 FilePreviewPanel 的 Tab 栏、拖拽、收起/展开（由 ChatInspector 主框架接管）。
 */

import { useCallback, useEffect } from "react";
import { useChatStore } from "../../stores/chat";
import { useShallow } from "zustand/shallow";
import FilePreviewContent from "../ChatArea/FilePreviewContent";
import FileTypeBadge from "../ChatArea/FileTypeBadge";
import type { FilePreview } from "../../types";

// ─── 子组件 ───────────────────────────────────────

/** 空状态 */
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full p-6 text-center">
      <svg
        className="w-12 h-12 text-gray-300 dark:text-gray-600 mb-3"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
        />
      </svg>
      <p className="text-sm text-gray-400 dark:text-gray-500">暂无文件</p>
      <p className="text-xs text-gray-300 dark:text-gray-600 mt-1">
        AI 会在需要时生成文件
      </p>
    </div>
  );
}

/** 文件列表（从 FilePreviewPanel 内部 FileList 抽取） */
function FileList({
  files,
  onSelect,
}: {
  files: FilePreview[];
  onSelect: (file: FilePreview) => void;
}) {
  if (files.length === 0) return null;

  const formatBytes = (bytes?: number) => {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="flex-1 overflow-y-auto p-2 space-y-1">
      {[...files].reverse().map((file) => (
        <button
          key={file.path}
          onClick={() => onSelect(file)}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors group"
        >
          <FileTypeBadge type={file.type} />
          <div className="flex-1 min-w-0">
            <div className="text-sm text-gray-700 dark:text-gray-300 truncate">
              {file.name}
            </div>
            <div className="text-xs text-gray-400 truncate">{file.path}</div>
          </div>
          {file.size && (
            <span className="text-xs text-gray-400 flex-shrink-0">
              {formatBytes(file.size)}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ─── 主组件 ───────────────────────────────────────

export default function FileListViewer() {
  const {
    previewFile,
    sessionFiles,
    readFileToPreview,
    setPreviewFile,
    clearSessionFiles,
  } = useChatStore(
    useShallow((s) => ({
      previewFile: s.previewFile,
      sessionFiles: s.sessionFiles,
      readFileToPreview: s.readFileToPreview,
      setPreviewFile: s.setPreviewFile,
      clearSessionFiles: s.clearSessionFiles,
    })),
  );

  const handleClose = useCallback(() => {
    setPreviewFile(null);
  }, [setPreviewFile]);

  const handleSelectFile = useCallback(
    (file: FilePreview) => {
      readFileToPreview(file.path);
    },
    [readFileToPreview],
  );

  // ESC 关闭预览
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && previewFile) {
        setPreviewFile(null);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [previewFile, setPreviewFile]);

  const hasFiles = sessionFiles.length > 0;

  // 文件预览视图
  if (previewFile) {
    return (
      <div className="flex flex-col h-full">
        {/* 预览头部 */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 text-sm">
            <button
              onClick={handleClose}
              className="p-1 text-gray-400 hover:text-blue-500 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
              title="返回文件列表"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </button>
            <FileTypeBadge type={previewFile.type} />
            <span className="text-gray-700 dark:text-gray-300 font-medium truncate">
              {previewFile.name}
            </span>
          </div>
        </div>
        {/* 预览内容 */}
        <div className="flex-1 overflow-hidden">
          <FilePreviewContent file={previewFile} onClose={handleClose} />
        </div>
      </div>
    );
  }

  // 文件列表视图
  if (hasFiles) {
    return (
      <div className="flex flex-col h-full">
        {/* 列表头部 */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <svg
              className="w-4 h-4 text-gray-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
              />
            </svg>
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
              会话文件 ({sessionFiles.length})
            </span>
          </div>
          <button
            onClick={clearSessionFiles}
            className="p-1 text-xs text-gray-400 hover:text-red-500 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
            title="清除文件列表"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
        </div>
        {/* 文件列表 */}
        <FileList files={sessionFiles} onSelect={handleSelectFile} />
      </div>
    );
  }

  // 空状态
  return <EmptyState />;
}
