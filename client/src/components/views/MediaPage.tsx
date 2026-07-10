/**
 * MediaPage — Phase 1 MVP
 * 左侧图库（选图） + 右侧图生视频表单 + 异步任务进度
 *
 * Phase 2 将在此基础上升级为完整媒体工作台（Masonry + 底部输入栏 + 模板）
 */

import { useEffect, useCallback } from "react";
import { useConfigStore } from "../../stores/configStore";
import { useMediaStore, type GalleryItem } from "../../stores/mediaStore";
import { useVideoTaskPolling } from "../../hooks/useVideoTaskPolling";
import { GallerySearchBar } from "./media/GallerySearchBar";
import { TaskList } from "./media/TaskCard";
import { videoService } from "../../services/videoService";
import { http } from "../../services/httpClient";
import { createLogger } from "../../utils/logger";

const logger = createLogger("MediaPage");

// 图库分页大小
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
  const duration = useMediaStore((s) => s.duration);
  const aspectRatio = useMediaStore((s) => s.aspectRatio);
  const searchParams = useMediaStore((s) => s.searchParams);

  const selectMedia = useMediaStore((s) => s.selectMedia);
  const setPrompt = useMediaStore((s) => s.setPrompt);
  const setDuration = useMediaStore((s) => s.setDuration);
  const setAspectRatio = useMediaStore((s) => s.setAspectRatio);
  const setSearchParams = useMediaStore((s) => s.setSearchParams);
  const setGalleryItems = useMediaStore((s) => s.setGalleryItems);

  // ──── 轮询 ────
  const { activeTasks, submitTask } = useVideoTaskPolling();

  const generating = activeTasks.some((t) =>
    ["pending", "queued", "running"].includes(t.status)
  );

  // ──── 加载图库 ────
  const loadGallery = useCallback(async () => {
    useMediaStore.setState({ galleryLoading: true });

    try {
      const query = new URLSearchParams();
      query.set("page", "1");
      query.set("pageSize", String(PAGE_SIZE));
      if (searchParams.keyword) query.set("search", searchParams.keyword);

      const res = await http.get<any>(
        `/v1/images/list?${query.toString()}`,
      );

      if (res.ok && res.data?.images) {
        const items: GalleryItem[] = res.data.images.map(
          (img: any) => ({
            id: img.path || img.url,
            type: "image" as const,
            url: img.url,
            thumbnailUrl: img.url,
            width: img.width,
            height: img.height,
            alt: img.alt || "",
          })
        );
        setGalleryItems(items, (res.data?.total || items.length) >= PAGE_SIZE);
      } else {
        setGalleryItems([], false);
      }
    } catch (e) {
      logger.warn("加载图库失败", { error: String(e) });
      setGalleryItems([], false);
    }
  }, [searchParams, setGalleryItems]);

  useEffect(() => {
    loadGallery();
  }, [loadGallery]);

  // ──── 生成视频 ────
  const handleGenerate = useCallback(async () => {
    if (!selectedImageUrl || !prompt.trim()) return;

    try {
      const result = await videoService.createVideoTask({
        mode: "image-to-video",
        prompt: prompt.trim(),
        imageUrl: selectedImageUrl,
        duration,
        aspectRatio,
      });

      if (result.taskId) {
        submitTask(result.taskId);
        setPrompt("");
        logger.info("视频生成任务已提交", { taskId: result.taskId });
      }
    } catch (e) {
      logger.error("创建视频任务失败", { error: String(e) });
    }
  }, [selectedImageUrl, prompt, duration, aspectRatio, submitTask, setPrompt]);

  // ──── 渲染 ────

  const selectedItem = galleryItems.find((i) => i.id === selectedId);

  return (
    <div className={`flex h-full ${isDark ? "bg-gray-900" : "bg-gray-50"}`}>
      {/* ==================== 左侧：图库 ==================== */}
      <div className="flex w-80 flex-shrink-0 flex-col border-r border-gray-200 dark:border-gray-700">
        {/* 搜索栏 */}
        <div className="p-3">
          <GallerySearchBar
            params={searchParams}
            onChange={setSearchParams}
            onRefresh={loadGallery}
          />
        </div>

        {/* 图库网格 */}
        <div className="flex-1 overflow-y-auto p-3">
          {galleryLoading && galleryItems.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <span className="text-sm text-gray-400">加载中…</span>
            </div>
          ) : galleryItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <span className="text-2xl">🖼️</span>
              <p className="mt-2 text-sm text-gray-400">
                图库为空，先去「图像」页面生成图片
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {galleryItems.map((item) => (
                <div
                  key={item.id}
                  onClick={() => selectMedia(item.id)}
                  className={`cursor-pointer overflow-hidden rounded-lg border-2 transition-all ${
                    selectedId === item.id
                      ? "border-blue-500 shadow-md"
                      : "border-transparent hover:border-blue-300"
                  }`}
                >
                  <img
                    src={item.thumbnailUrl || item.url}
                    alt={item.alt || ""}
                    loading="lazy"
                    className="aspect-square w-full object-cover"
                  />
                </div>
              ))}
            </div>
          )}

          {/* 加载更多 */}
          {galleryHasMore && galleryItems.length > 0 && (
            <div className="mt-3 flex justify-center">
              <button
                onClick={loadGallery}
                disabled={galleryLoading}
                className="rounded-md bg-blue-500 px-4 py-1.5 text-xs text-white hover:bg-blue-600 disabled:opacity-50"
              >
                {galleryLoading ? "加载中…" : "加载更多"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ==================== 右侧：表单 + 任务进度 ==================== */}
      <div className="flex flex-1 flex-col overflow-y-auto p-6">
        {/* 标题 */}
        <div className="mb-6">
          <h1 className={`text-xl font-bold ${isDark ? "text-gray-100" : "text-gray-900"}`}>
            媒体工作台
          </h1>
          <p className={`mt-1 text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}>
            从图库选择图片 → 输入描述 → 生成视频
          </p>
        </div>

        <div className="flex-1 space-y-6">
          {/* 选中图片预览 */}
          {selectedItem ? (
            <div className="flex items-start gap-4 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
              <img
                src={selectedItem.thumbnailUrl || selectedItem.url}
                alt="选中图片"
                className="h-24 w-24 rounded-lg object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium ${isDark ? "text-gray-200" : "text-gray-700"}`}>
                  已选图片
                </p>
                <p className="mt-0.5 truncate text-xs text-gray-400">
                  {selectedItem.url}
                </p>
                {selectedItem.width && selectedItem.height && (
                  <p className="mt-1 text-xs text-gray-400">
                    {selectedItem.width} × {selectedItem.height}
                  </p>
                )}
              </div>
              <button
                onClick={() => selectMedia("")}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                title="取消选择"
              >
                ✕
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 py-12 dark:border-gray-600">
              <span className="text-3xl">👈</span>
              <p className={`mt-2 text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}>
                从左侧图库选择一张图片
              </p>
            </div>
          )}

          {/* 提示词输入 */}
          <div>
            <label className={`mb-1.5 block text-sm font-medium ${isDark ? "text-gray-300" : "text-gray-600"}`}>
              视频描述
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="描述你想要的视频内容（可选，AI 会根据图片自动生成）"
              rows={3}
              disabled={!selectedItem}
              className={`w-full resize-none rounded-lg border px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50 ${
                isDark
                  ? "border-gray-600 bg-gray-800 text-gray-200 placeholder-gray-500"
                  : "border-gray-300 bg-white text-gray-700 placeholder-gray-400"
              }`}
            />
          </div>

          {/* 参数 */}
          <div className="flex gap-4">
            <div className="flex-1">
              <label className={`mb-1 block text-xs font-medium ${isDark ? "text-gray-400" : "text-gray-500"}`}>
                时长
              </label>
              <select
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                disabled={!selectedItem}
                className={`w-full rounded-md border px-2 py-1.5 text-sm focus:border-blue-400 focus:outline-none disabled:opacity-50 ${
                  isDark
                    ? "border-gray-600 bg-gray-800 text-gray-200"
                    : "border-gray-300 bg-white text-gray-700"
                }`}
              >
                <option value={5}>5 秒</option>
                <option value={8}>8 秒</option>
                <option value={10}>10 秒</option>
              </select>
            </div>
            <div className="flex-1">
              <label className={`mb-1 block text-xs font-medium ${isDark ? "text-gray-400" : "text-gray-500"}`}>
                宽高比
              </label>
              <select
                value={aspectRatio}
                onChange={(e) => setAspectRatio(e.target.value)}
                disabled={!selectedItem}
                className={`w-full rounded-md border px-2 py-1.5 text-sm focus:border-blue-400 focus:outline-none disabled:opacity-50 ${
                  isDark
                    ? "border-gray-600 bg-gray-800 text-gray-200"
                    : "border-gray-300 bg-white text-gray-700"
                }`}
              >
                <option value="16:9">16:9</option>
                <option value="9:16">9:16</option>
                <option value="1:1">1:1</option>
              </select>
            </div>
          </div>

          {/* 生成按钮 */}
          <button
            onClick={handleGenerate}
            disabled={!selectedItem || !prompt.trim() || generating}
            className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400"
          >
            {generating ? "生成中…" : "生成视频"}
          </button>

          {/* 任务进度 */}
          <TaskList
            tasks={activeTasks}
            onDelete={(taskId) => useMediaStore.getState().removeTask(taskId)}
          />
        </div>
      </div>
    </div>
  );
}

export default MediaPage;
