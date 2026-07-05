/**
 * useImageGallery
 * 图库无限滚动容器 Hook
 *
 * 从 ImageGallery.tsx 分离，独立管理图库状态。
 * ImagePage 使用此 hook 获取数据，ImageGallery 组件通过 props 接收。
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { imageService } from "../../../services/imageService";

interface ImageItem {
  path: string;
  url: string;
}

export function useImageGallery() {
  const [images, setImages] = useState<ImageItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const pageSize = 50;
  const abortRef = useRef<AbortController | null>(null);

  // 组件卸载时 abort 所有进行中的请求
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const loadInitial = useCallback(async () => {
    // 取消上一个请求
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setLoading(true);
    setLoadError(false);
    try {
      const res = await imageService.listImages({ page: 1, pageSize, signal: abortRef.current.signal });
      setImages(res.images);
      setTotal(res.total);
      setHasMore(res.hasMore);
      setPage(1);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // 监听聊天中生图完成事件，自动刷新图库
  useEffect(() => {
    const handler = () => {
      loadInitial();
    };
    window.addEventListener("pyapp:image_generated", handler);
    return () => {
      window.removeEventListener("pyapp:image_generated", handler);
    };
  }, [loadInitial]);

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
      const res = await imageService.listImages({ page: nextPage, pageSize, signal: abortRef.current?.signal });
      setImages((prev) => [...prev, ...res.images]);
      setTotal(res.total);
      setHasMore(res.hasMore);
      setPage(nextPage);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return;
    } finally {
      setLoadingMore(false);
    }
  }, [page, pageSize, hasMore, loadingMore]);

  const prepend = useCallback((newImages: ImageItem[]) => {
    setImages((prev) => [...newImages, ...prev]);
    setTotal((t) => t + newImages.length);
  }, []);

  return {
    images,
    total,
    hasMore,
    loading,
    loadingMore,
    loadError,
    loadMore,
    refresh: loadInitial,
    prepend,
  } as const;
}
