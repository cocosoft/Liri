/**
 * MediaPage — Phase 2 统一媒体工作台（对标 Grok + Copilot）
 *
 * 布局（紧凑模式 / 完整模式自适应）:
 *   顶部: TemplateCarousel — I2I/I2I2V 模板轮播
 *   左侧: 画廊（grid，Phase 2 升级为 Masonry）
 *   右侧: 预览区 + 任务进度
 *   底部: BottomInputBar — 图片|视频 切换 + 提示词 + 动态参数 + 生成按钮
 */

import { useEffect, useCallback } from "react";
import { useConfigStore } from "../../stores/configStore";
import { useMediaStore, type GalleryItem } from "../../stores/mediaStore";
import { useVideoTaskPolling } from "../../hooks/useVideoTaskPolling";
import { GallerySearchBar } from "./media/GallerySearchBar";
import { TaskList } from "./media/TaskCard";
import { TemplateCarousel } from "./media/TemplateCarousel";
import { MasonryGallery } from "./media/MasonryGallery";
import { BottomInputBar } from "./media/BottomInputBar";
import { videoService } from "../../services/videoService";
import { http } from "../../services/httpClient";
import { createLogger } from "../../utils/logger";

const logger = createLogger("MediaPage");
const PAGE_SIZE = 30;

function MediaPage() {
  const { config } = useConfigStore();
  const isDark = config.theme === "dark";

  // ──── Store ────
  const galleryItems = useMediaStore((s) => s.galleryItems);
  const galleryLoading = useMediaStore((s) => s.galleryLoading);
  const galleryHasMore = useMediaStore((s) => s.galleryHasMore);
  const selectedId = useMediaStore((s) => s.selectedId);
  const selectedImageUrl = useMediaStore((s) => s.selectedImageUrl);
  const prompt = useMediaStore((s) => s.prompt);
  const mode = useMediaStore((s) => s.mode);
  const params = useMediaStore((s) => s.params);
  const searchParams = useMediaStore((s) => s.searchParams);

  const selectMedia = useMediaStore((s) => s.selectMedia);
  const setSearchParams = useMediaStore((s) => s.setSearchParams);
  const setGalleryItems = useMediaStore((s) => s.setGalleryItems);

  // ──── 紧凑/完整模式 ────
  const isCompact = selectedId === null;

  // ──── 加载图库（合并图片 + 视频） ────
  const loadGallery = useCallback(async () => {
    useMediaStore.setState({ galleryLoading: true });

    try {
      const q = new URLSearchParams();
      q.set("pageSize", String(PAGE_SIZE));

      // 并行加载图片和视频
      const [imgRes, vidRes] = await Promise.all([
        http.get<any>(`/v1/images/list?${q.toString()}`),
        http.get<any>(`/v1/videos/list?${q.toString()}`),
      ]);

      const images: GalleryItem[] = (imgRes.ok && imgRes.data?.images
        ? imgRes.data.images
        : []
      ).map((img: any) => ({
        id: img.path || img.url,
        type: "image" as const,
        url: img.url,
        thumbnailUrl: img.url,
        width: img.width,
        height: img.height,
        alt: img.alt || "",
      }));

      const videos: GalleryItem[] = (vidRes.ok && vidRes.data?.videos
        ? vidRes.data.videos
        : []
      ).map((vid: any) => ({
        id: vid.path || vid.url,
        type: "video" as const,
        url: vid.url,
        thumbnailUrl: vid.url,
        duration: vid.duration,
      }));

      logger.info("图库加载完成", {
        imageCount: images.length,
        videoCount: videos.length,
        videoOk: vidRes.ok,
      });

      // 合并：图片和视频各自保持 API 返回的时间倒序（新的在前）
      const allItems = [...images, ...videos].slice(0, PAGE_SIZE);

      setGalleryItems(allItems, allItems.length >= PAGE_SIZE);
    } catch (e) {
      logger.warn("加载图库失败", { error: String(e) });
      setGalleryItems([], false);
    }
  }, [setGalleryItems]);

  useEffect(() => {
    loadGallery();
  }, [loadGallery]);

  // ──── 轮询（任务完成时自动刷新画廊） ────
  const handleTaskCompleted = useCallback(() => {
    loadGallery();
  }, [loadGallery]);

  const { activeTasks, submitTask } = useVideoTaskPolling(handleTaskCompleted);
  const generating = activeTasks.some((t) =>
    ["pending", "queued", "running"].includes(t.status)
  );

  // ──── 生成视频 ────
  const handleGenerate = useCallback(async () => {
    // 图生视频：有图片时 prompt 可选；文生视频：必须输入 prompt
    if (!prompt.trim() && !selectedImageUrl) return;

    try {
      const result = await videoService.createVideoTask({
        mode: mode === "video" && selectedImageUrl
          ? "image-to-video"
          : "text-to-video",
        prompt: prompt.trim(),
        imageUrl: selectedImageUrl || undefined,
        duration: params.duration || 5,
        aspectRatio: params.aspectRatio || "16:9",
      });

      if (result.taskId) {
        submitTask(result.taskId);
        useMediaStore.getState().setPrompt("");
        logger.info("任务已提交", { taskId: result.taskId });
      }
    } catch (e) {
      logger.error("创建任务失败", { error: String(e) });
    }
  }, [prompt, mode, selectedImageUrl, params, submitTask]);

  const selectedItem = galleryItems.find((i) => i.id === selectedId);

  return (
    <div className={`flex h-full flex-col ${isDark ? "bg-gray-900" : "bg-gray-50"}`}>
      {/* ========== 顶部：模板轮播 ========== */}
      <TemplateCarousel isDark={isDark} />

      {/* ========== 主体：画廊 + 预览区 ========== */}
      <div className="flex flex-1 overflow-hidden">
        {/* ========== 左侧：画廊 ========== */}
        <div
          className={`flex flex-shrink-0 flex-col border-r border-gray-200 dark:border-gray-700 ${
            isCompact ? "flex-1" : "w-80"
          }`}
        >
          {/* 搜索栏 */}
          <div className="p-3">
            <GallerySearchBar
              params={searchParams}
              onChange={setSearchParams}
              onRefresh={loadGallery}
            />
          </div>

          {/* 瀑布流画廊 */}
          <MasonryGallery
            items={galleryItems}
            selectedId={selectedId}
            hasMore={galleryHasMore}
            loading={galleryLoading}
            isDark={isDark}
            onSelect={selectMedia}
            onLoadMore={() => {
              // TODO: 分页加载
            }}
          />
        </div>

        {/* ========== 右侧：预览区（完整模式时显示） ========== */}
        {!isCompact && (
          <div className="flex flex-1 flex-col overflow-y-auto border-l border-gray-200 p-4 dark:border-gray-700">
            {selectedItem ? (
              <>
                {/* 预览 */}
                <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
                  {selectedItem.type === "video" ? (
                    <video
                      src={selectedItem.url}
                      controls
                      className="w-full rounded-lg"
                    />
                  ) : (
                    <img
                      src={selectedItem.url}
                      alt="预览"
                      className="w-full rounded-lg object-contain"
                    />
                  )}
                </div>

                {/* 信息 */}
                <div className="mt-3 space-y-1 text-xs text-gray-500 dark:text-gray-400">
                  <p>类型: {selectedItem.type === "video" ? "视频" : "图片"}</p>
                  {selectedItem.width && selectedItem.height && (
                    <p>尺寸: {selectedItem.width} × {selectedItem.height}</p>
                  )}
                  {selectedItem.duration && <p>时长: {selectedItem.duration}s</p>}
                  <button
                    onClick={() => selectMedia("")}
                    className="text-blue-500 hover:underline"
                  >
                    取消选择
                  </button>
                </div>
              </>
            ) : null}

            {/* 任务进度 */}
            <div className="mt-4">
              <TaskList
                tasks={activeTasks}
                onDelete={(taskId) => useMediaStore.getState().removeTask(taskId)}
              />
            </div>
          </div>
        )}
      </div>

      {/* ========== 底部：统一输入栏 ========== */}
      <BottomInputBar
        isDark={isDark}
        generating={generating}
        onGenerate={handleGenerate}
      />
    </div>
  );
}

export default MediaPage;
