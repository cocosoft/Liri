/**
 * ClickableImageRef — 可点击的图片引用组件
 *
 * 在聊天消息中显示图片引用链接，点击可预览大图。
 * 参照 cc_code ClickableImageRef.tsx
 */
import { useState } from 'react';

interface ClickableImageRefProps {
  /** 图片 URL */
  src: string;
  /** 替代文本 */
  alt?: string;
  /** 缩略图宽度 */
  thumbWidth?: number;
  /** 缩略图高度 */
  thumbHeight?: number;
}

export function ClickableImageRef({
  src,
  alt = '图片',
  thumbWidth: _thumbWidth = 200,
  thumbHeight: _thumbHeight = 200,
}: ClickableImageRefProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <span
        className="inline-flex items-center gap-1 cursor-pointer text-blue-500 hover:text-blue-400 underline"
        onClick={() => setIsOpen(true)}
        title="点击查看大图"
      >
        🖼 {alt}
      </span>

      {/* 大图预览模态框 */}
      {isOpen && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="relative max-w-[90vw] max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={src}
              alt={alt}
              className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
            />
            <button
              className="absolute top-2 right-2 w-8 h-8 flex items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 text-lg"
              onClick={() => setIsOpen(false)}
              title="关闭"
            >
              ×
            </button>
            {alt && (
              <p className="text-center text-sm text-gray-300 mt-2">{alt}</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
