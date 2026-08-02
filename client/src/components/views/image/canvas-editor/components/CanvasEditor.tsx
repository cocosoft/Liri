// canvas-editor/components/CanvasEditor.tsx — 画布编辑器容器

import {
  useState,
  useCallback,
  useEffect,
  useRef,
  forwardRef,
  useImperativeHandle,
} from "react";
import { CanvasState, CanvasTool, CanvasEditorProps } from "../types";
import { CanvasTransform } from "../core/CanvasTransform";
import { CommandManager } from "../core/CommandManager";
import { OffscreenBuffer } from "../core/OffscreenBuffer";
import { CanvasToolbar } from "./CanvasToolbar";
import { CanvasSurface } from "./CanvasSurface";
import { CanvasStatusBar } from "./CanvasStatusBar";
import { getTool } from "../tools/index";
import { CanvasLogger } from "../utils/logger";
import {
  saveSnapshot,
  getLatestSnapshot,
  clearAutoSave,
  SnapMeta,
} from "../utils/autoSave";

/** 暴露给父组件的方法 */
export interface CanvasEditorHandle {
  triggerSave: () => void;
}

export const CanvasEditor = forwardRef<CanvasEditorHandle, CanvasEditorProps>(
  (
    {
      width = 800,
      height = 600,
      bgColor: initBgColor,
      src,
      canvasId,
      containerHeight = "h-[calc(100vh-12rem)]",
      onSave,
      onCancel,
      onDirty,
    },
    ref,
  ) => {
    const transformRef = useRef(new CanvasTransform());
    const commandRef = useRef(new CommandManager());
    const bufferRef = useRef(new OffscreenBuffer(width, height));

    const bgColor = initBgColor || "#ffffff";

    /** 从工具 paramsSchema 构建默认 toolParams */
    const buildDefaultParams = useCallback(
      (tool: CanvasTool): Record<string, unknown> => {
        const handler = getTool(tool);
        const params: Record<string, unknown> = {};
        if (handler?.paramsSchema) {
          for (const p of handler.paramsSchema) {
            params[p.name] = p.default;
          }
        }
        return params;
      },
      [],
    );

    const [state, setState] = useState<CanvasState>({
      width,
      height,
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
      fitToWindow: true,
      activeTool: "pencil",
      strokeWidth: 3,
      fgColor: "#000000",
      bgColor,
      toolParams: buildDefaultParams("pencil"),
    });
    const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
    const [canUndo, setCanUndo] = useState(false);
    const [canRedo, setCanRedo] = useState(false);

    // 画布尺寸调整
    const [showResize, setShowResize] = useState(false);
    const resizeWRef = useRef(width);
    const resizeHRef = useRef(height);

    // 导出预览
    const [showPreview, setShowPreview] = useState(false);
    const [previewUrl, setPreviewUrl] = useState("");
    const previewFormatRef = useRef<"png" | "jpeg" | "webp">("png");

    // 订阅 CommandManager 变更，自动同步按钮状态
    const updateCanStates = useCallback(() => {
      setCanUndo(commandRef.current.canUndo());
      setCanRedo(commandRef.current.canRedo());
    }, []);

    useEffect(() => {
      commandRef.current.onChange(updateCanStates);
    }, [updateCanStates]);

    const updateState = useCallback((partial: Partial<CanvasState>) => {
      setState((s) => ({ ...s, ...partial }));
    }, []);

    // 光标移动回调（稳定引用，避免触发 CanvasSurface effect 重运行）
    const handleCursorMove = useCallback((x: number, y: number) => {
      setCursorPos({ x, y });
    }, []);

    // 工具切换时自动重置 toolParams 为默认值
    const handleToolChange = useCallback(
      (tool: CanvasTool) => {
        setState((s) => ({
          ...s,
          activeTool: tool,
          toolParams: buildDefaultParams(tool),
        }));
      },
      [buildDefaultParams],
    );

    // 工具参数变更
    const handleToolParamChange = useCallback(
      (name: string, value: unknown) => {
        setState((s) => ({
          ...s,
          toolParams: { ...s.toolParams, [name]: value },
        }));
      },
      [],
    );

    const handleUndo = useCallback(() => {
      const ok = commandRef.current.undo(bufferRef.current.ctx);
      if (ok) {
        window.dispatchEvent(new Event("canvas-render"));
      }
    }, []);

    const handleRedo = useCallback(() => {
      const ok = commandRef.current.redo(bufferRef.current.ctx);
      if (ok) window.dispatchEvent(new Event("canvas-render"));
    }, []);

    // 初始化 buffer 背景
    const initRef = useRef(false);
    if (!initRef.current) {
      bufferRef.current.fillBg(bgColor);
      initRef.current = true;
    }

    // 加载图片到画布（支持 File 对象或 URL 字符串）—— 必须在 useEffect 之前定义
    const handleLoadImage = useCallback(
      async (source: File | string) => {
        const img = new Image();
        let imgSrc: string;

        // SVG 安全：拖入 SVG 时剥离 <script> 标签
        if (
          typeof source !== "string" &&
          (source.type === "image/svg+xml" || source.name.endsWith(".svg"))
        ) {
          const text = await source.text();
          const safeText = text.replace(
            /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
            "",
          );
          const blob = new Blob([safeText], { type: "image/svg+xml" });
          imgSrc = URL.createObjectURL(blob);
        } else {
          imgSrc =
            typeof source === "string" ? source : URL.createObjectURL(source);
        }

        // 仅对跨域 URL 设置 crossOrigin，避免与浏览器同源非 CORS 缓存冲突导致加载失败
        if (typeof source === "string") {
          try {
            const imgUrl = new URL(imgSrc, window.location.origin);
            if (imgUrl.origin !== window.location.origin) {
              img.crossOrigin = "anonymous";
            }
          } catch {
            // URL 解析失败（如相对路径无 base）则视为同源，不设 crossOrigin
          }
        }

        try {
          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error("图片加载失败"));
            img.src = imgSrc;
          });
        } catch (err) {
          // 加载失败时释放 object URL 并记录日志
          CanvasLogger.error("画布图片加载失败", {
            source: typeof source === "string" ? source : (source as File).name,
            error: err instanceof Error ? err.message : String(err),
          });
          if (typeof source !== "string") URL.revokeObjectURL(imgSrc);
          return;
        }

        const before = bufferRef.current.getImageData(
          0,
          0,
          bufferRef.current.width,
          bufferRef.current.height,
        );

        const scale = Math.min(
          bufferRef.current.width / img.width,
          bufferRef.current.height / img.height,
        );
        const dw = img.width * scale;
        const dh = img.height * scale;
        const dx = (bufferRef.current.width - dw) / 2;
        const dy = (bufferRef.current.height - dh) / 2;

        bufferRef.current.fillBg(state.bgColor);
        bufferRef.current.ctx.drawImage(img, dx, dy, dw, dh);

        const after = bufferRef.current.getImageData(
          0,
          0,
          bufferRef.current.width,
          bufferRef.current.height,
        );

        commandRef.current.execute({
          type: "image",
          bbox: {
            x: 0,
            y: 0,
            w: bufferRef.current.width,
            h: bufferRef.current.height,
          },
          before,
          after,
          apply: (c) => {
            c.putImageData(after, 0, 0);
          },
          revert: (c) => {
            c.putImageData(before, 0, 0);
          },
        });

        if (typeof source !== "string") URL.revokeObjectURL(imgSrc);
        window.dispatchEvent(new Event("canvas-render"));
      },
      [state.bgColor],
    );

    // 加载初始图片（仅 src 变化时触发，不受 bgColor 等影响）
    const initialLoadedRef = useRef(false);
    useEffect(() => {
      if (src && initRef.current && !initialLoadedRef.current) {
        initialLoadedRef.current = true;
        handleLoadImage(src);
      }
    }, [src, handleLoadImage]);

    // 导出画布（先预览）
    const handleExport = useCallback(
      async (format: "png" | "jpeg" | "webp") => {
        previewFormatRef.current = format;
        const dataUrl = await bufferRef.current.toDataURL(format);
        setPreviewUrl(dataUrl);
        setShowPreview(true);
      },
      [],
    );

    // 确认导出下载
    const handleConfirmExport = useCallback(() => {
      const a = document.createElement("a");
      a.href = previewUrl;
      a.download = `canvas-${state.width}x${state.height}.${previewFormatRef.current === "jpeg" ? "jpg" : previewFormatRef.current}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setShowPreview(false);
    }, [previewUrl, state.width, state.height]);

    // 清空画布（可撤销）
    const handleClearCanvas = useCallback(() => {
      const before = bufferRef.current.getImageData(
        0,
        0,
        bufferRef.current.width,
        bufferRef.current.height,
      );
      bufferRef.current.fillBg(bgColor);
      const after = bufferRef.current.getImageData(
        0,
        0,
        bufferRef.current.width,
        bufferRef.current.height,
      );

      commandRef.current.execute({
        type: "clear",
        bbox: {
          x: 0,
          y: 0,
          w: bufferRef.current.width,
          h: bufferRef.current.height,
        },
        before,
        after,
        apply: (c) => {
          c.putImageData(after, 0, 0);
        },
        revert: (c) => {
          c.putImageData(before, 0, 0);
        },
      });
      window.dispatchEvent(new Event("canvas-render"));
    }, [bgColor]);

    // 新建画布（重置到默认尺寸）
    const handleNewCanvas = useCallback(() => {
      const defaultW = 800,
        defaultH = 600;
      const before = bufferRef.current.getImageData(
        0,
        0,
        state.width,
        state.height,
      );

      bufferRef.current.resize(defaultW, defaultH);
      bufferRef.current.fillBg(bgColor);

      const after = bufferRef.current.getImageData(0, 0, defaultW, defaultH);

      commandRef.current.clear(); // 先清旧尺寸的 undo 历史
      commandRef.current.execute({
        type: "clear",
        bbox: { x: 0, y: 0, w: defaultW, h: defaultH },
        before: new ImageData(defaultW, defaultH),
        after,
        apply: (c) => {
          c.putImageData(after, 0, 0);
        },
        revert: (_c) => {
          bufferRef.current.resize(state.width, state.height);
          bufferRef.current.fillBg(bgColor);
          bufferRef.current.putImageData(before, 0, 0);
        },
      });

      setState((s) => ({ ...s, width: defaultW, height: defaultH }));
      window.dispatchEvent(new Event("canvas-render"));
    }, [state.width, state.height, bgColor]);

    // 裁剪到选区
    const handleCrop = useCallback(() => {
      const isSelect =
        state.activeTool === "select" || state.activeTool === "lasso";
      if (!isSelect) return;

      // 动态 import 获取选区函数
      const tool = getTool(state.activeTool);
      const sel = (
        tool as {
          getSelection?: () => {
            x: number;
            y: number;
            w: number;
            h: number;
          } | null;
        }
      ).getSelection?.();
      if (!sel || sel.w < 2 || sel.h < 2) return;

      const before = bufferRef.current.getImageData(
        0,
        0,
        state.width,
        state.height,
      );
      const cropped = bufferRef.current.getImageData(
        sel.x,
        sel.y,
        sel.w,
        sel.h,
      );

      bufferRef.current.resize(sel.w, sel.h);
      bufferRef.current.fillBg(bgColor);
      bufferRef.current.putImageData(cropped, 0, 0);

      const after = bufferRef.current.getImageData(0, 0, sel.w, sel.h);

      commandRef.current.clear(); // 先清旧尺寸的 undo 历史
      commandRef.current.execute({
        type: "clear",
        bbox: { x: 0, y: 0, w: sel.w, h: sel.h },
        before: new ImageData(sel.w, sel.h),
        after,
        apply: (c) => {
          c.putImageData(after, 0, 0);
        },
        revert: (_c) => {
          bufferRef.current.resize(state.width, state.height);
          bufferRef.current.fillBg(bgColor);
          bufferRef.current.putImageData(before, 0, 0);
        },
      });

      setState((s) => ({ ...s, width: sel.w, height: sel.h }));
      window.dispatchEvent(new Event("canvas-render"));
    }, [state.width, state.height, state.activeTool, bgColor]);

    // 选区导出（仅导出选中区域）
    const handleSelectionExport = useCallback(async () => {
      const isSelect =
        state.activeTool === "select" || state.activeTool === "lasso";
      if (!isSelect) return;
      const tool = getTool(state.activeTool);
      const sel = (
        tool as {
          getSelection?: () => {
            x: number;
            y: number;
            w: number;
            h: number;
          } | null;
        }
      ).getSelection?.();
      if (!sel || sel.w < 2 || sel.h < 2) return;

      const cropped = bufferRef.current.getImageData(
        sel.x,
        sel.y,
        sel.w,
        sel.h,
      );
      // 导出到临时 OffscreenCanvas
      const tmp = new OffscreenCanvas(sel.w, sel.h);
      const tmpCtx = tmp.getContext("2d")!;
      tmpCtx.putImageData(cropped, 0, 0);
      const blob = await tmp.convertToBlob({ type: "image/png" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `canvas-selection-${sel.w}x${sel.h}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, [state.activeTool]);

    // 图像翻转（水平/垂直）
    const handleFlip = useCallback((dir: "horizontal" | "vertical") => {
      const { width, height } = bufferRef.current;
      const before = bufferRef.current.getImageData(0, 0, width, height);
      const src = before.data;
      const dst = new Uint8ClampedArray(src.length);

      if (dir === "horizontal") {
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const si = (y * width + x) * 4;
            const di = (y * width + (width - 1 - x)) * 4;
            dst[di] = src[si];
            dst[di + 1] = src[si + 1];
            dst[di + 2] = src[si + 2];
            dst[di + 3] = src[si + 3];
          }
        }
      } else {
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const si = (y * width + x) * 4;
            const di = ((height - 1 - y) * width + x) * 4;
            dst[di] = src[si];
            dst[di + 1] = src[si + 1];
            dst[di + 2] = src[si + 2];
            dst[di + 3] = src[si + 3];
          }
        }
      }

      const after = new ImageData(dst, width, height);
      bufferRef.current.putImageData(after, 0, 0);

      commandRef.current.execute({
        type: "image",
        bbox: { x: 0, y: 0, w: width, h: height },
        before,
        after,
        apply: (c) => {
          c.putImageData(after, 0, 0);
        },
        revert: (c) => {
          c.putImageData(before, 0, 0);
        },
      });

      window.dispatchEvent(new Event("canvas-render"));
    }, []);

    // 图像滤镜（Worker 管线）
    const filterWorkerRef = useRef<Worker | null>(null);
    const getFilterWorker = useCallback(() => {
      if (!filterWorkerRef.current) {
        filterWorkerRef.current = new Worker(
          new URL("../core/imageFilters.worker.ts", import.meta.url),
          { type: "module" },
        );
      }
      return filterWorkerRef.current;
    }, []);

    const handleFilter = useCallback(
      async (
        op:
          | "brightness+"
          | "brightness-"
          | "contrast+"
          | "contrast-"
          | "grayscale"
          | "invert"
          | "blur",
      ) => {
        const { width, height } = bufferRef.current;
        const before = bufferRef.current.getImageData(0, 0, width, height);

        const filters: { type: string; value?: number }[] = [];
        switch (op) {
          case "brightness+":
            filters.push({ type: "brightness", value: 20 });
            break;
          case "brightness-":
            filters.push({ type: "brightness", value: -20 });
            break;
          case "contrast+":
            filters.push({ type: "contrast", value: 120 });
            break;
          case "contrast-":
            filters.push({ type: "contrast", value: 80 });
            break;
          case "grayscale":
            filters.push({ type: "grayscale" });
            break;
          case "invert":
            filters.push({ type: "invert" });
            break;
          case "blur":
            filters.push({ type: "blur", value: 3 });
            break;
        }

        try {
          const worker = getFilterWorker();
          const result = await new Promise<ImageData>((resolve, reject) => {
            const timeout = setTimeout(
              () => reject(new Error("滤镜超时")),
              3000,
            );
            worker.onmessage = (
              e: MessageEvent<{ result?: ImageData; error?: string }>,
            ) => {
              clearTimeout(timeout);
              if (e.data.result) resolve(e.data.result);
              else reject(new Error(e.data.error || "未知错误"));
            };
            worker.postMessage({ imageData: before, filters });
          });

          bufferRef.current.putImageData(result, 0, 0);
          const after = bufferRef.current.getImageData(0, 0, width, height);

          commandRef.current.execute({
            type: "image",
            bbox: { x: 0, y: 0, w: width, h: height },
            before,
            after,
            apply: (c) => {
              c.putImageData(after, 0, 0);
            },
            revert: (c) => {
              c.putImageData(before, 0, 0);
            },
          });

          window.dispatchEvent(new Event("canvas-render"));
        } catch (err) {
          CanvasLogger.error("滤镜失败", {
            error: err instanceof Error ? err : new Error(String(err)),
          });
        }
      },
      [getFilterWorker],
    );

    // 调整画布尺寸
    const handleResizeCanvas = useCallback(() => {
      const newW = resizeWRef.current;
      const newH = resizeHRef.current;
      if (newW === state.width && newH === state.height) {
        setShowResize(false);
        return;
      }
      if (newW < 1 || newH < 1 || newW > 4096 || newH > 4096) return;

      // 保存旧数据
      const before = bufferRef.current.getImageData(
        0,
        0,
        state.width,
        state.height,
      );

      // 创建新 buffer，复制旧像素到左上角
      const newBuffer = new OffscreenBuffer(newW, newH);
      newBuffer.fillBg(bgColor);
      const copyW = Math.min(state.width, newW);
      const copyH = Math.min(state.height, newH);
      const oldPixels = bufferRef.current.getImageData(0, 0, copyW, copyH);
      newBuffer.putImageData(oldPixels, 0, 0);

      // 替换 buffer
      bufferRef.current.resize(newW, newH);
      // 将新 buffer 内容写回
      const newPixels = newBuffer.getImageData(0, 0, newW, newH);
      bufferRef.current.fillBg(bgColor);
      bufferRef.current.putImageData(newPixels, 0, 0);

      const after = bufferRef.current.getImageData(0, 0, newW, newH);

      commandRef.current.clear(); // 先清旧尺寸的 undo 历史
      commandRef.current.execute({
        type: "clear",
        bbox: { x: 0, y: 0, w: newW, h: newH },
        before: new ImageData(newW, newH),
        after,
        apply: (c) => {
          c.putImageData(after, 0, 0);
        },
        revert: (_c) => {
          bufferRef.current.resize(state.width, state.height);
          bufferRef.current.fillBg(bgColor);
          bufferRef.current.putImageData(before, 0, 0);
        },
      });

      setState((s) => ({ ...s, width: newW, height: newH }));
      setShowResize(false);
      window.dispatchEvent(new Event("canvas-render"));
    }, [state.width, state.height, bgColor]);

    // 自动保存（IndexedDB + 3版本保留 + 30s/10命令/beforeunload/卸载触发，绘制中跳过）
    const isDrawingRef = useRef(false);
    const cmdCountRef = useRef(0);
    // 脏状态跟踪（Modal 模式下通知外部）
    const isDirtyRef = useRef(false);
    useEffect(() => {
      const keyPrefix = canvasId || "default";
      const saveTick = 30_000;
      const cmdTrigger = 10;

      const doSave = async () => {
        if (isDrawingRef.current) return;
        try {
          const dataUrl = await bufferRef.current.toDataURL("png");
          const meta: SnapMeta = {
            version: 0,
            width: state.width,
            height: state.height,
            bgColor,
            zoom: state.zoom,
            savedAt: Date.now(),
          };
          await saveSnapshot(keyPrefix, dataUrl, meta);
        } catch {
          // 静默跳过
        }
      };

      const interval = setInterval(doSave, saveTick);
      const handleBeforeUnload = () => {
        doSave();
      };
      window.addEventListener("beforeunload", handleBeforeUnload);

      // 每10条命令触发保存
      const checkCmdSave = () => {
        cmdCountRef.current++;
        // 脏状态跟踪：首次编辑操作通知外部
        if (!isDirtyRef.current) {
          isDirtyRef.current = true;
          onDirty?.(true);
        }
        if (cmdCountRef.current % cmdTrigger === 0) doSave();
      };
      commandRef.current.onChange(() => {
        setCanUndo(commandRef.current.canUndo());
        setCanRedo(commandRef.current.canRedo());
        checkCmdSave();
      });

      return () => {
        clearInterval(interval);
        window.removeEventListener("beforeunload", handleBeforeUnload);
        doSave(); // 组件卸载时保存
      };
    }, [state.width, state.height, bgColor, state.zoom, canvasId]);

    // 崩溃恢复检测（IndexedDB）
    const [showRecover, setShowRecover] = useState(false);
    const recoveredSnapRef = useRef<{ dataUrl: string; meta: SnapMeta } | null>(
      null,
    );
    useEffect(() => {
      if (initRef.current) {
        const keyPrefix = canvasId || "default";
        getLatestSnapshot(keyPrefix).then((snap) => {
          if (snap) {
            recoveredSnapRef.current = snap;
            setShowRecover(true);
          }
        }).catch(() => {
          // 快照恢复失败静默忽略（非关键功能）
        });
      }
    }, [canvasId]);

    const handleRecover = useCallback(async () => {
      const snap = recoveredSnapRef.current;
      if (!snap) return;
      setShowRecover(false);
      await handleLoadImage(snap.dataUrl);
    }, [handleLoadImage]);

    // Modal 模式：保存（canvas → toBlob → 传给外部 onSave）
    const handleModalSave = useCallback(async () => {
      try {
        const blob = await bufferRef.current.toBlob("png");
        await onSave?.(blob);
      } catch {
        CanvasLogger.error("Modal 保存失败");
      }
    }, [onSave]);

    // Modal 模式：取消（清理自动保存草稿）
    const handleModalCancel = useCallback(() => {
      if (canvasId) {
        clearAutoSave(canvasId);
      }
      onCancel?.();
    }, [canvasId, onCancel]);

    // 暴露 save 方法给父组件（EditLayer 的 Ctrl+S 快捷键调用）
    useImperativeHandle(
      ref,
      () => ({
        triggerSave: handleModalSave,
      }),
      [handleModalSave],
    );

    return (
      <div className={`flex flex-col bg-gray-900 ${containerHeight}`}>
        {/* 崩溃恢复提示 */}
        {showRecover && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-900/30 border-b border-amber-700/30 text-amber-300 text-xs">
            <span>检测到上次编辑的快照，是否恢复？</span>
            <button
              onClick={handleRecover}
              className="px-2 py-0.5 rounded bg-amber-700/40 hover:bg-amber-600/40 border-0 cursor-pointer text-amber-200"
            >
              恢复
            </button>
            <button
              onClick={() => setShowRecover(false)}
              className="px-2 py-0.5 rounded bg-gray-800/50 hover:bg-gray-700/50 border-0 cursor-pointer text-gray-400"
            >
              忽略
            </button>
          </div>
        )}

        {/* 画布尺寸调整对话框 */}
        {showResize && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
            onClick={() => setShowResize(false)}
          >
            <div
              className="bg-gray-800 border border-gray-600/40 rounded-lg p-4 shadow-xl min-w-[260px]"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-sm text-gray-200 mb-3">调整画布尺寸</h3>
              <div className="flex items-center gap-2 mb-3">
                <label className="text-xs text-gray-400">宽</label>
                <input
                  type="number"
                  defaultValue={state.width}
                  min={1}
                  max={4096}
                  onChange={(e) => {
                    resizeWRef.current =
                      parseInt(e.target.value) || state.width;
                  }}
                  className="w-20 h-7 px-2 text-xs bg-gray-700 border border-gray-600/40 rounded text-gray-200 outline-none focus:border-blue-500/50"
                />
                <label className="text-xs text-gray-400">高</label>
                <input
                  type="number"
                  defaultValue={state.height}
                  min={1}
                  max={4096}
                  onChange={(e) => {
                    resizeHRef.current =
                      parseInt(e.target.value) || state.height;
                  }}
                  className="w-20 h-7 px-2 text-xs bg-gray-700 border border-gray-600/40 rounded text-gray-200 outline-none focus:border-blue-500/50"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowResize(false)}
                  className="px-3 py-1 text-xs rounded bg-gray-700 hover:bg-gray-600 border-0 cursor-pointer text-gray-300"
                >
                  取消
                </button>
                <button
                  onClick={handleResizeCanvas}
                  className="px-3 py-1 text-xs rounded bg-blue-700/40 hover:bg-blue-600/40 border-0 cursor-pointer text-blue-200"
                >
                  确认
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 导出预览 */}
        {showPreview && previewUrl && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
            onClick={() => setShowPreview(false)}
          >
            <div
              className="bg-gray-800 border border-gray-600/40 rounded-lg p-4 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-sm text-gray-200 mb-3">
                导出预览 ({previewFormatRef.current.toUpperCase()})
              </h3>
              <div
                className="max-w-sm max-h-64 overflow-auto mb-3 bg-gray-950 rounded flex items-center justify-center"
                style={{ imageRendering: "pixelated" }}
              >
                <img
                  src={previewUrl}
                  alt="导出预览"
                  className="max-w-full max-h-64 object-contain"
                />
              </div>
              <div className="text-xs text-gray-500 mb-3">
                {state.width} × {state.height}
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowPreview(false)}
                  className="px-3 py-1 text-xs rounded bg-gray-700 hover:bg-gray-600 border-0 cursor-pointer text-gray-300"
                >
                  取消
                </button>
                <button
                  onClick={handleConfirmExport}
                  className="px-3 py-1 text-xs rounded bg-blue-700/40 hover:bg-blue-600/40 border-0 cursor-pointer text-blue-200"
                >
                  下载
                </button>
              </div>
            </div>
          </div>
        )}

        <CanvasToolbar
          state={state}
          canUndo={canUndo}
          canRedo={canRedo}
          paramsSchema={getTool(state.activeTool)?.paramsSchema}
          onToolChange={handleToolChange}
          onToolParamChange={handleToolParamChange}
          onFgColor={(c) => updateState({ fgColor: c })}
          onBgColor={(c) => updateState({ bgColor: c })}
          onStrokeWidth={(w) => updateState({ strokeWidth: w })}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onExport={handleExport}
          onResizeClick={() => setShowResize(true)}
          showExport={!onSave}
          onSave={onSave ? handleModalSave : undefined}
          onCancel={onCancel ? handleModalCancel : undefined}
        />
        <CanvasSurface
          state={state}
          transform={transformRef.current}
          buffer={bufferRef.current}
          commands={commandRef.current}
          setActiveTool={handleToolChange}
          onCursorMove={handleCursorMove}
          onStateChange={updateState}
          onLoadImage={handleLoadImage}
          onContextExport={handleExport}
          onContextClear={handleClearCanvas}
          onContextCrop={handleCrop}
          onContextFlip={handleFlip}
          onContextFilter={handleFilter}
          onContextNew={handleNewCanvas}
          onExportShortcut={() => handleExport("png")}
          onSelectionExport={handleSelectionExport}
          onDrawingChange={(drawing) => {
            isDrawingRef.current = drawing;
          }}
        />
        <CanvasStatusBar
          state={state}
          cursorPos={cursorPos}
          onZoomReset={() => {
            transformRef.current.setZoom(1);
            window.dispatchEvent(new Event("canvas-render"));
          }}
        />
      </div>
    );
  },
);

CanvasEditor.displayName = "CanvasEditor";
