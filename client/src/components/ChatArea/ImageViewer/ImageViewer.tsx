/**
 * ImageViewer
 * 图片查看器 lightbox — 点击放大、缩放（滚轮）、拖拽、下载、关闭（遮罩/ESC）
 */
import { useState, useEffect, useCallback } from "react";

interface Props {
  images: string[];
  initialIndex?: number;
  onClose: () => void;
}

export default function ImageViewer({ images, initialIndex = 0, onClose }: Props) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const currentUrl = images[currentIndex] || "";

  // ESC 关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && images.length > 1) {
        setCurrentIndex((prev) => (prev - 1 + images.length) % images.length);
        setScale(1);
        setOffset({ x: 0, y: 0 });
      }
      if (e.key === "ArrowRight" && images.length > 1) {
        setCurrentIndex((prev) => (prev + 1) % images.length);
        setScale(1);
        setOffset({ x: 0, y: 0 });
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, images.length]);

  // 滚轮缩放
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setScale((prev) => {
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      return Math.max(0.2, Math.min(5, prev + delta));
    });
  }, []);

  // 拖拽
  const handleMouseDown = (e: React.MouseEvent) => {
    if (scale <= 1) return;
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
    setScale((prev) => (prev > 1 ? 1 : 2));
    if (scale > 1) setOffset({ x: 0, y: 0 });
  };

  const handleDownload = () => {
    if (!currentUrl) return;
    const a = document.createElement("a");
    a.href = currentUrl;
    a.download = `image_${Date.now()}`;
    a.click();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onWheel={handleWheel}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* 关闭按钮 */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-white/70 hover:text-white text-2xl bg-transparent border-0 cursor-pointer z-10"
      >
        ✕
      </button>

      {/* 页数 */}
      {images.length > 1 && (
        <div className="absolute top-4 left-4 text-white/60 text-sm z-10">
          {currentIndex + 1} / {images.length}
        </div>
      )}

      {/* 下载按钮 */}
      <button
        onClick={handleDownload}
        className="absolute bottom-4 right-4 text-white/70 hover:text-white text-xl bg-transparent border-0 cursor-pointer z-10"
        title="Download"
      >
        ⬇
      </button>

      {/* 左箭头 */}
      {images.length > 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setCurrentIndex((prev) => (prev - 1 + images.length) % images.length);
            setScale(1);
            setOffset({ x: 0, y: 0 });
          }}
          className="absolute left-4 top-1/2 -translate-y-1/2 text-white/50 hover:text-white text-3xl bg-transparent border-0 cursor-pointer z-10"
        >
          ‹
        </button>
      )}

      {/* 右箭头 */}
      {images.length > 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setCurrentIndex((prev) => (prev + 1) % images.length);
            setScale(1);
            setOffset({ x: 0, y: 0 });
          }}
          className="absolute right-4 top-1/2 -translate-y-1/2 text-white/50 hover:text-white text-3xl bg-transparent border-0 cursor-pointer z-10"
        >
          ›
        </button>
      )}

      {/* 图片 */}
      <img
        src={currentUrl}
        alt="Preview"
        className="max-w-[90vw] max-h-[90vh] object-contain select-none"
        style={{
          transform: `scale(${scale}) translate(${offset.x / scale}px, ${offset.y / scale}px)`,
          cursor: scale > 1 ? (dragging ? "grabbing" : "grab") : "default",
          transition: dragging ? "none" : "transform 0.15s ease",
        }}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        draggable={false}
      />
    </div>
  );
}
