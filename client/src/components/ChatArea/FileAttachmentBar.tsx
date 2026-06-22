import { useRef, useCallback, useState } from "react";
import { readFileAsBase64 } from "../../utils/fileUtils";

interface FileAttachment {
  name: string;
  size: number;
  data: string;
}

interface FileAttachmentBarProps {
  /** 当前附件列表 */
  attachments: FileAttachment[];
  /** 更新附件列表 */
  onAttachmentsChange: (attachments: FileAttachment[]) => void;
  /** 是否禁用文件上传 */
  disabled?: boolean;
}

const MAX_FILE_SIZE = 20 * 1024 * 1024;

/**
 * FileAttachmentBar — 聊天输入框的附件管理栏
 *
 * 负责文件选择、拖拽上传、附件列表展示和移除。
 * 不包含发送逻辑，仅管理附件状态。
 */
export default function FileAttachmentBar({
  attachments,
  onAttachmentsChange,
  disabled,
}: FileAttachmentBarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  /**
   * 格式化文件大小为人类可读格式
   */
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  /**
   * 处理文件选择
   */
  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files) return;

      const newAttachments: FileAttachment[] = [];
      for (const file of Array.from(files)) {
        if (file.size > MAX_FILE_SIZE) {
          alert(`文件 "${file.name}" 超过 20MB 限制，已跳过`);
          continue;
        }
        try {
          const data = await readFileAsBase64(file);
          newAttachments.push({ name: file.name, size: file.size, data });
        } catch {
          alert(`读取文件 "${file.name}" 失败`);
        }
      }
      onAttachmentsChange([...attachments, ...newAttachments]);
      e.target.value = "";
    },
    [attachments, onAttachmentsChange],
  );

  /**
   * 移除附件
   */
  const handleRemoveFile = useCallback(
    (index: number) => {
      onAttachmentsChange(attachments.filter((_, i) => i !== index));
    },
    [attachments, onAttachmentsChange],
  );

  /**
   * 处理拖拽文件
   */
  const handleFileDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;

      const processFiles = async () => {
        const newAttachments: FileAttachment[] = [];
        for (const file of files) {
          if (file.size > MAX_FILE_SIZE) {
            alert(`文件 "${file.name}" 超过 20MB 限制，已跳过`);
            continue;
          }
          try {
            const data = await readFileAsBase64(file);
            newAttachments.push({ name: file.name, size: file.size, data });
          } catch {
            alert(`读取文件 "${file.name}" 失败`);
          }
        }
        onAttachmentsChange([...attachments, ...newAttachments]);
      };
      processFiles();
    },
    [attachments, onAttachmentsChange],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  return (
    <div
      onDrop={handleFileDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {/* 工具栏按钮 */}
      <div className="flex items-center gap-1 mb-2">
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:text-gray-300 dark:disabled:text-gray-600 rounded-lg transition-colors"
          title="上传文件"
          aria-label="上传文件"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />
        <div className="flex-1" />
      </div>

      {/* 附件列表 */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {attachments.map((file, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg text-sm text-blue-700 dark:text-blue-300"
            >
              <span className="w-6 h-6 bg-blue-100 dark:bg-blue-800 rounded flex items-center justify-center text-xs">
                📄
              </span>
              <span className="truncate max-w-[120px]">{file.name}</span>
              <span className="text-blue-400 dark:text-blue-500 text-xs">
                ({formatFileSize(file.size)})
              </span>
              <button
                onClick={() => handleRemoveFile(i)}
                className="ml-1 p-0.5 hover:bg-blue-200 dark:hover:bg-blue-800 rounded transition-colors"
                title="移除"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      {/* 拖拽提示 */}
      {isDragOver && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-white dark:bg-gray-800 border-2 border-dashed border-blue-400 px-6 py-3 rounded-xl shadow-lg">
            <span className="text-blue-500 font-medium">放开放置文件</span>
          </div>
        </div>
      )}
    </div>
  );
}
