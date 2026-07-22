/**
 * ImageViewer
 * 图片查看器 lightbox — 点击放大、缩放（滚轮）、拖拽、下载、关闭（遮罩/ESC）
 * Phase 2 增强：旋转、翻转、实际大小、缩放滑块、全屏、快捷键
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { handleClientError } from "../../../utils/handleError";

/** 变换状态：统一管理缩放、旋转、翻转 */
interface TransformState {
  scale: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
}

interface Props {
  images: string[];
  initialIndex?: number;
  onClose: () => void;
  /** 删除当前图片回调 */
  onDelete?: () => void;
}

export default function ImageViewer({
  images,
  initialIndex = 0,
  onClose,
  onDelete,
}: Props) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [transform, setTransform] = useState<TransformState>({
    scale: 1,
    rotation: 0,
    flipX: false,
    flipY: false,
  });
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const isFullscreenRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentUrl = images[currentIndex] || "";

  /** 重置变换到初始状态 */
  const resetTransform = useCallback(() => {
    setTransform({ scale: 1, rotation: 0, flipX: false, flipY: false });
    setOffset({ x: 0, y: 0 });
  }, []);

  /** 切换图片时重置变换 */
  const goToImage = useCallback(
    (index: number) => {
      setCurrentIndex(index);
      resetTransform();
    },
    [resetTransform],
  );

  /** images 变化时修正越界的 currentIndex */
  useEffect(() => {
    if (currentIndex >= images.length) {
      setCurrentIndex(Math.max(0, images.length - 1));
    }
  }, [images, currentIndex]);

  /** 更新缩放 */
  const setScale = useCallback((newScale: number) => {
    setTransform((prev) => ({
      ...prev,
      scale: Math.max(0.25, Math.min(4, newScale)),
    }));
  }, []);

  // 快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isFullscreenRef.current) {
          document.exitFullscreen().catch(() => {});
          isFullscreenRef.current = false;
          setIsFullscreen(false);
        } else {
          onClose();
        }
        return;
      }

      // 导航
      if (e.key === "ArrowLeft" && images.length > 1) {
        goToImage((currentIndex - 1 + images.length) % images.length);
      }
      if (e.key === "ArrowRight" && images.length > 1) {
        goToImage((currentIndex + 1) % images.length);
      }

      // 缩放
      if (e.key === "+" || e.key === "=") {
        setTransform((prev) => ({
          ...prev,
          scale: Math.min(4, prev.scale + 0.25),
        }));
      }
      if (e.key === "-") {
        setTransform((prev) => ({
          ...prev,
          scale: Math.max(0.25, prev.scale - 0.25),
        }));
      }
      if (e.key === "0" && !e.ctrlKey && !e.metaKey) {
        setTransform((prev) => ({ ...prev, scale: 1 }));
      }
      if (e.key === "0" && (e.ctrlKey || e.metaKey)) {
        resetTransform();
      }

      // 旋转
      if (e.key === "r" || e.key === "R") {
        setTransform((prev) => ({
          ...prev,
          rotation: prev.rotation + 90,
        }));
      }

      // 翻转
      if (e.key === "h" || e.key === "H") {
        setTransform((prev) => ({ ...prev, flipX: !prev.flipX }));
      }
      if (e.key === "v" || e.key === "V") {
        setTransform((prev) => ({ ...prev, flipY: !prev.flipY }));
      }

      // 全屏
      if (e.key === "f" || e.key === "F") {
        toggleFullscreen();
      }

      // 删除
      if (e.key === "Delete" && onDelete) {
        onDelete();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    onClose,
    images.length,
    currentIndex,
    goToImage,
    resetTransform,
    onDelete,
    isFullscreen,
  ]);

  /** 全屏切换 */
  const toggleFullscreen = useCallback(async () => {
    if (isFullscreenRef.current) {
      await document.exitFullscreen().catch(() => {});
      isFullscreenRef.current = false;
      setIsFullscreen(false);
    } else {
      try {
        await containerRef.current?.requestFullscreen();
        isFullscreenRef.current = true;
        setIsFullscreen(true);
      } catch (e) {
        handleClientError(e, { module: "components:chat:ImageViewer", action: "toggleFullscreen" });
        // 浏览器拒绝全屏（如 iframe 限制等），忽略
      }
    }
  }, []);

  // 监听原生全屏退出
  useEffect(() => {
    const handler = () => {
      if (!document.fullscreenElement) {
        isFullscreenRef.current = false;
        setIsFullscreen(false);
      }
    };
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  // 滚轮缩放（使用原生事件绑定以支持 preventDefault）
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handler = (e: WheelEvent) => {
      e.preventDefault();
      setTransform((prev) => {
        const next = {
          ...prev,
          scale: prev.scale + (e.deltaY > 0 ? -0.1 : 0.1),
        };
        if (next.scale < 0.25) next.scale = 0.25;
        if (next.scale > 4) next.scale = 4;
        return next;
      });
    };

    container.addEventListener("wheel", handler, { passive: false });
    return () => container.removeEventListener("wheel", handler);
  }, []);

  // 拖拽
  const handleMouseDown = (e: React.MouseEvent) => {
    if (transform.scale <= 1) return;
    setDragging(true);
    setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return;
    setOffset({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handleMouseUp = () => setDragging(false);

  // 双击缩放
  const handleDoubleClick = () => {
    if (transform.scale > 1) {
      setTransform((prev) => ({ ...prev, scale: 1 }));
      setOffset({ x: 0, y: 0 });
    } else {
      setTransform((prev) => ({ ...prev, scale: 2 }));
    }
  };

  const handleDownload = async () => {
    if (!currentUrl) return;
    try {
      const res = await fetch(currentUrl);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const ext = currentUrl.split(".").pop()?.split("?")[0] || "png";
      a.download = `image_${Date.now()}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      const a = document.createElement("a");
      a.href = currentUrl;
      a.download = `image_${Date.now()}`;
      a.click();
    }
  };

  const isTransformed =
    transform.rotation !== 0 || transform.flipX || transform.flipY;

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* ──── 顶部工具栏 ──── */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-2 z-10 bg-gradient-to-b from-black/60 to-transparent">
        {/* 左侧：页数 */}
        {images.length > 1 && (
          <span className="text-white/60 text-sm">
            {currentIndex + 1} / {images.length}
          </span>
        )}
        {images.length <= 1 && <span />}

        {/* 右侧：关闭 */}
        <button
          onClick={onClose}
          className="text-white/70 hover:text-white text-xl bg-transparent border-0 cursor-pointer"
        >
          ✕
        </button>
      </div>

      {/* ──── 底部工具栏 ──── */}
      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-center gap-2 px-4 py-2 z-10 bg-gradient-to-t from-black/60 to-transparent">
        <div className="flex items-center gap-1 rounded-lg bg-black/50 px-2 py-1">
          {/* 缩放 - */}
          <button
            onClick={() => setScale(transform.scale - 0.25)}
            className="text-white/70 hover:text-white text-sm px-1"
            title="缩小 (-)"
          >
            −
          </button>

          {/* 缩放滑块 */}
          <input
            type="range"
            id="image-zoom-slider"
            min="25"
            max="400"
            value={Math.round(transform.scale * 100)}
            onChange={(e) => setScale(Number(e.target.value) / 100)}
            className="w-20 h-1 accent-white cursor-pointer"
            title={`${Math.round(transform.scale * 100)}%`}
          />

          {/* 缩放 + */}
          <button
            onClick={() => setScale(transform.scale + 0.25)}
            className="text-white/70 hover:text-white text-sm px-1"
            title="放大 (+)"
          >
            +
          </button>

          {/* 缩放百分比 */}
          <span className="text-white/50 text-xs min-w-[3ch] text-center">
            {Math.round(transform.scale * 100)}%
          </span>
        </div>

        {/* 分隔线 */}
        <div className="w-px h-4 bg-white/20" />

        {/* 实际大小 */}
        <button
          onClick={() => {
            setTransform((prev) => ({ ...prev, scale: 1 }));
            setOffset({ x: 0, y: 0 });
          }}
          className={`text-white/70 hover:text-white text-sm px-2 ${transform.scale === 1 && !isTransformed ? "text-white" : ""}`}
          title="实际大小 (0)"
        >
          1:1
        </button>

        {/* 适应窗口 */}
        <button
          onClick={resetTransform}
          className={`text-white/70 hover:text-white text-sm px-2 ${!isTransformed && transform.scale === 1 ? "text-white" : ""}`}
          title="适应窗口 (Ctrl+0)"
        >
          ⊡
        </button>

        {/* 旋转 */}
        <button
          onClick={() =>
            setTransform((prev) => ({ ...prev, rotation: prev.rotation + 90 }))
          }
          className={`text-white/70 hover:text-white text-sm px-2 ${transform.rotation !== 0 ? "text-white" : ""}`}
          title="旋转90° (R)"
        >
          ↻
        </button>

        {/* 水平翻转 */}
        <button
          onClick={() =>
            setTransform((prev) => ({ ...prev, flipX: !prev.flipX }))
          }
          className={`text-white/70 hover:text-white text-sm px-2 ${transform.flipX ? "text-white" : ""}`}
          title="水平翻转 (H)"
        >
          ⇔
        </button>

        {/* 垂直翻转 */}
        <button
          onClick={() =>
            setTransform((prev) => ({ ...prev, flipY: !prev.flipY }))
          }
          className={`text-white/70 hover:text-white text-sm px-2 ${transform.flipY ? "text-white" : ""}`}
          title="垂直翻转 (V)"
        >
          ⇕
        </button>

        {/* 分隔线 */}
        <div className="w-px h-4 bg-white/20" />

        {/* 全屏 */}
        <button
          onClick={toggleFullscreen}
          className="text-white/70 hover:text-white text-sm px-2"
          title="全屏 (F)"
        >
          {isFullscreen ? "⤓" : "⤢"}
        </button>

        {/* 下载 */}
        <button
          onClick={handleDownload}
          className="text-white/70 hover:text-white text-sm px-2"
          title="下载"
        >
          ⬇
        </button>

        {/* 删除 */}
        {onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="text-white/70 hover:text-red-400 text-sm px-2"
            title="删除 (Delete)"
          >
            🗑
          </button>
        )}
      </div>

      {/* ──── 左右导航箭头 ──── */}
      {images.length > 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            goToImage((currentIndex - 1 + images.length) % images.length);
          }}
          className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40 hover:text-white text-4xl bg-transparent border-0 cursor-pointer z-10"
        >
          ‹
        </button>
      )}
      {images.length > 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            goToImage((currentIndex + 1) % images.length);
          }}
          className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40 hover:text-white text-4xl bg-transparent border-0 cursor-pointer z-10"
        >
          ›
        </button>
      )}

      {/* ──── 图片 ──── */}
      <img
        src={currentUrl}
        alt="Preview"
        className="max-w-[90vw] max-h-[85vh] object-contain select-none"
        style={{
          transform: [
            `scale(${transform.scale})`,
            `rotate(${transform.rotation}deg)`,
            transform.flipX ? `scaleX(-1)` : "",
            transform.flipY ? `scaleY(-1)` : "",
            `translate(${offset.x / transform.scale}px, ${offset.y / transform.scale}px)`,
          ]
            .filter(Boolean)
            .join(" "),
          cursor:
            transform.scale > 1 ? (dragging ? "grabbing" : "grab") : "default",
          transition: dragging ? "none" : "transform 0.15s ease",
        }}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        draggable={false}
      />

      {/* ──── 变换状态指示器（旋转/翻转时显示） ──── */}
      {isTransformed && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 rounded bg-black/50 px-2 py-0.5 text-white/60 text-xs">
          {transform.rotation !== 0 && `${transform.rotation % 360}° `}
          {transform.flipX && "水平翻转 "}
          {transform.flipY && "垂直翻转"}
        </div>
      )}
    </div>
  );
}
