/**
 * ImagePage
 * 图像工作台 — 左侧工具面板 + 右侧图库网格
 *
 * 核心逻辑已提取至 useImageToolExecution / useImageGallery hooks。
 */
import { useTranslation } from "react-i18next";
import { useConfigStore } from "../../stores/configStore";
import ModelSelector from "../common/ModelSelector";
import ImageToolPanel from "./image/ImageToolPanel";
import ImageGallery from "./image/ImageGallery";
import { useImageGallery } from "./image/useImageGallery";
import { useImageToolExecution } from "./image/useImageToolExecution";
import ImageUploadDrop from "./image/ImageUploadDrop";
import TaskHistoryPanel from "./image/TaskHistory";
import ErrorBoundary from "./image/ErrorBoundary";
import ImageModuleErrorFallback from "./image/ImageModuleErrorFallback";
import { CanvasEditor } from "./image/canvas-editor/components/CanvasEditor";
import { CanvasErrorBoundary } from "./image/canvas-editor/components/CanvasErrorBoundary";

function ImagePage() {
  const { t } = useTranslation();
  const config = useConfigStore((s) => s.config);
  const isDark = config.theme === "dark";

  const gallery = useImageGallery();
  const tool = useImageToolExecution(gallery);

  const loading = gallery.loading || tool.toolLoading;

  const textColor = isDark ? "text-gray-300" : "text-gray-700";
  const subtitleColor = isDark ? "text-gray-500" : "text-gray-400";
  const bgColor = isDark ? "bg-gray-900" : "bg-gray-50";

  return (
    <div className={`flex flex-col h-full ${bgColor}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700/20">
        <div>
          <h1 className={`text-lg font-medium ${textColor}`}>
            {t("image.title")}
          </h1>
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

      {/* Success banner */}
      {tool.success && (
        <div className="mx-4 mt-2 px-3 py-2 bg-green-900/20 border border-green-800/40 rounded text-green-300 text-xs flex items-center justify-between">
          <span>{tool.success}</span>
          <button
            onClick={() => tool.setSuccess(null)}
            className="ml-2 text-green-400 hover:text-green-300 bg-transparent border-0 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Error banner */}
      {tool.error && (
        <div className="mx-4 mt-2 px-3 py-2 bg-red-900/20 border border-red-800/40 rounded text-red-300 text-xs">
          {tool.error}
          <button
            onClick={() => tool.setError(null)}
            className="ml-2 text-red-400 hover:text-red-300 bg-transparent border-0 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main content */}
      <ErrorBoundary
        fallback={
          <ImageModuleErrorFallback
            error={undefined}
            onRetry={gallery.refresh}
          />
        }
      >
        <div className="flex-1 overflow-hidden flex">
          <div className="w-64 shrink-0 overflow-y-auto border-r border-gray-700/20 p-3 space-y-4">
            <ModelSelector
              type="image"
              value={tool.selectedModel}
              onChange={tool.setSelectedModel}
              label={t("image.model")}
            />
            <ImageToolPanel
              activeTool={tool.activeTool}
              onActiveToolChange={tool.setActiveTool}
              onExecute={tool.handleToolExecute}
              loading={loading}
              selectedPath={tool.selectedPath}
            />
            <ImageUploadDrop onUploaded={tool.handleUploaded} />
            <TaskHistoryPanel onResume={tool.handleResume} />
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {tool.activeTool === "canvas" ? (
              <CanvasErrorBoundary>
                <CanvasEditor />
              </CanvasErrorBoundary>
            ) : (
              <ImageGallery
                images={gallery.images}
                total={gallery.total}
                hasMore={gallery.hasMore}
                loading={gallery.loading}
                loadingMore={gallery.loadingMore}
                loadError={gallery.loadError}
                onLoadMore={gallery.loadMore}
                onRefresh={gallery.refresh}
                selectable={tool.toolNeedsInputPath}
                onSelect={tool.handleSelectGalleryImage}
                onDelete={tool.handleDeleteImage}
              />
            )}
          </div>
        </div>
      </ErrorBoundary>
    </div>
  );
}

export default ImagePage;
