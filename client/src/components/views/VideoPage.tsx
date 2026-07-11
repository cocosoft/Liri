/**
 * VideoPage
 * 视频工作台 — 左侧生成面板 + 右侧视频库
 *
 * 支持文生视频和图生视频。
 * 右侧视频库从后端 /v1/videos/list 加载历史生成的视频。
 * 点击视频卡片弹出 VideoViewer 全屏播放。
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useConfigStore } from "../../stores/configStore";
import {
  videoService,
  type VideoListItem,
  type VideoListResponse,
} from "../../services/videoService";

function VideoPage() {
  const { t } = useTranslation();
  const config = useConfigStore((s) => s.config);
  const isDark = config.theme === "dark";

  // ---- 生成表单状态 ----
  const [prompt, setPrompt] = useState("");
  const [imagePath, setImagePath] = useState("");
  const [duration, setDuration] = useState(5);
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [asyncMode, setAsyncMode] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // ---- 视频库状态 ----
  const [videos, setVideos] = useState<VideoListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const pageRef = useRef(1);
  const abortRef = useRef<AbortController | null>(null);

  // ---- 查看器状态 ----
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);

  // ---- 风格变量 ----
  const textColor = isDark ? "text-gray-300" : "text-gray-700";
  const subtitleColor = isDark ? "text-gray-500" : "text-gray-400";
  const bgColor = isDark ? "bg-gray-900" : "bg-gray-50";
  const inputBg = isDark
    ? "bg-gray-800 border-gray-700 text-gray-200"
    : "bg-white border-gray-300 text-gray-900";
  const btnPrimary =
    "px-4 py-2 rounded text-sm font-medium border-0 cursor-pointer bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed";

  // ================================================================
  // 视频库：加载列表
  // ================================================================

  const loadVideos = useCallback(
    async (page: number, append: boolean) => {
      if (page === 1) setLoading(true);
      else setLoadingMore(true);
      setLoadError(null);

      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res: VideoListResponse = await videoService.listVideos({
          page,
          pageSize: 50,
          signal: controller.signal,
        });

        if (append) {
          setVideos((prev) => [...prev, ...res.videos]);
        } else {
          setVideos(res.videos);
        }
        setTotal(res.total);
        setHasMore(res.hasMore);
        pageRef.current = page;
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setLoadError((err as Error).message || "Failed to load videos");
        }
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    []
  );

  useEffect(() => {
    loadVideos(1, false);
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, [loadVideos]);

  const loadMore = useCallback(() => {
    if (!hasMore || loadingMore) return;
    loadVideos(pageRef.current + 1, true);
  }, [hasMore, loadingMore, loadVideos]);

  const refresh = useCallback(() => {
    videoService.clearListCache();
    loadVideos(1, false);
  }, [loadVideos]);

  const handleDelete = useCallback(
    async (videoPath: string) => {
      const ok = await videoService.deleteVideo(videoPath);
      if (ok) {
        setVideos((prev) => prev.filter((v) => v.path !== videoPath));
        setTotal((prev) => prev - 1);
        setViewerOpen(false);
      }
    },
    []
  );

  // ---- 查看器导航 ----
  const openViewer = useCallback((index: number) => {
    setViewerIndex(index);
    setViewerOpen(true);
  }, []);

  const viewerPrev = useCallback(() => {
    setViewerIndex((prev) => (prev - 1 + videos.length) % videos.length);
  }, [videos.length]);

  const viewerNext = useCallback(() => {
    setViewerIndex((prev) => (prev + 1) % videos.length);
  }, [videos.length]);

  // 查看器键盘导航
  useEffect(() => {
    if (!viewerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setViewerOpen(false);
      if (e.key === "ArrowLeft") viewerPrev();
      if (e.key === "ArrowRight") viewerNext();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [viewerOpen, viewerPrev, viewerNext]);

  // ================================================================
  // 生成
  // ================================================================

  const handleGenerate = useCallback(async () => {
    // 图生视频：有图片时 prompt 可选；文生视频：必须输入 prompt
    if (!prompt.trim() && !imagePath.trim()) {
      setError(t("video.promptRequired"));
      return;
    }

    setGenerating(true);
    setError(null);
    setSuccess(null);
    setProgress(
      asyncMode ? t("video.submitting") : t("video.generating")
    );

    try {
      const result = await videoService.generate({
        prompt: prompt.trim(),
        imagePath: imagePath.trim() || undefined,
        duration,
        aspectRatio,
        async: asyncMode,
      });

      if (asyncMode && result.taskId) {
        setSuccess(
          `${t("video.taskSubmitted")} (taskId: ${result.taskId})`
        );
        setProgress("");
      } else if (result.video?.url) {
        setSuccess(
          `${t("video.generationComplete")} (${((result.durationMs || 0) / 1000).toFixed(1)}s)`
        );
        setProgress("");
        refresh();
      } else {
        setError(result.error || t("video.generationFailed"));
        setProgress("");
      }
    } catch (e) {
      setError(
        `${t("video.generationFailed")}: ${e instanceof Error ? e.message : String(e)}`
      );
      setProgress("");
    } finally {
      setGenerating(false);
    }
  }, [prompt, imagePath, duration, aspectRatio, asyncMode, t, refresh]);

  // ================================================================
  // 渲染
  // ================================================================

  const currentVideo = videos[viewerIndex];

  return (
    <div className={`flex flex-col h-full ${bgColor}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700/20">
        <div>
          <h1 className={`text-lg font-medium ${textColor}`}>
            {t("video.title")}
          </h1>
          <p className={`text-xs ${subtitleColor}`}>
            {t("video.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs ${subtitleColor}`}>
            {total > 0
              ? t("video.totalVideos", { count: total })
              : ""}
          </span>
          <button
            onClick={refresh}
            disabled={loading}
            className="px-3 py-1 rounded text-xs border-0 cursor-pointer bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 disabled:opacity-50"
          >
            {loading ? t("video.loading") : t("video.refresh")}
          </button>
        </div>
      </div>

      {/* Success banner */}
      {success && (
        <div className="mx-4 mt-2 px-3 py-2 bg-green-900/20 border border-green-800/40 rounded text-green-300 text-xs flex items-center justify-between">
          <span>{success}</span>
          <button
            onClick={() => setSuccess(null)}
            className="ml-2 text-green-400 hover:text-green-300 bg-transparent border-0 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="mx-4 mt-2 px-3 py-2 bg-red-900/20 border border-red-800/40 rounded text-red-300 text-xs flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="ml-2 text-red-400 hover:text-red-300 bg-transparent border-0 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Progress */}
      {generating && progress && (
        <div className="mx-4 mt-2 px-3 py-2 bg-blue-900/20 border border-blue-800/40 rounded text-blue-300 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            <span>{progress}</span>
          </div>
        </div>
      )}

      {/* Main content: left panel + right gallery */}
      <div className="flex-1 overflow-hidden flex">
        {/* ---- 左侧：生成表单 ---- */}
        <div className="w-64 shrink-0 overflow-y-auto border-r border-gray-700/20 p-4 space-y-4">
          <div>
            <label className={`block text-xs font-medium mb-1 ${textColor}`}>
              {t("video.model")}
            </label>
            <p className={`text-xs ${subtitleColor}`}>
              Wan-AI/Wan2.2-T2V-A14B
            </p>
          </div>

          <div>
            <label className={`block text-xs font-medium mb-1 ${textColor}`}>
              {t("video.prompt")}
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t("video.promptPlaceholder")}
              rows={4}
              className={`w-full px-3 py-2 rounded border text-sm resize-none ${inputBg}`}
              disabled={generating}
            />
          </div>

          <div>
            <label className={`block text-xs font-medium mb-1 ${textColor}`}>
              {t("video.imagePath")}
            </label>
            <input
              type="text"
              value={imagePath}
              onChange={(e) => setImagePath(e.target.value)}
              placeholder={t("video.imagePathPlaceholder")}
              className={`w-full px-3 py-2 rounded border text-sm ${inputBg}`}
              disabled={generating}
            />
          </div>

          <div>
            <label className={`block text-xs font-medium mb-1 ${textColor}`}>
              {t("video.duration")}
            </label>
            <select
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className={`w-full px-3 py-2 rounded border text-sm ${inputBg}`}
              disabled={generating}
            >
              <option value={5}>5s</option>
              <option value={10}>10s</option>
              <option value={15}>15s</option>
            </select>
          </div>

          <div>
            <label className={`block text-xs font-medium mb-1 ${textColor}`}>
              {t("video.aspectRatio")}
            </label>
            <select
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value)}
              className={`w-full px-3 py-2 rounded border text-sm ${inputBg}`}
              disabled={generating}
            >
              <option value="16:9">16:9</option>
              <option value="9:16">9:16</option>
              <option value="1:1">1:1</option>
            </select>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={asyncMode}
              onChange={(e) => setAsyncMode(e.target.checked)}
              className="w-4 h-4"
              disabled={generating}
            />
            <span className={`text-xs ${textColor}`}>
              {t("video.asyncMode")}
            </span>
          </label>

          <button
            onClick={handleGenerate}
            disabled={generating || (!prompt.trim() && !imagePath.trim())}
            className={`${btnPrimary} w-full`}
          >
            {generating ? t("video.generating") : t("video.generate")}
          </button>
        </div>

        {/* ---- 右侧：视频库 ---- */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center h-full">
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                <p className={`text-sm ${subtitleColor}`}>{t("video.loading")}</p>
              </div>
            </div>
          )}

          {/* Error */}
          {!loading && loadError && (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <p className="text-sm text-red-400">{loadError}</p>
              <button onClick={refresh} className="px-3 py-1 rounded text-xs border-0 cursor-pointer bg-blue-600/20 text-blue-400 hover:bg-blue-600/30">
                {t("video.retry")}
              </button>
            </div>
          )}

          {/* Empty */}
          {!loading && !loadError && videos.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full">
              <svg className="w-16 h-16 mb-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <polygon points="23 7 16 12 23 17 23 7" />
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
              <p className={`text-sm ${subtitleColor}`}>{t("video.noVideos")}</p>
              <p className={`text-xs mt-1 ${subtitleColor}`}>{t("video.noVideosHint")}</p>
            </div>
          )}

          {/* Video grid */}
          {videos.length > 0 && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                {videos.map((video, idx) => (
                  <div
                    key={idx}
                    className={`rounded border overflow-hidden group relative cursor-pointer ${
                      isDark ? "border-gray-700 bg-gray-800" : "border-gray-200 bg-white"
                    }`}
                    onClick={() => openViewer(idx)}
                  >
                    {/* 播放按钮覆盖层 */}
                    <div className="absolute inset-0 flex items-center justify-center z-10 opacity-0 group-hover:opacity-100 transition-opacity bg-black/20">
                      <div className="w-10 h-10 rounded-full bg-black/60 flex items-center justify-center">
                        <svg className="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </div>
                    </div>

                    {/* 删除按钮 */}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(video.path); }}
                      className={`absolute top-1 right-1 z-20 w-5 h-5 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity ${
                        isDark ? "bg-red-900/70 text-red-300 hover:bg-red-800" : "bg-red-100 text-red-600 hover:bg-red-200"
                      }`}
                      title={t("video.delete")}
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>

                    {/* 缩略图：video 标签首帧 */}
                    <video
                      src={video.url}
                      className="w-full aspect-video object-cover"
                      preload="metadata"
                      muted
                      disablePictureInPicture
                      onMouseEnter={(e) => {
                        // 悬浮时静音预览播放
                        const el = e.currentTarget;
                        el.muted = true;
                        el.play().catch(() => {});
                      }}
                      onMouseLeave={(e) => {
                        const el = e.currentTarget;
                        el.pause();
                        el.currentTime = 0;
                      }}
                    >
                      {t("video.videoNotSupported")}
                    </video>
                  </div>
                ))}
              </div>

              {/* Load more */}
              {hasMore && (
                <div className="flex justify-center mt-4">
                  <button
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="px-4 py-2 rounded text-xs border-0 cursor-pointer bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 disabled:opacity-50"
                  >
                    {loadingMore ? t("video.loadingMore") : t("video.loadMore")}
                  </button>
                </div>
              )}

              {/* Total count */}
              <p className={`text-xs text-center mt-4 ${subtitleColor}`}>
                {t("video.showingCount", { shown: videos.length, total })}
              </p>
            </>
          )}
        </div>
      </div>

      {/* ================================================================ */}
      {/* VideoViewer — 全屏播放弹层 */}
      {/* ================================================================ */}
      {viewerOpen && currentVideo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85"
          onClick={(e) => { if (e.target === e.currentTarget) setViewerOpen(false); }}
        >
          {/* 关闭 */}
          <button
            onClick={() => setViewerOpen(false)}
            className="absolute top-4 right-4 text-white/70 hover:text-white text-2xl bg-transparent border-0 cursor-pointer z-10"
          >✕</button>

          {/* 计数 */}
          <div className="absolute top-4 left-4 text-white/60 text-sm z-10">
            {viewerIndex + 1} / {videos.length}
          </div>

          {/* 删除 */}
          <button
            onClick={(e) => { e.stopPropagation(); handleDelete(currentVideo.path); }}
            className="absolute top-4 left-20 text-white/70 hover:text-red-400 text-sm bg-transparent border-0 cursor-pointer z-10"
          >{t("video.delete")}</button>

          {/* 下载 */}
          <button
            onClick={() => {
              const a = document.createElement("a");
              a.href = currentVideo.url;
              a.download = `video_${Date.now()}.mp4`;
              a.click();
            }}
            className="absolute top-4 left-36 text-white/70 hover:text-white text-sm bg-transparent border-0 cursor-pointer z-10"
          >⭳</button>

          {/* 左箭头 */}
          {videos.length > 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); viewerPrev(); }}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-white/50 hover:text-white text-4xl bg-transparent border-0 cursor-pointer z-10"
            >‹</button>
          )}

          {/* 右箭头 */}
          {videos.length > 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); viewerNext(); }}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-white/50 hover:text-white text-4xl bg-transparent border-0 cursor-pointer z-10"
            >›</button>
          )}

          {/* 视频播放器 */}
          <video
            src={currentVideo.url}
            controls
            autoPlay
            className="max-w-[90vw] max-h-[85vh] object-contain rounded"
          >
            {t("video.videoNotSupported")}
          </video>
        </div>
      )}
    </div>
  );
}

export default VideoPage;