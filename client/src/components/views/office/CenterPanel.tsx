/**
 * CenterPanel — 中栏文档预览区（50%）
 * 4 态覆盖 + 渲染降级链路 + 缩放 + 拖放接收 + 超时兜底
 */

import { Suspense, lazy, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useOfficeStore, type FileInfo } from "../../../stores/officeStore";
import { officeApi } from "../../../services/officeApi";
import { ErrorBoundary } from "./components/ErrorBoundary";

/** 懒加载渲染器 */
const DocxRenderer = lazy(() =>
  import("./renderers/DocxRenderer").then((m) => ({ default: m.DocxRenderer })),
);
const XlsxRenderer = lazy(() =>
  import("./renderers/XlsxRenderer").then((m) => ({ default: m.XlsxRenderer })),
);
const PptxRenderer = lazy(() =>
  import("./renderers/PptxRenderer").then((m) => ({ default: m.PptxRenderer })),
);

/** 不支持预览的格式映射 */
const FALLBACK_EXTENSIONS = new Set([
  "doc",
  "wps",
  "et",
  "dps",
  "pdf",
  "txt",
  "csv",
]);

/**
 * 根据文件扩展名选择渲染器
 * 不支持格式返回 fallback 提示
 */
function PreviewContent({ file }: { file: FileInfo }) {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";

  // 渲染降级：不支持格式
  if (FALLBACK_EXTENSIONS.has(ext)) {
    return <UnsupportedFormat file={file} />;
  }

  return (
    <ErrorBoundary fallback={<RenderFallback file={file} />}>
      <Suspense fallback={<PreviewSkeleton />}>
        {ext === "docx" ? (
          <DocxRenderer file={file} />
        ) : ext === "xlsx" ? (
          <XlsxRenderer file={file} />
        ) : ext === "pptx" ? (
          <PptxRenderer file={file} />
        ) : (
          <UnsupportedFormat file={file} />
        )}
      </Suspense>
    </ErrorBoundary>
  );
}

export function CenterPanel() {
  const { t } = useTranslation();

  const {
    selectedFile,
    previewState,
    previewError,
    previewZoom,
    generationStatus,
    selectFile,
    setPreviewState,
    setPreviewZoom,
  } = useOfficeStore();

  /** 下载文件 */
  const handleDownload = useCallback(async () => {
    if (!selectedFile) return;
    try {
      const res = await officeApi.downloadDoc(selectedFile.name);
      const blob = (res as unknown as Response)?.blob
        ? await (res as unknown as Response).blob()
        : (res as unknown as { data: Blob })?.data instanceof Blob
          ? (res as unknown as { data: Blob }).data
          : new Blob([res as unknown as string]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = selectedFile.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // 静默失败
    }
  }, [selectedFile]);

  /** 缩放控制 */
  const zoomIn = () => setPreviewZoom(previewZoom + 10);
  const zoomOut = () => setPreviewZoom(previewZoom - 10);
  const zoomFit = () => setPreviewZoom(100);

  /** 拖放接收 → 快速打开预览 */
  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      const fileId = e.dataTransfer.getData("text/plain");
      if (fileId) {
        const file = useOfficeStore
          .getState()
          .fileList.find((f) => f.id === fileId);
        if (file) {
          selectFile(file);
          setPreviewState("loading");
        }
      }
    },
    [selectFile, setPreviewState],
  );

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  // --- 4 态渲染 ---

  // idle / 首次引导
  if (!selectedFile && !generationStatus.active) {
    return (
      <div
        className="h-full flex flex-col"
        role="region"
        aria-label={t("office.preview", "文档预览")}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        <EmptyState />
      </div>
    );
  }

  // AI 生成中
  if (generationStatus.active) {
    return (
      <div
        className="h-full flex flex-col"
        role="region"
        aria-label={t("office.preview", "文档预览")}
        aria-live="polite"
      >
        <div className="flex flex-1 items-center justify-center text-center px-6">
          <div>
            <div className="text-2xl mb-3" aria-hidden="true">
              🪄
            </div>
            <p className="text-gray-700 dark:text-gray-300 font-medium">
              {t("office.generating", "正在生成")}{" "}
              {generationStatus.fileName ?? "..."}
            </p>
            {generationStatus.progress && (
              <p className="text-sm text-gray-500 mt-1">
                {generationStatus.progress}
              </p>
            )}
            <div className="mt-4 w-48 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full mx-auto overflow-hidden">
              <div className="h-full bg-blue-500 rounded-full animate-pulse w-2/3" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="h-full flex flex-col"
      role="region"
      aria-label={t("office.preview", "文档预览")}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      {/* PreviewToolbar */}
      {selectedFile && (
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
          <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
            {selectedFile.name}
          </span>
          <div className="flex items-center gap-1">
            {/* 缩放控制 */}
            <button
              onClick={zoomOut}
              className="px-1.5 py-0.5 text-xs rounded hover:bg-gray-200 dark:hover:bg-gray-700"
              title={t("office.zoomOut", "缩小")}
              aria-label={t("office.zoomOut", "缩小")}
            >
              −
            </button>
            <button
              onClick={zoomFit}
              className="px-1.5 py-0.5 text-xs rounded hover:bg-gray-200 dark:hover:bg-gray-700 min-w-[3rem]"
              title={t("office.zoomFit", "适应宽度")}
            >
              {previewZoom}%
            </button>
            <button
              onClick={zoomIn}
              className="px-1.5 py-0.5 text-xs rounded hover:bg-gray-200 dark:hover:bg-gray-700"
              title={t("office.zoomIn", "放大")}
              aria-label={t("office.zoomIn", "放大")}
            >
              +
            </button>
            <span className="text-gray-300 dark:text-gray-600 mx-1">|</span>
            <button
              onClick={handleDownload}
              className="px-2 py-0.5 text-xs rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400"
            >
              {t("office.download", "下载")}
            </button>
          </div>
        </div>
      )}

      {/* 内容区 */}
      <div
        className="flex-1 min-h-0 overflow-hidden"
        style={{
          transform: `scale(${previewZoom / 100})`,
          transformOrigin: "top left",
        }}
        aria-live="polite"
      >
        {previewState === "loading" && <PreviewSkeleton />}

        {previewState === "success" && selectedFile && (
          <PreviewContent file={selectedFile} />
        )}

        {previewState === "error" && (
          <ErrorState
            message={previewError ?? t("office.previewError", "文档加载失败")}
            onRetry={() => {
              if (selectedFile) {
                setPreviewState("loading");
              }
            }}
            onDownload={handleDownload}
          />
        )}
      </div>
    </div>
  );
}

// ========== 子组件 ==========

/** EmptyState — 首次引导（3 个操作入口） */
function EmptyState() {
  const { t } = useTranslation();

  const focusChat = (prompt: string) => {
    const chatInput = document.querySelector<HTMLTextAreaElement>(
      "[data-office-chat-input]",
    );
    if (chatInput) {
      chatInput.focus();
      chatInput.value = prompt;
      chatInput.dispatchEvent(new Event("input", { bubbles: true }));
    }
  };

  const handleUpload = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".docx,.xlsx,.pptx,.pdf,.doc,.xls,.ppt";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        await officeApi.uploadDoc(file);
        await useOfficeStore.getState().refreshFileList();
      } catch {
        // 静默失败
      }
    };
    input.click();
  };

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center max-w-sm px-6">
        <div className="text-3xl mb-4" aria-hidden="true">
          📂
        </div>
        <p className="text-gray-500 dark:text-gray-400 mb-6 text-sm">
          {t("office.emptyState", "点击左侧文档预览，或让 AI 帮你创建一份")}
        </p>
        <div className="flex flex-col gap-2">
          <button
            onClick={() => focusChat("请帮我创建一份文档：")}
            className="w-full px-4 py-2 text-sm bg-blue-600 text-white rounded-lg 
              hover:bg-blue-700 transition-colors font-medium"
          >
            🪄 {t("office.askAiToCreate", "让 AI 写一份文档")}
          </button>
          <button
            onClick={handleUpload}
            className="w-full px-4 py-2 text-sm border border-gray-300 
              dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 
              transition-colors text-gray-700 dark:text-gray-300"
          >
            + {t("office.uploadFile", "上传文件")}
          </button>
          <button
            onClick={() => focusChat("请帮我查看示例文档")}
            className="w-full px-4 py-2 text-sm border border-gray-300 
              dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 
              transition-colors text-gray-700 dark:text-gray-300"
          >
            📖 {t("office.viewSample", "查看示例文档")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** PreviewSkeleton — 加载骨架屏 */
function PreviewSkeleton() {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center animate-pulse">
        <div className="w-48 h-4 bg-gray-200 dark:bg-gray-700 rounded mx-auto mb-2" />
        <div className="w-32 h-3 bg-gray-100 dark:bg-gray-800 rounded mx-auto" />
        <p className="text-sm text-gray-400 mt-3">加载中...</p>
      </div>
    </div>
  );
}

/** ErrorState — 错误状态 + 重试 + 下载本地打开 */
function ErrorState({
  message,
  onRetry,
  onDownload,
}: {
  message: string;
  onRetry: () => void;
  onDownload: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center max-w-sm px-6">
        <div className="text-2xl mb-3" aria-hidden="true">
          ⚠️
        </div>
        <p className="text-gray-700 dark:text-gray-300 mb-1 text-sm">
          {message}
        </p>
        <div className="flex flex-col gap-2 mt-4">
          <button
            onClick={onRetry}
            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg 
              hover:bg-blue-700 transition-colors"
          >
            {t("office.retry", "重试")}
          </button>
          <button
            onClick={onDownload}
            className="px-4 py-1.5 text-sm border border-gray-300 
              dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 
              transition-colors text-gray-700 dark:text-gray-300"
          >
            {t("office.downloadToOpen", "下载后用本地应用打开")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** RenderFallback — 渲染失败降级为下载 */
function RenderFallback({ file }: { file: FileInfo }) {
  const { t } = useTranslation();

  const handleDownload = async () => {
    try {
      const res = await officeApi.downloadDoc(file.name);
      const blob = (res as unknown as Response)?.blob
        ? await (res as unknown as Response).blob()
        : (res as unknown as { data: Blob })?.data;
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      // 静默失败
    }
  };

  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center p-6">
        <p className="text-gray-500 dark:text-gray-400 mb-3 text-sm">
          {t("office.renderFailed", "渲染失败")}
        </p>
        <button
          onClick={handleDownload}
          className="px-4 py-1.5 text-sm border border-gray-300 
            dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 
            transition-colors text-gray-700 dark:text-gray-300"
        >
          {t("office.downloadToOpen", "下载后用本地应用打开")}
        </button>
      </div>
    </div>
  );
}

/** UnsupportedFormat — 不支持格式降级 */
function UnsupportedFormat({ file }: { file: FileInfo }) {
  const { t } = useTranslation();

  const handleDownload = async () => {
    try {
      const res = await officeApi.downloadDoc(file.name);
      const blob = (res as unknown as Response)?.blob
        ? await (res as unknown as Response).blob()
        : (res as unknown as { data: Blob })?.data;
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      // 静默失败
    }
  };

  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center p-6">
        <div className="text-2xl mb-3" aria-hidden="true">
          📄
        </div>
        <p className="text-gray-500 dark:text-gray-400 mb-3 text-sm">
          {t("office.unsupportedFormat", "该格式暂不支持预览")}
        </p>
        <button
          onClick={handleDownload}
          className="px-4 py-1.5 text-sm border border-gray-300 
            dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 
            transition-colors text-gray-700 dark:text-gray-300"
        >
          {t("office.downloadToOpen", "下载后用本地应用打开")}
        </button>
      </div>
    </div>
  );
}
