// views/media/EditLayer.tsx — 图片编辑模态层（状态机：loading → ready → saving → error）

import React, { useState, useEffect, useRef, useCallback } from "react";
import { CanvasEditor } from "../image/canvas-editor/components/CanvasEditor";
import type { CanvasEditorHandle } from "../image/canvas-editor/components/CanvasEditor";
import { CanvasErrorBoundary } from "../image/canvas-editor/components/CanvasErrorBoundary";

type EditLayerPhase = "loading" | "ready" | "saving" | "error";

interface Props {
  imageUrl: string;
  imageId: string;
  onClose: () => void;
  /** 保存成功回调（用于 Toast 等外部反馈） */
  onSaveSuccess?: () => void;
}

export const EditLayer: React.FC<Props> = ({
  imageUrl,
  imageId,
  onClose,
  onSaveSuccess,
}) => {
  const [phase, setPhase] = useState<EditLayerPhase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [hasUnsaved, setHasUnsaved] = useState(false);
  const [retryKey, setRetryKey] = useState(0); // 强制 CanvasEditor 重挂载
  const savingRef = useRef(false); // 防重入锁
  const hasUnsavedRef = useRef(false); // StrictMode 兼容
  const editorRef = useRef<CanvasEditorHandle>(null); // CanvasEditor ref（Ctrl+S 调用 triggerSave）

  // 同步 hasUnsaved 到 ref
  useEffect(() => {
    hasUnsavedRef.current = hasUnsaved;
  }, [hasUnsaved]);

  // CORS 预检 — 用 fetch + createImageBitmap（比 new Image() 更早暴露跨域问题）
  useEffect(() => {
    let cancelled = false;
    fetch(imageUrl, { mode: "cors" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        return createImageBitmap(blob);
      })
      .then(() => {
        if (!cancelled) setPhase("ready");
      })
      .catch(() => {
        if (!cancelled) {
          setPhase("error");
          setError("无法加载图片（跨域限制），请联系管理员配置 CORS 头");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  // Ctrl+S 保存 + ESC 退出 + beforeunload + body 滚动锁定
  useEffect(() => {
    // beforeunload 保护（F5 / 关闭标签页）—— 用 ref 确保 StrictMode 兼容
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    // 快捷键
    const handleKeyDown = (e: KeyboardEvent) => {
      // saving 状态下禁用所有快捷键
      if (phase === "saving") {
        e.preventDefault();
        return;
      }
      if (e.key === "s" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        editorRef.current?.triggerSave();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    // 锁定 body 滚动
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = prev;
    };
  }, [hasUnsaved, phase]);

  // 关闭（带未保存检测）
  const handleClose = useCallback(() => {
    if (hasUnsaved) {
      const confirmed = window.confirm("有未保存的更改，确定退出？");
      if (!confirmed) return;
    }
    onClose();
  }, [hasUnsaved, onClose]);

  // 格式检测：优先从 Content-Type 推断，URL 扩展名作为 fallback
  const detectFormat = useCallback(async (url: string): Promise<string> => {
    try {
      const head = await fetch(url, { method: "HEAD" });
      const ct = head.headers.get("content-type") || "";
      if (ct.includes("png")) return "png";
      if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
      if (ct.includes("webp")) return "webp";
    } catch {
      /* HEAD 失败，fallback 到 URL 正则 */
    }
    return url.match(/\.(\w+)(\?|$)/)?.[1] || "png";
  }, []);

  // 保存（含 toBlob null 检查、防重入锁、格式保持、超时、最小延迟）
  const handleSave = useCallback(
    async (blob: Blob | null) => {
      // 防重入锁：连按 Ctrl+S 只执行第一次
      if (savingRef.current) return;
      savingRef.current = true;

      // null 检查
      if (!blob) {
        savingRef.current = false;
        setPhase("error");
        setError("画布导出失败，请重试或联系管理员");
        return;
      }

      setPhase("saving");
      try {
        const format = await detectFormat(imageUrl);
        // 安全过滤：仅允许已知图片格式
        if (!["png", "jpg", "jpeg", "webp"].includes(format))
          throw new Error(`不支持的格式: ${format}`);

        const formData = new FormData();
        const newName = `${imageId}_edited_${Date.now()}.${format}`;
        formData.append("file", blob, newName);
        formData.append("sourceImageId", imageId);

        // 30s 超时
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);

        // 最少显示 500ms saving 状态（防闪烁）
        const [result] = await Promise.all([
          fetch("/v1/images/upload", {
            method: "POST",
            body: formData,
            signal: controller.signal,
          }),
          new Promise((r) => setTimeout(r, 500)),
        ]);
        clearTimeout(timeout);

        if (!result.ok) {
          throw new Error(`上传失败: ${result.status}`);
        }

        setPhase("ready");
        setHasUnsaved(false);
        savingRef.current = false;
        onSaveSuccess?.();
        onClose();
        // 外部负责 refreshGallery() + toast
      } catch (e) {
        savingRef.current = false;
        setPhase("error");
        if (e instanceof DOMException && e.name === "AbortError") {
          setError("保存超时，请检查网络后重试");
        } else {
          setError(e instanceof Error ? e.message : "保存失败");
        }
      }
    },
    [imageUrl, imageId, detectFormat, onClose],
  );

  // CanvasEditor 内部保存触发（由 Ctrl+S 或工具栏按钮触发）
  const handleEditorSave = useCallback(
    async (blob: Blob | null) => {
      await handleSave(blob);
    },
    [handleSave],
  );

  // 遮罩点击 = 触发关闭检测
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) handleClose();
    },
    [handleClose],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={handleOverlayClick}
    >
      {/* loading */}
      {phase === "loading" && (
        <div className="flex flex-col items-center gap-3 text-white">
          <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          <div className="text-lg">正在加载图片...</div>
        </div>
      )}

      {/* error */}
      {phase === "error" && (
        <div className="flex flex-col items-center gap-4 text-white">
          <div className="text-red-400 text-lg">{error}</div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded bg-gray-700 hover:bg-gray-600 border-0 cursor-pointer text-gray-300"
            >
              关闭
            </button>
            <button
              onClick={() => {
                setPhase("loading");
                setRetryKey((k) => k + 1);
              }}
              className="px-4 py-2 rounded bg-blue-700/40 hover:bg-blue-600/40 border-0 cursor-pointer text-blue-200"
            >
              重试
            </button>
          </div>
        </div>
      )}

      {/* ready */}
      {phase === "ready" && (
        <CanvasErrorBoundary>
          <CanvasEditor
            ref={editorRef}
            key={retryKey}
            src={imageUrl}
            canvasId={imageId}
            containerHeight="h-full max-h-[calc(100vh-4rem)]"
            onSave={handleEditorSave}
            onCancel={handleClose}
            onDirty={setHasUnsaved}
          />
        </CanvasErrorBoundary>
      )}

      {/* saving */}
      {phase === "saving" && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50">
          <div className="flex flex-col items-center gap-3 text-white">
            <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            <div className="text-lg">正在保存...</div>
          </div>
        </div>
      )}
    </div>
  );
};
