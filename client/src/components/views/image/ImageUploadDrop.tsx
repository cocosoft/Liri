/**
 * ImageUploadDrop
 * 拖拽/点击上传图片（P2-8: XHR 进度条）
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { imageService } from "../../../services/imageService";

interface Props {
  onUploaded: (result: { path: string; url: string }) => void;
  accept?: string;
  disabled?: boolean;
}

const DEFAULT_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/bmp";

export default function ImageUploadDrop({
  onUploaded,
  accept,
  disabled,
}: Props) {
  const { t } = useTranslation();
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const doUpload = useCallback(
    async (file: File) => {
      setUploading(true);
      setProgress(0);
      setError(null);
      try {
        const result = await imageService.upload(file, (pct) =>
          setProgress(pct),
        );
        onUploaded(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("common.error"));
      } finally {
        setUploading(false);
      }
    },
    [onUploaded, t],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (!disabled && !uploading) setDragging(true);
    },
    [disabled, uploading],
  );

  const handleDragLeave = useCallback(() => setDragging(false), []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (disabled || uploading) return;
      const file = e.dataTransfer.files?.[0];
      if (!file) return;

      // 文件类型校验：仅接受图片
      if (!file.type.startsWith("image/")) {
        setError(t("image.invalidFileType"));
        return;
      }

      // 大小限制：超过 20MB 前端拦截
      const maxSize = 20 * 1024 * 1024;
      if (file.size > maxSize) {
        setError(t("image.fileTooLarge"));
        return;
      }

      doUpload(file);
    },
    [disabled, uploading, doUpload, t],
  );

  const handleClick = () => {
    if (!disabled && !uploading) inputRef.current?.click();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) doUpload(file);
    e.target.value = "";
  };

  // P1-1: Ctrl+V 剪贴板粘贴支持
  const handlePaste = useCallback(
    (e: ClipboardEvent) => {
      if (disabled || uploading) return;
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const blob = item.getAsFile();
          if (blob) {
            doUpload(blob);
            e.preventDefault();
            return;
          }
        }
      }
    },
    [disabled, uploading, doUpload],
  );

  useEffect(() => {
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [handlePaste]);

  return (
    <div>
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
        className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
          dragging
            ? "border-blue-400 bg-blue-400/10"
            : uploading
              ? "border-gray-600/30 bg-gray-800/20 cursor-not-allowed"
              : disabled
                ? "border-gray-700/30 bg-gray-800/20 cursor-not-allowed"
                : "border-gray-600/40 hover:border-gray-500/60"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept || DEFAULT_ACCEPT}
          onChange={handleChange}
          className="hidden"
          disabled={disabled || uploading}
        />
        {uploading ? (
          <div className="space-y-2">
            <div className="animate-pulse text-xs text-gray-400">
              {t("image.uploading")}...
            </div>
            <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-200 rounded-full"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="text-[9px] text-gray-500">{progress}%</div>
          </div>
        ) : (
          <>
            <svg
              className="w-8 h-8 mx-auto mb-1 opacity-50"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
            <p className="text-xs text-gray-400">
              {dragging ? t("image.dropHere") : t("image.dropOrClick")}
            </p>
          </>
        )}
      </div>

      {error && (
        <div className="mt-1 flex items-center gap-2">
          <span className="text-[10px] text-red-400">{error}</span>
          <button
            onClick={() => {
              setError(null);
            }}
            className="text-[10px] text-blue-400 hover:underline bg-transparent border-0 cursor-pointer"
          >
            {t("common.retry")}
          </button>
        </div>
      )}
    </div>
  );
}
