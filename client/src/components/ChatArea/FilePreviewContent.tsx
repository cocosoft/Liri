import { useState, useCallback } from "react";
import type { FilePreview } from "../../types";
import MarkdownRenderer from "./MarkdownRenderer";
import CodeBlock from "./CodeBlock";

interface FilePreviewContentProps {
  file: FilePreview;
  onClose: () => void;
}

/**
 * 文件内容预览组件
 * 根据文件类型选择不同的渲染方式：
 * - code: 语法高亮 (复用 CodeBlock)
 * - markdown: Markdown 渲染 (复用 MarkdownRenderer)
 * - json: 格式化 JSON
 * - yaml: 语法高亮展示
 * - image: 图片直接显示
 * - text: 纯文本
 */
function FilePreviewContent({ file, onClose }: FilePreviewContentProps) {
  const [imageError, setImageError] = useState(false);

  const formatBytes = useCallback((bytes?: number) => {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }, []);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  if (file.type === "image" && !imageError) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
          <div className="flex items-center gap-2 min-w-0">
            <svg
              className="w-4 h-4 flex-shrink-0 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">
              {file.name}
            </span>
            {file.size && (
              <span className="text-xs text-gray-400 flex-shrink-0">
                {formatBytes(file.size)}
              </span>
            )}
          </div>
          <button
            onClick={handleClose}
            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            title="关闭预览"
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
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4 bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
          <img
            src={file.content}
            alt={file.name}
            className="max-w-full max-h-full object-contain rounded shadow-sm"
            onError={() => setImageError(true)}
          />
        </div>
      </div>
    );
  }

  if (file.type === "image" && imageError) {
    return (
      <div className="flex flex-col h-full">
        <FileHeader
          file={file}
          onClose={handleClose}
          formatBytes={formatBytes}
        />
        <div className="flex-1 flex items-center justify-center p-8 text-gray-400 dark:text-gray-500">
          <div className="text-center">
            <svg
              className="w-12 h-12 mx-auto mb-2"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
              />
            </svg>
            <p className="text-sm">图片加载失败</p>
          </div>
        </div>
      </div>
    );
  }

  if (file.type === "json") {
    return (
      <div className="flex flex-col h-full">
        <FileHeader
          file={file}
          onClose={handleClose}
          formatBytes={formatBytes}
        />
        <div className="flex-1 overflow-auto p-4">
          <pre className="text-sm font-mono leading-relaxed text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
            <PrettyJson content={file.content} />
          </pre>
        </div>
      </div>
    );
  }

  if (file.type === "markdown") {
    return (
      <div className="flex flex-col h-full">
        <FileHeader
          file={file}
          onClose={handleClose}
          formatBytes={formatBytes}
        />
        <div className="flex-1 overflow-auto p-4 prose dark:prose-invert max-w-none">
          <MarkdownRenderer content={file.content} />
        </div>
      </div>
    );
  }

  if (file.type === "yaml") {
    return (
      <div className="flex flex-col h-full">
        <FileHeader
          file={file}
          onClose={handleClose}
          formatBytes={formatBytes}
        />
        <div className="flex-1 overflow-auto p-4">
          <pre className="text-sm font-mono leading-relaxed text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
            <code>{file.content}</code>
          </pre>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <FileHeader file={file} onClose={handleClose} formatBytes={formatBytes} />
      <div className="flex-1 overflow-auto">
        <CodeBlock language={file.language || "text"} code={file.content} />
      </div>
    </div>
  );
}

interface FileHeaderProps {
  file: FilePreview;
  onClose: () => void;
  formatBytes: (bytes?: number) => string;
}

function FileHeader({ file, onClose, formatBytes }: FileHeaderProps) {
  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
      <div className="flex items-center gap-2 min-w-0">
        <FileTypeIcon type={file.type} />
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">
          {file.name}
        </span>
        {file.size && (
          <span className="text-xs text-gray-400 flex-shrink-0">
            {formatBytes(file.size)}
          </span>
        )}
      </div>
      <button
        onClick={onClose}
        className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
        title="关闭预览"
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
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </div>
  );
}

function FileTypeIcon({ type }: { type: string }) {
  const icons: Record<string, React.ReactNode> = {
    code: (
      <svg
        className="w-4 h-4 text-blue-500"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
        />
      </svg>
    ),
    markdown: (
      <svg
        className="w-4 h-4 text-purple-500"
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
    ),
    json: (
      <svg
        className="w-4 h-4 text-amber-500"
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
    ),
    image: (
      <svg
        className="w-4 h-4 text-green-500"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
        />
      </svg>
    ),
    yaml: (
      <svg
        className="w-4 h-4 text-cyan-500"
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
    ),
    text: (
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
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        />
      </svg>
    ),
  };

  return <span className="flex-shrink-0">{icons[type] || icons.text}</span>;
}

function PrettyJson({ content }: { content: string }) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return <code>{content}</code>;
  }

  const formatted = JSON.stringify(parsed, null, 2);

  return <code>{formatted}</code>;
}

export default FilePreviewContent;
