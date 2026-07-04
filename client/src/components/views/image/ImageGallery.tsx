/**
 * ImageGallery
 * 历史图片网格 — 无限滚动 + 点击放大（P2-7: IntersectionObserver 分页加载）
 */
import { useState, useEffect, useCallback, useRef, memo } from "react";
import { useTranslation } from "react-i18next";
import ImageViewer from "../../ChatArea/ImageViewer/ImageViewer";

interface ImageItem {
  path: string;
  url: string;
}

interface Props {
  images: ImageItem[];
  total?: number;
  hasMore?: boolean;
  loading?: boolean;
  loadingMore?: boolean;
  loadError?: boolean;
  onLoadMore?: () => void;
  onRefresh?: () => void;
  /** 是否启用选用模式（当左侧工具有 inputPath 需求时） */
  selectable?: boolean;
  /** 选用回调（点击「选用」按钮时触发） */
  onSelect?: (path: string) => void;
  /** 删除回调 */
  onDelete?: (path: string) => void;
}

export default memo(ImageGallery);

function ImageGallery({
  images,
  total,
  hasMore,
  loading,
  loadingMore,
  loadError,
  onLoadMore,
  onRefresh,
  selectable,
   onSelect,
   onDelete,
 }: Props) {
  const { t } = useTranslation();
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // IntersectionObserver 监听哨兵，触发加载更多
  useEffect(() => {
    if (!hasMore || !onLoadMore) return;
    const el = sentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loadingMore) {
          onLoadMore();
        }
      },
      { rootMargin: "100px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, onLoadMore, loadingMore]);

  const handleClick = useCallback((index: number) => {
    setViewerIndex(index);
    setViewerOpen(true);
  }, []);

  if (loading && images.length === 0) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3" style={{ contentVisibility: "auto", containIntrinsicSize: "auto 200px" }}>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="aspect-square bg-gray-700/20 rounded animate-pulse" />
        ))}
      </div>
    );
  }

  if (loadError && images.length === 0 && onRefresh) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-500">
        <p className="text-sm mb-3">{t("image.loadFailed")}</p>
        <button
          onClick={() => { onRefresh(); }}
          className="px-3 py-1 rounded text-xs bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 border-0 cursor-pointer"
        >
          {t("common.retry")}
        </button>
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
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3" style={{ contentVisibility: "auto", containIntrinsicSize: "auto 200px" }}>
        {images.map((img, i) => (
          <div key={img.path} className="relative group">
            <button
              onClick={() => handleClick(i)}
              className="aspect-square bg-gray-800/50 rounded overflow-hidden border border-gray-700/30 hover:border-blue-500/40 cursor-pointer p-0 transition-colors w-full"
            >
              <img
                src={img.url}
                alt={t("image.preview")}
                className="w-full h-full object-cover"
                loading="lazy"
                onError={(e) => {
                  // 图片加载失败显示占位色块
                  const target = e.currentTarget;
                  target.style.display = "none";
                  target.parentElement!.style.background = "rgba(128,128,128,0.1)";
                  target.parentElement!.innerHTML = '<span style="font-size:20px;opacity:0.3">🖼</span>';
                  target.parentElement!.style.display = "flex";
                  target.parentElement!.style.alignItems = "center";
                  target.parentElement!.style.justifyContent = "center";
                }}
              />
            </button>

            {/* 操作按钮 — 悬浮时显示 */}
            <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {/* 选用按钮 */}
              {selectable && onSelect && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(img.path);
                    setSelectedImage(img.path);
                    setTimeout(() => setSelectedImage(null), 3000);
                  }}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium border-0 cursor-pointer ${
                    selectedImage === img.path
                      ? "bg-green-500/80 text-white"
                      : "bg-blue-500/80 text-white hover:bg-blue-500"
                  }`}
                >
                  {selectedImage === img.path ? "✔ 已选用" : "📷 选用"}
                </button>
              )}

              {/* 删除按钮 */}
              {onDelete && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(t("image.deleteConfirm"))) {
                      onDelete(img.path);
                    }
                  }}
                  className="px-1.5 py-0.5 rounded text-[10px] font-medium border-0 cursor-pointer bg-red-500/70 text-white hover:bg-red-500"
                >
                  🗑
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* 分页信息 + 加载更多哨兵 */}
      <div ref={sentinelRef} className="flex items-center justify-center py-4">
        {loadingMore ? (
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <div className="w-3 h-3 border border-gray-500 border-t-transparent rounded-full animate-spin" />
            {t("image.loading")}
          </div>
        ) : hasMore ? (
          <span className="text-[10px] text-gray-600">
            {total && `${total - images.length} ${t("image.moreRemaining")}`}
          </span>
        ) : (
          total !== undefined && total > 0 && (
            <span className="text-[10px] text-gray-600">
              {total} {t("image.total")}
            </span>
          )
        )}
      </div>

      {viewerOpen && (
        <ImageViewer
          images={images.map((img) => img.url)}
          initialIndex={viewerIndex}
          onClose={() => setViewerOpen(false)}
          onDelete={
            onDelete
              ? () => {
                  const img = images[viewerIndex];
                  if (img && confirm(t("image.deleteConfirm"))) {
                    onDelete(img.path);
                    setViewerOpen(false);
                  }
                }
              : undefined
          }
        />
      )}
    </>
  );
}
