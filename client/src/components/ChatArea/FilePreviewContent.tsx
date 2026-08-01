import { useState, useCallback } from "react";
import type { FilePreview } from "../../types";
import MarkdownRenderer from "./MarkdownRenderer";
import CodeBlock from "./CodeBlock";
import FileTypeIcon from "./FileTypeIcon";
import OfficePreview from "./OfficePreview";
import { formatFileSize } from "../../utils/formatFileSize";
import { handleClientError } from "../../utils/handleError";

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

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  // 加载态：content 为空时显示骨架屏（异步读取文件内容期间）
  // 音视频文件 content 始终为空（通过 staticUrl 播放），不触发加载态
  if (!file.content && !file.staticUrl) {
    // 图片加载态
    if (file.type === "image") {
      return (
        <div className="flex flex-col h-full">
          <FileHeader file={file} onClose={handleClose} />
          <div className="flex-1 p-4">
            <div className="w-full h-48 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
          </div>
        </div>
      );
    }
    // 文本/代码/Office 加载态：骨架屏模拟代码块
    return (
      <div className="flex flex-col h-full">
        <FileHeader file={file} onClose={handleClose} />
        <div className="flex-1 p-4 space-y-2">
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-3/4" />
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-1/2" />
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-5/6" />
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-2/3" />
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-1/2" />
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-3/4" />
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-1/3" />
          <div className="pt-3">
            <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
              加载中...
            </p>
          </div>
        </div>
      </div>
    );
  }

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
                {formatFileSize(file.size)}
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
        <FileHeader file={file} onClose={handleClose} />
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
        <FileHeader file={file} onClose={handleClose} />
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
        <FileHeader file={file} onClose={handleClose} />
        <div className="flex-1 overflow-auto p-4 prose dark:prose-invert max-w-none">
          <MarkdownRenderer content={file.content} />
        </div>
      </div>
    );
  }

  if (file.type === "yaml") {
    return (
      <div className="flex flex-col h-full">
        <FileHeader file={file} onClose={handleClose} />
        <div className="flex-1 overflow-auto p-4">
          <pre className="text-sm font-mono leading-relaxed text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
            <code>{file.content}</code>
          </pre>
        </div>
      </div>
    );
  }

  // 音频文件：使用 <audio> 标签播放
  if (file.type === "audio") {
    return (
      <div className="flex flex-col h-full">
        <FileHeader file={file} onClose={handleClose} />
        <div className="flex-1 flex items-center justify-center p-4 bg-gray-50 dark:bg-gray-900">
          <div className="w-full max-w-md">
            <audio
              controls
              src={file.staticUrl}
              className="w-full"
              preload="metadata"
            >
              <p>您的浏览器不支持音频播放</p>
            </audio>
          </div>
        </div>
      </div>
    );
  }

  // 视频文件：使用 <video> 标签播放
  if (file.type === "video") {
    return (
      <div className="flex flex-col h-full">
        <FileHeader file={file} onClose={handleClose} />
        <div className="flex-1 flex items-center justify-center bg-black">
          <video
            controls
            src={file.staticUrl}
            className="max-w-full max-h-full"
            preload="metadata"
          >
            <p>您的浏览器不支持视频播放</p>
          </video>
        </div>
      </div>
    );
  }

  // Office 文件客户端直渲（docx/xlsx/pptx）：使用 mammoth/SheetJS/pptx-viewer
  if (file.type === "docx" || file.type === "xlsx" || file.type === "pptx") {
    return (
      <div className="flex flex-col h-full">
        <FileHeader file={file} onClose={handleClose} />
        <OfficePreview file={file} />
      </div>
    );
  }

  // PDF：内容由后端转换为 Markdown，使用 MarkdownRenderer 渲染
  if (file.type === "pdf") {
    return (
      <div className="flex flex-col h-full">
        <FileHeader file={file} onClose={handleClose} />
        <div className="flex-1 overflow-auto p-4 prose dark:prose-invert max-w-none">
          <MarkdownRenderer content={file.content} />
        </div>
      </div>
    );
  }

  // 不支持的格式：显示文件元信息
  if (file.type === "unsupported") {
    return (
      <div className="flex flex-col h-full">
        <FileHeader file={file} onClose={handleClose} />
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center">
            <svg
              className="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-600"
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
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
              暂不支持预览此格式
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {file.name}
              {file.size
                ? ` · ${file.size >= 1024 ? `${(file.size / 1024).toFixed(1)} KB` : `${file.size} B`}`
                : ""}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <FileHeader file={file} onClose={handleClose} />
      <div className="flex-1 overflow-auto">
        <CodeBlock language={file.language || "text"} code={file.content} />
      </div>
    </div>
  );
}

interface FileHeaderProps {
  file: FilePreview;
  onClose: () => void;
}

function FileHeader({ file, onClose }: FileHeaderProps) {
  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
      <div className="flex items-center gap-2 min-w-0">
        <FileTypeIcon type={file.type} />
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">
          {file.name}
        </span>
        {file.size && (
          <span className="text-xs text-gray-400 flex-shrink-0">
            {formatFileSize(file.size)}
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

function PrettyJson({ content }: { content: string }) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    handleClientError(e, {
      module: "components:chat:FilePreview",
      action: "parseJson",
    });
    return <code>{content}</code>;
  }

  const formatted = JSON.stringify(parsed, null, 2);

  return <code>{formatted}</code>;
}

export default FilePreviewContent;
