import { useEffect, useRef } from "react";

/**
 * useInfiniteScroll — 共享无限滚动 hook（CS01 复用）
 *
 * 基于 IntersectionObserver 观察触底哨兵，进入视口且 hasMore 时触发 onLoadMore。
 * MasonryGallery / GridView 共用，避免双份滚动逻辑漂移。
 */
export function useInfiniteScroll(
  sentinelRef: React.RefObject<HTMLDivElement | null>,
  hasMore: boolean,
  loading: boolean,
  onLoadMore: () => void,
): void {
  const preventImmediateRef = useRef(false);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;

    // loading → false 时短暂冷却，防止 observer 重建后立即触发
    if (preventImmediateRef.current) {
      const timer = setTimeout(() => {
        preventImmediateRef.current = false;
      }, 300);
      return () => clearTimeout(timer);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading) {
          preventImmediateRef.current = true;
          onLoadMore();
        }
      },
      { root: sentinel.parentElement, rootMargin: "200px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loading, onLoadMore, sentinelRef]);
}
