/**
 * ImageGallery
 * 历史图片网格 — 按时间倒序展示，点击放大
 */
import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import ImageViewer from "../../ChatArea/ImageViewer/ImageViewer";

interface ImageItem {
  path: string;
  url: string;
}

interface Props {
  images: ImageItem[];
  loading?: boolean;
  onRefresh?: () => void;
}

export default function ImageGallery({ images, loading, onRefresh }: Props) {
  const { t } = useTranslation();
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);

  const handleClick = useCallback((index: number) => {
    setViewerIndex(index);
    setViewerOpen(true);
  }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="aspect-square bg-gray-700/20 rounded animate-pulse" />
        ))}
      </div>
    );
  }

  if (images.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-500">
        <svg className="w-12 h-12 mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
        <p className="text-sm">{t("image.noImages")}</p>
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="mt-2 text-xs text-[#7aa2f7] hover:underline bg-transparent border-0 cursor-pointer"
          >
            {t("image.refresh")}
          </button>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {images.map((img, i) => (
          <button
            key={img.path}
            onClick={() => handleClick(i)}
            className="aspect-square bg-gray-800/50 rounded overflow-hidden border border-gray-700/30 hover:border-blue-500/40 cursor-pointer p-0 transition-colors"
          >
            <img
              src={img.url}
              alt={t("image.preview")}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          </button>
        ))}
      </div>

      {viewerOpen && (
        <ImageViewer
          images={images.map((img) => img.url)}
          initialIndex={viewerIndex}
          onClose={() => setViewerOpen(false)}
        />
      )}
    </>
  );
}
