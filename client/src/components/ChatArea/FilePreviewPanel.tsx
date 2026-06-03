import { useState, useCallback, useEffect } from "react";
import { useChatStore } from "../../stores/chatStore";
import FilePreviewContent from "./FilePreviewContent";
import type { FilePreview } from "../../types";

/**
 * 文件预览面板组件
 * 位于聊天界面右侧，用于预览会话中生成/修改的文件内容。
 * 支持折叠/展开，显示文件列表和预览区。
 */
function FilePreviewPanel() {
  const { previewFile, sessionFiles, setPreviewFile, clearSessionFiles } =
    useChatStore();
  const [isExpanded, setIsExpanded] = useState(true);

  const handleClose = useCallback(() => {
    setPreviewFile(null);
  }, [setPreviewFile]);

  const handleSelectFile = useCallback(
    (file: FilePreview) => {
      setPreviewFile(file);
    },
    [setPreviewFile],
  );

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && previewFile) {
        setPreviewFile(null);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [previewFile, setPreviewFile]);

  const emptyState = (
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
      <p className="text-sm text-gray-400 dark:text-gray-500">暂无生成的文件</p>
      <p className="text-xs text-gray-300 dark:text-gray-600 mt-1">
        AI 生成的文件将显示在此处
      </p>
    </div>
  );

  if (!isExpanded) {
    return (
      <div className="bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 transition-all duration-300 flex flex-col w-12">
        <div className="p-2 border-b border-gray-200 dark:border-gray-700 flex justify-center">
          <button
            onClick={() => setIsExpanded(true)}
            className="p-1 text-gray-400 hover:text-blue-500 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
            title="展开文件预览"
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
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>
        </div>
        <div className="flex-1 flex flex-col items-center py-2 gap-2">
          <svg
            className="w-5 h-5 text-gray-400"
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
          {sessionFiles.length > 0 && (
            <span className="text-xs text-gray-400">{sessionFiles.length}</span>
          )}
        </div>
      </div>
    );
  }

  const hasFiles = sessionFiles.length > 0;

  return (
    <div className="bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 transition-all duration-300 flex flex-col w-80">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
          文件预览
        </h3>
        <div className="flex items-center gap-1">
          {hasFiles && (
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
          )}
          <button
            onClick={() => setIsExpanded(false)}
            className="p-1 text-gray-400 hover:text-blue-500 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
            title="收起面板"
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
        </div>
      </div>

      {hasFiles && !previewFile && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <FileList files={sessionFiles} onSelect={handleSelectFile} />
        </div>
      )}

      {previewFile && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <FilePreviewContent file={previewFile} onClose={handleClose} />
        </div>
      )}

      {!hasFiles && !previewFile && emptyState}
    </div>
  );
}

interface FileListProps {
  files: FilePreview[];
  onSelect: (file: FilePreview) => void;
}

function FileList({ files, onSelect }: FileListProps) {
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

function FileTypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    code: "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
    markdown:
      "bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400",
    json: "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400",
    yaml: "bg-cyan-100 text-cyan-600 dark:bg-cyan-900/30 dark:text-cyan-400",
    image:
      "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400",
    text: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  };

  const labels: Record<string, string> = {
    code: "代码",
    markdown: "文档",
    json: "JSON",
    yaml: "YAML",
    image: "图片",
    text: "文本",
  };

  return (
    <span
      className={`flex-shrink-0 px-1.5 py-0.5 text-xs font-medium rounded ${colors[type] || colors.text}`}
    >
      {labels[type] || type}
    </span>
  );
}

export default FilePreviewPanel;
