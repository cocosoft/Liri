/**
 * ImageUploadDrop
 * 拖拽/点击上传图片区域
 */
import { useState, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  onFileSelect: (file: File) => void;
  accept?: string;
  disabled?: boolean;
}

const DEFAULT_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/bmp";

export default function ImageUploadDrop({ onFileSelect, accept, disabled }: Props) {
  const { t } = useTranslation();
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) setDragging(true);
  }, [disabled]);

  const handleDragLeave = useCallback(() => setDragging(false), []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("image/")) onFileSelect(file);
  }, [disabled, onFileSelect]);

  const handleClick = () => {
    if (!disabled) inputRef.current?.click();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onFileSelect(file);
    e.target.value = "";
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
      className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
        dragging
          ? "border-blue-400 bg-blue-400/10"
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
        disabled={disabled}
      />
      <svg className="w-8 h-8 mx-auto mb-1 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
      </svg>
      <p className="text-xs text-gray-400">
        {dragging ? t("image.dropHere") : t("image.dropOrClick")}
      </p>
    </div>
  );
}
