import {
  useRef,
  useCallback,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import { readFileAsBase64 } from "../../utils/fileUtils";
import { handleClientError } from "../../utils/handleError";

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

/** 暴露给父组件的方法 */
export interface FileAttachmentBarHandle {
  triggerFileInput: () => void;
}

const MAX_FILE_SIZE = 20 * 1024 * 1024;

/**
 * FileAttachmentBar — 聊天输入框的附件管理栏
 *
 * 负责文件拖拽上传、附件列表展示和移除。
 * 上传按钮已移至父组件（ChatInput）的统一「+」菜单中，
 * 通过 ref.triggerFileInput() 触发文件选择。
 */
const FileAttachmentBar = forwardRef<
  FileAttachmentBarHandle,
  FileAttachmentBarProps
>(function FileAttachmentBar(
  { attachments, onAttachmentsChange, disabled: _disabled },
  ref,
) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  /** 暴露 triggerFileInput 给父组件的统一「+」菜单调用 */
  useImperativeHandle(ref, () => ({
    triggerFileInput: () => {
      fileInputRef.current?.click();
    },
  }));

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
        } catch (e) {
          handleClientError(e, { module: "components:chat:FileAttachmentBar", action: "handleFileSelect" });
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
          } catch (e) {
            handleClientError(e, { module: "components:chat:FileAttachmentBar", action: "handleFileDrop" });
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
      {/* 隐藏的文件选择输入（由父组件统一「+」菜单触发） */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileSelect}
      />

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
});

export default FileAttachmentBar;
