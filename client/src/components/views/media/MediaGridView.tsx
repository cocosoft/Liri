/**
 * MediaGridView — 媒体画廊的网格列表视图
 *
 * 由 `views/MediaPage.tsx` 外迁（大文件拆分，见
 * `.trae/specs/file-size-debt-partition-plan.md` §38）。**只搬不改**：逻辑逐字保留，
 * 仅组件名 `GridView` → `MediaGridView`（导出名需可辨识）。
 */

import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { type GalleryItem } from "../../../stores/mediaStore";
import { useInfiniteScroll } from "../../../hooks/useInfiniteScroll";
import { ActionMenu } from "./ActionMenu";
import { extractDate, extractFileName } from "./mediaUtils";

/** 网格列表视图 */
export const MediaGridView: React.FC<{
  items: GalleryItem[];
  selectedId: string | null;
  isDark: boolean;
  onSelect: (id: string) => void;
  batchMode?: boolean;
  selectedIds?: Set<string> | null;
  favoriteIds?: Set<string> | null;
  onToggleFavorite?: (id: string) => void;
  onDragStart?: (e: React.DragEvent, item: GalleryItem) => void;
  onCompareToggle?: (id: string) => void;
  /** P0-3（2026-08-26）：右键菜单触发点 */
  onContextMenu?: (e: React.MouseEvent, item: GalleryItem) => void;
  /** P0-4（2026-08-26）：无限滚动分页 */
  hasMore?: boolean;
  loading?: boolean;
  onLoadMore?: () => void;
  /** 编辑锁：true 时禁用点击（与 MasonryGallery 一致） */
  disabled?: boolean;
}> = ({
  items,
  selectedId,
  isDark,
  onSelect,
  batchMode,
  selectedIds,
  favoriteIds,
  onToggleFavorite,
  onDragStart,
  onCompareToggle,
  onContextMenu,
  hasMore = false,
  loading = false,
  onLoadMore,
  disabled = false,
}) => {
  const { t } = useTranslation();
  const sentinelRef = useRef<HTMLDivElement>(null);
  // P0-4：复用共享无限滚动 hook（与 MasonryGallery 一致）
  useInfiniteScroll(sentinelRef, hasMore, loading, onLoadMore ?? (() => {}));

  return (
    <div className="h-full overflow-y-auto p-3">
      {/* P2（2026-08-26）：响应式列数，替代固定 3 列 */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((item) => {
          const selected = batchMode
            ? selectedIds?.has(item.id)
            : selectedId === item.id;
          const isFav = favoriteIds?.has(item.id);
          const fileName = extractFileName(item.url);
          const fileDate = extractDate(item.url);

          return (
            <div
              key={item.id}
              data-media-id={item.id}
              onClick={() => !disabled && onSelect(item.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                onContextMenu?.(e, item);
              }}
              draggable={item.type === "image"}
              onDragStart={(e) => onDragStart?.(e, item)}
              className={`group relative cursor-pointer rounded-lg border-2 p-1.5 transition-all ${
                selected
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                  : isDark
                    ? "border-gray-700 bg-gray-800 hover:border-gray-500"
                    : "border-gray-200 bg-white hover:border-gray-400"
              }`}
              style={{
                contentVisibility: "auto",
                containIntrinsicSize: "auto 150px",
              }}
            >
              {/* 批量选择复选框 */}
              {batchMode && (
                <div className="absolute left-1.5 top-1.5 z-10">
                  <input
                    type="checkbox"
                    checked={selected || false}
                    onChange={() => onSelect(item.id)}
                    className="h-3.5 w-3.5 accent-blue-500"
                  />
                </div>
              )}

              {/* 收藏星标 + 对比按钮 */}
              {!batchMode && (
                <div className="absolute right-1 top-1 z-10 flex gap-0.5">
                  {onToggleFavorite && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleFavorite(item.id);
                      }}
                      className={`rounded bg-black/30 p-0.5 text-[10px] transition-colors hover:bg-black/50 ${
                        isFav ? "text-yellow-400" : "text-white/60"
                      }`}
                      title={
                        isFav ? t("media.unfavorite") : t("media.favorite")
                      }
                    >
                      {isFav ? "★" : "☆"}
                    </button>
                  )}
                  {onCompareToggle && item.type === "image" && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onCompareToggle(item.id);
                      }}
                      className="rounded bg-black/30 p-0.5 text-[10px] text-white/60 transition-colors hover:bg-black/50"
                      title={t("media.addToCompare")}
                    >
                      ◧
                    </button>
                  )}
                </div>
              )}

              {/* 操作菜单（MD-6：网格视图原先**完全不渲染** ActionMenu ⇒ 图片的
                  编辑/图生视频/下载/删除不可达、视频无菜单）。下移 24px 避让右上角
                  「收藏/对比」按钮；卡片已加 `group` 以支持 hover 显隐。 */}
              {!batchMode && (
                <div className="absolute right-1 top-7 h-6 w-6">
                  <ActionMenu
                    itemId={item.id}
                    itemUrl={item.url}
                    itemType={item.type}
                    isDark={isDark}
                  />
                </div>
              )}

              {/* 缩略图 */}
              <div className="mb-1 aspect-square overflow-hidden rounded bg-gray-100 dark:bg-gray-700">
                {item.type === "video" ? (
                  <video
                    src={item.url}
                    poster={item.thumbnailUrl}
                    muted
                    preload="metadata"
                    className="h-full w-full object-cover"
                    onMouseEnter={(e) => e.currentTarget.play()}
                    onMouseLeave={(e) => {
                      e.currentTarget.pause();
                      e.currentTarget.currentTime = 0;
                    }}
                  />
                ) : (
                  <img
                    src={item.thumbnailUrl || item.url}
                    alt={item.alt || ""}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                )}
              </div>

              <div className="overflow-hidden">
                <p
                  className="truncate text-[10px] font-medium text-gray-700 dark:text-gray-300"
                  title={fileName}
                >
                  {fileName}
                </p>
                <p className="text-[10px] text-gray-400 dark:text-gray-500">
                  {item.type === "video" ? t("media.video") : t("media.image")}{" "}
                  · {fileDate}
                </p>
              </div>
            </div>
          );
        })}
      </div>
      {items.length === 0 && (
        <div className="flex items-center justify-center py-12 text-xs text-gray-400">
          {t("media.noContent")}
        </div>
      )}

      {/* 触底哨兵 + 加载指示器（P0-4 无限滚动） */}
      <div ref={sentinelRef} className="h-1" />
      {loading && (
        <div className="flex items-center justify-center py-4">
          <span className="text-xs text-gray-400">{t("media.loadMore")}</span>
        </div>
      )}
    </div>
  );
};
