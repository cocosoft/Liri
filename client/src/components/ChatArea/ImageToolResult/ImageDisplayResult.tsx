/**
 * ImageDisplayResult
 * 图片预览结果渲染 — 多图缩略图网格 + 点击放大 + 引用/下载
 */
import { useState } from "react";
import { useChatStore } from "../../../stores/chat";
import { createLogger } from "@/utils/logger";
import ImageViewer from "../ImageViewer/ImageViewer";

const logger = createLogger("components:imageDisplayResult");

interface DisplayImage {
  url: string;
  name: string;
  size?: number;
  originalPath: string;
}

interface Props {
  data: Record<string, unknown>;
}

/** 格式化文件大小 */
function formatSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ImageDisplayResult({ data }: Props) {
  const sendMessage = useChatStore((s) => s.sendMessage);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);

  const innerData = (data.data as Record<string, unknown>) ?? data;
  const images =
    (innerData.images as DisplayImage[]) ||
    (data.images as DisplayImage[]) ||
    [];

  if (images.length === 0) {
    return (
      <div className="text-gray-500 text-xs italic px-2 py-1">
        没有可显示的图片
      </div>
    );
  }

  const handleClick = (index: number) => {
    setViewerIndex(index);
    setViewerOpen(true);
  };

  /** 引用图片 — 发送图片让 AI 分析（修复：原实现只发纯文本"请分析这张图片"，无图片附件，AI 看不到图） */
  const handleCite = (img: DisplayImage) => {
    const attached = [
      {
        path: img.originalPath || img.url,
        url: img.url,
        filename: img.name,
        size: img.size ?? 0,
      },
    ];
    logger.info("ImageDisplayResult: 发送图片分析", {
      filename: img.name,
      path: attached[0].path,
      url: img.url,
    });
    sendMessage("请分析这张图片", undefined, attached);
  };

  /** 复制图片引用到剪贴板 */
  const handleCopyCite = async (img: DisplayImage) => {
    const markdown = `![${img.name}](${img.url})`;
    try {
      await navigator.clipboard.writeText(markdown);
    } catch {
      // fallback
    }
  };

  const imageUrls = images.map((img) => img.url);

  // 网格列数：1张=1列，2张=2列，3+=3列
  const gridCols =
    images.length === 1
      ? "grid-cols-1"
      : images.length === 2
        ? "grid-cols-2"
        : "grid-cols-3";

  return (
    <div className="space-y-2">
      {/* 缩略图网格 */}
      <div className={`grid gap-1.5 ${gridCols}`}>
        {images.map((img, i) => (
          <div key={i} className="relative group">
            {/* 缩略图按钮 */}
            <button
              onClick={() => handleClick(i)}
              className="block w-full cursor-pointer border-0 p-0 bg-transparent rounded overflow-hidden hover:ring-1 hover:ring-blue-400/50 transition-shadow"
              title={`${img.name}${img.size ? ` (${formatSize(img.size)})` : ""}`}
            >
              <img
                src={img.url}
                alt={img.name}
                className="w-full h-24 object-cover"
                loading="lazy"
              />
            </button>

            {/* 底部文件名 */}
            <div className="mt-0.5 text-[9px] text-gray-400 truncate px-0.5">
              {img.name}
              {img.size ? ` · ${formatSize(img.size)}` : ""}
            </div>

            {/* 悬浮操作按钮 */}
            <div className="absolute top-0.5 right-0.5 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleCite(img);
                }}
                className="px-1 py-0.5 rounded text-[10px] bg-gray-900/80 text-green-300 hover:bg-gray-800 border-0 cursor-pointer"
                title="引用到对话"
              >
                💬
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleCopyCite(img);
                }}
                className="px-1 py-0.5 rounded text-[10px] bg-gray-900/80 text-blue-300 hover:bg-gray-800 border-0 cursor-pointer"
                title="复制引用"
              >
                📋
              </button>
              <a
                href={img.url}
                download={img.name}
                className="px-1 py-0.5 rounded text-[10px] bg-gray-900/80 text-gray-300 hover:bg-gray-800 no-underline"
                onClick={(e) => e.stopPropagation()}
                title="下载"
              >
                ↓
              </a>
            </div>
          </div>
        ))}
      </div>

      {/* 底部操作栏 */}
      <div className="flex items-center justify-between text-[10px] text-gray-400">
        <span>共 {images.length} 张图片</span>
        <button
          onClick={() => {
            const attachedImages = images.map((img) => ({
              path: img.originalPath || img.url,
              url: img.url,
              filename: img.name,
              size: img.size ?? 0,
            }));
            logger.info("ImageDisplayResult: 发送全部图片分析", {
              count: attachedImages.length,
            });
            sendMessage("请分析以下图片", undefined, attachedImages);
          }}
          className="text-blue-400 hover:text-blue-300 bg-transparent border-0 cursor-pointer"
        >
          全部引用
        </button>
      </div>

      {/* 图片查看器 Lightbox */}
      {viewerOpen && (
        <ImageViewer
          images={imageUrls}
          initialIndex={viewerIndex}
          onClose={() => setViewerOpen(false)}
        />
      )}
    </div>
  );
}
