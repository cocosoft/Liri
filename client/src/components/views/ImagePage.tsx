/**
 * ImagePage
 * 图像工作台 — 左侧工具面板 + 右侧图库网格
 */
import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useConfigStore } from "../../stores/configStore";
import { imageService } from "../../services/imageService";
import ImageToolPanel from "./image/ImageToolPanel";
import ImageGallery from "./image/ImageGallery";
import ImageUploadDrop from "./image/ImageUploadDrop";

type ImageItem = { path: string; url: string };

function ImagePage() {
  const { t } = useTranslation();
  const config = useConfigStore((s) => s.config);
  const isDark = config.theme === "dark";

  const [images, setImages] = useState<ImageItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadImages = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await imageService.listImages();
      setImages(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("image.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadImages();
  }, [loadImages]);

  const handleToolExecute = useCallback(
    async (toolName: string, args: Record<string, unknown>) => {
      setLoading(true);
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
        await loadImages();
      } catch (err) {
        setError(err instanceof Error ? err.message : t("image.toolExecutionFailed"));
      } finally {
        setLoading(false);
      }
    },
    [loadImages, t]
  );

  const handleFileSelect = useCallback((_file: File) => {
    // TODO: 上传文件到后端
  }, []);

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
          onClick={loadImages}
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
          <ImageUploadDrop onFileSelect={handleFileSelect} />
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <ImageGallery images={images} loading={loading} onRefresh={loadImages} />
        </div>
      </div>
    </div>
  );
}

export default ImagePage;
