/**
 * MasonryGallery — Phase 2 瀑布流画廊（零依赖，对标 Copilot）
 *
 * 核心策略：
 *   - CSS columns 实现瀑布流自适应列宽
 *   - IntersectionObserver 实现无限滚动
 *   - content-visibility: auto 内置渲染优化
 *   - video_card_margin 计算 uiAspectRatio 防止布局不齐
 */

import React, { useRef, useEffect, useState } from "react";
import type { GalleryItem } from "../../../stores/mediaStore";
import { ActionMenu } from "./ActionMenu";
import { getCachedThumb, generateAndCacheThumb } from "./thumbCache";

interface Props {
  items: GalleryItem[];
  selectedId: string | null;
  hasMore: boolean;
  loading: boolean;
  isDark: boolean;
  onSelect: (id: string) => void;
  onLoadMore: () => void;
}

/**
 * 带缩略图缓存的图片组件
 * 首次加载后缓存为 base64，后续访问直接读缓存
 */
const CachedImage: React.FC<{
  src: string;
  alt: string;
  aspectRatio: string;
  className?: string;
}> = ({ src, alt, aspectRatio, className }) => {
  const [imgSrc, setImgSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // 先查缓存
    const cached = getCachedThumb(src);
    if (cached) {
      setImgSrc(cached);
      return;
    }

    // 异步生成并缓存
    generateAndCacheThumb(src).then((dataUrl) => {
      if (!cancelled) setImgSrc(dataUrl);
    });

    return () => { cancelled = true; };
  }, [src]);

  return (
    <img
      src={imgSrc || src}
      alt={alt}
      loading={imgSrc ? undefined : "lazy"}
      className={className || "w-full"}
      style={{ aspectRatio }}
    />
  );
};

/**
 * 瀑布流画廊
 *
 * 使用 CSS columns 实现自动分列 + IntersectionObserver 实现触底加载
 */
export const MasonryGallery: React.FC<Props> = ({
  items,
  selectedId,
  hasMore,
  loading,
  isDark,
  onSelect,
  onLoadMore,
}) => {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const preventImmediateRef = useRef(false);

  // 无限滚动：观察 sentinel 触底
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
      { root: sentinel.parentElement, rootMargin: "200px" }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loading, onLoadMore]);

  return (
    <div className="h-full overflow-y-auto p-3">
      <div
        className="columns-2 md:columns-3 lg:columns-4"
        style={{ columnGap: 8 }}
      >
        {items.map((item) => {
          const selected = selectedId === item.id;
          const hovered = hoveredId === item.id;

          return (
            <div
              key={item.id}
              onClick={() => onSelect(item.id)}
              onMouseEnter={() => setHoveredId(item.id)}
              onMouseLeave={() => setHoveredId(null)}
              className="group relative mb-2 cursor-pointer overflow-hidden rounded-lg border-2 transition-all"
              style={{
                 breakInside: "avoid" as any,
                 contentVisibility: "auto",
                 containIntrinsicSize: "auto 200px",
                 borderColor: selected
                   ? "#3b82f6"
                   : hovered
                     ? isDark ? "#93c5fd" : "#93c5fd"
                     : "transparent",
                 boxShadow: selected ? "0 2px 8px rgba(59,130,246,0.3)" : "none",
               }}
            >
              {/* 媒体容器：padding-bottom 保持原生比例 */}
              <div className="relative w-full overflow-hidden bg-gray-100 dark:bg-gray-800">
                {item.type === "video" ? (
                  <video
                    src={item.url}
                    muted
                    loop
                    playsInline
                    className="w-full"
                    style={{ aspectRatio: "16/9" }}
                    onMouseEnter={(e) => e.currentTarget.play()}
                    onMouseLeave={(e) => {
                      e.currentTarget.pause();
                      e.currentTarget.currentTime = 0;
                    }}
                    preload="auto"
                    onLoadedData={(e) => {
                      // 加载完成后 seek 到第 0.1 秒抓取缩略图帧
                      const video = e.currentTarget as HTMLVideoElement;
                      video.currentTime = 0.1;
                    }}
                  />
                ) : (
                  <CachedImage
                    src={item.thumbnailUrl || item.url}
                    alt={item.alt || ""}
                    aspectRatio={
                      item.width && item.height
                        ? `${item.width}/${item.height}`
                        : "1/1"
                    }
                  />
                )}
              </div>

              {/* 视频时长标签 */}
              {item.type === "video" && item.duration && (
                <div className="pointer-events-none absolute bottom-1 left-1 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white">
                  <span>▶</span>
                  <span>{item.duration}s</span>
                </div>
              )}

              {/* 操作菜单（图片卡片） */}
              {item.type === "image" && (selected || hovered) && (
                <ActionMenu
                  itemId={item.id}
                  itemUrl={item.url}
                  itemType={item.type}
                  isDark={isDark}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* 触底哨兵 */}
      <div ref={sentinelRef} className="h-1" />

      {/* 加载指示器 */}
      {loading && (
        <div className="flex items-center justify-center py-4">
          <span className="text-xs text-gray-400">加载更多…</span>
        </div>
      )}
    </div>
  );
};
