/**
 * ImageGallery
 * 历史图片网格 — 无限滚动 + 点击放大（P2-7: IntersectionObserver 分页加载）
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import ImageViewer from "../../ChatArea/ImageViewer/ImageViewer";
import { imageService } from "../../../services/imageService";

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
  onLoadMore?: () => void;
  onRefresh?: () => void;
}

export default function ImageGallery({
  images,
  total,
  hasMore,
  loading,
  loadingMore,
  onLoadMore,
  onRefresh,
}: Props) {
  const { t } = useTranslation();
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
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
        />
      )}
    </>
  );
}

// ============================================================
// 带无限滚动的容器 Hook
// ============================================================

export function useImageGallery() {
  const [images, setImages] = useState<ImageItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const pageSize = 50;

  const loadInitial = useCallback(async () => {
    setLoading(true);
    try {
      const res = await imageService.listImages({ page: 1, pageSize });
      setImages(res.images);
      setTotal(res.total);
      setHasMore(res.hasMore);
      setPage(1);
    } catch {
      // 保留旧列表
    } finally {
      setLoading(false);
    }
  }, []);

  // 初始加载
  const initializedRef = useRef(false);
  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      loadInitial();
    }
  }, [loadInitial]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const nextPage = page + 1;
      const res = await imageService.listImages({ page: nextPage, pageSize });
      setImages((prev) => [...prev, ...res.images]);
      setTotal(res.total);
      setHasMore(res.hasMore);
      setPage(nextPage);
    } finally {
      setLoadingMore(false);
    }
  }, [page, pageSize, hasMore, loadingMore]);

  return {
    images,
    total,
    hasMore,
    loading,
    loadingMore,
    loadMore,
    refresh: loadInitial,
  } as const;
}
