/**
 * ImagePage
 * 图像工作台 — 左侧工具面板 + 右侧图库网格（P2-7: 无限滚动）
 */
import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useConfigStore } from "../../stores/configStore";
import { imageService, clearImageCache } from "../../services/imageService";
import ImageToolPanel from "./image/ImageToolPanel";
import ImageGallery, { useImageGallery } from "./image/ImageGallery";
import ImageUploadDrop from "./image/ImageUploadDrop";
import TaskHistoryPanel from "./image/TaskHistory";
import { addHistory } from "./image/taskHistoryStore";

function ImagePage() {
  const { t } = useTranslation();
  const config = useConfigStore((s) => s.config);
  const isDark = config.theme === "dark";

  const gallery = useImageGallery();
  const [error, setError] = useState<string | null>(null);
  const [toolLoading, setToolLoading] = useState(false);

  const loading = gallery.loading || toolLoading;

  const handleToolExecute = useCallback(
    async (toolName: string, args: Record<string, unknown>) => {
      const startedAt = Date.now();
      setToolLoading(true);
      setError(null);
      try {
        switch (toolName) {
          case "image_generate":
            await imageService.generate(args.prompt as string, args as Record<string, unknown>);
            break;
          case "image_analysis":
            await imageService.analyze(
              args.inputPath as string,
              args.action as string,
              args as Record<string, unknown>
            );
            break;
          case "image":
            await imageService.edit(
              args.inputPath as string,
              args.action as string,
              args as Record<string, unknown>
            );
            break;
          case "image_svg_generate":
            await imageService.generate(args.prompt as string, args as Record<string, unknown>);
            break;
          case "canvas":
            break;
        }
        addHistory({ toolName, args, success: true, startedAt, completedAt: Date.now() });
        clearImageCache();
        gallery.refresh();
      } catch (err) {
        addHistory({ toolName, args, success: false, error: err instanceof Error ? err.message : String(err), startedAt, completedAt: Date.now() });
        setError(err instanceof Error ? err.message : t("image.toolExecutionFailed"));
      } finally {
        setToolLoading(false);
      }
    },
    [gallery, t]
  );

  const handleUploaded = useCallback((_result: { path: string; url: string }) => {
    clearImageCache();
    gallery.refresh();
  }, [gallery]);

  const handleResume = useCallback((toolName: string, args: Record<string, unknown>) => {
    handleToolExecute(toolName, args);
  }, [handleToolExecute]);

  const textColor = isDark ? "text-gray-300" : "text-gray-700";
  const subtitleColor = isDark ? "text-gray-500" : "text-gray-400";
  const bgColor = isDark ? "bg-gray-900" : "bg-gray-50";

  return (
    <div className={`flex flex-col h-full ${bgColor}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700/20">
        <div>
          <h1 className={`text-lg font-medium ${textColor}`}>{t("image.title")}</h1>
          <p className={`text-xs ${subtitleColor}`}>{t("image.subtitle")}</p>
        </div>
        <button
          onClick={gallery.refresh}
          disabled={loading}
          className="px-3 py-1 rounded text-xs border-0 cursor-pointer bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 disabled:opacity-50"
        >
          {loading ? t("image.loading") : t("image.refresh")}
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-4 mt-2 px-3 py-2 bg-red-900/20 border border-red-800/40 rounded text-red-300 text-xs">
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-2 text-red-400 hover:text-red-300 bg-transparent border-0 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 overflow-hidden flex">
        <div className="w-64 shrink-0 overflow-y-auto border-r border-gray-700/20 p-3 space-y-4">
          <ImageToolPanel onExecute={handleToolExecute} loading={loading} />
          <ImageUploadDrop onUploaded={handleUploaded} />
          <TaskHistoryPanel onResume={handleResume} />
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <ImageGallery
            images={gallery.images}
            total={gallery.total}
            hasMore={gallery.hasMore}
            loading={gallery.loading}
            loadingMore={gallery.loadingMore}
            onLoadMore={gallery.loadMore}
            onRefresh={gallery.refresh}
          />
        </div>
      </div>
    </div>
  );
}

export default ImagePage;
