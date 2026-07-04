/**
 * useImageToolExecution
 * 图像工具执行核心逻辑 Hook
 *
 * 从 ImagePage 提取：工具调用编排、结果处理、图库刷新、历史记录。
 */
import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { imageService, clearImageCache } from "../../../services/imageService";
import { addHistory } from "./taskHistoryStore";
import type { useImageGallery } from "./useImageGallery";

type GalleryAPI = ReturnType<typeof useImageGallery>;

export function useImageToolExecution(gallery: GalleryAPI) {
  const { t } = useTranslation();

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [toolLoading, setToolLoading] = useState(false);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>("");

  /** 当前活跃工具是否需要 inputPath */
  const toolNeedsInputPath = activeTool
    ? ["image_analysis", "image"].includes(activeTool)
    : false;

  /** 图库选图回调 */
  const handleSelectGalleryImage = useCallback((path: string) => {
    setSelectedPath(path);
    setTimeout(() => setSelectedPath(null), 3000);
  }, []);

  /** 图库删除回调 */
  const handleDeleteImage = useCallback(async (path: string) => {
    try {
      await imageService.deleteImage(path);
      clearImageCache();
      gallery.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("image.deleteFailed"));
    }
  }, [gallery, t]);

  /** 工具执行核心逻辑 */
  const handleToolExecute = useCallback(
    async (toolName: string, args: Record<string, unknown>) => {
      const startedAt = Date.now();
      setToolLoading(true);
      setError(null);
      try {
        const resolvedModel = selectedModel || (args.model as string | undefined);
        const mergedArgs = resolvedModel ? { ...args, model: resolvedModel } : args;
        let galleryUpdated = false;

        switch (toolName) {
          case "image_generate": {
            const result = await imageService.generate(mergedArgs.prompt as string, mergedArgs as Record<string, unknown>);
            if (result.images?.length > 0) {
              gallery.prepend(result.images.map((img) => ({
                path: img.url,
                url: img.url,
              })));
              galleryUpdated = true;
            }
            break;
          }
          case "image_analysis": {
            await imageService.analyze(args.inputPath as string, args.action as string, args as Record<string, unknown>);
            setSuccess(t("image.analysisComplete", { action: args.action }));
            break;
          }
          case "image": {
            const result = await imageService.edit(args.inputPath as string, args.action as string, args as Record<string, unknown>);
            setSuccess(result.outputPath
              ? t("image.editCompleteSaved", { path: result.outputPath })
              : t("image.editComplete"));
            break;
          }
          case "image_svg_generate": {
            const result = await imageService.svgGenerate(mergedArgs.prompt as string, mergedArgs as Record<string, unknown>);
            if (result.svg) {
              const svgDataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(result.svg)}`;
              gallery.prepend([{ path: svgDataUrl, url: svgDataUrl }]);
              galleryUpdated = true;
            }
            break;
          }
          case "canvas": {
            // 画布编辑器是纯前端组件，不调用后端 — 导出/保存由编辑器工具栏自行处理
            setSuccess(t("image.canvasEditorOpened"));
            break;
          }
        }

        addHistory({ toolName, args, success: true, startedAt, completedAt: Date.now() });
        if (!galleryUpdated) gallery.refresh();

        // 操作埋点：记录成功执行
        const duration = Date.now() - startedAt;
        console.debug(`[ImageTool] ${toolName} completed in ${duration}ms`, { model: resolvedModel });

        // 执行成功后自动折叠工具面板（画布编辑器除外 — 它是持续编辑模式）
        if (toolName !== "canvas") {
          setActiveTool(null);
        }
      } catch (err) {
        const duration = Date.now() - startedAt;
        console.debug(`[ImageTool] ${toolName} failed after ${duration}ms`, { error: String(err) });
        addHistory({ toolName, args, success: false, error: err instanceof Error ? err.message : String(err), startedAt, completedAt: Date.now() });
        setError(err instanceof Error ? err.message : t("image.toolExecutionFailed"));
      } finally {
        setToolLoading(false);
      }
    },
    [gallery, selectedModel, t]
  );

  /** 上传成功回调 */
  const handleUploaded = useCallback((result: { path: string; url: string }) => {
    clearImageCache();
    gallery.prepend([{ path: result.path, url: result.url }]);
  }, [gallery]);

  /** 历史恢复回调 — 自动切换工具并执行 */
  const handleResume = useCallback((toolName: string, args: Record<string, unknown>) => {
    setActiveTool(toolName);
    handleToolExecute(toolName, args);
  }, [handleToolExecute]);

  return {
    error,
    setError,
    success,
    setSuccess,
    toolLoading,
    activeTool,
    setActiveTool,
    selectedPath,
    selectedModel,
    setSelectedModel,
    toolNeedsInputPath,
    handleSelectGalleryImage,
    handleDeleteImage,
    handleToolExecute,
    handleUploaded,
    handleResume,
  } as const;
}
