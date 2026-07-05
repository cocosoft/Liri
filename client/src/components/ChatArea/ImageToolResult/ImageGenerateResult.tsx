/**
 * ImageGenerateResult
 * 图片生成结果渲染 — 图片网格 + 点击放大 + 费用/Provider 信息 + 操作按钮
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useChatStore } from "../../../stores/chatStore";
import ImageViewer from "../ImageViewer/ImageViewer";

interface Props {
  data: Record<string, unknown>;
}

export default function ImageGenerateResult({ data }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const sendMessage = useChatStore((s) => s.sendMessage);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);

  // 解包双重嵌套：CoreAPIImpl 可能将 resultData 再包装为 { success: true, data: resultData }
  // 导致 data = { success: true, data: { images: [...] } }
  const innerData = (data.data as Record<string, unknown>) ?? data;
  const images = (innerData.images as Array<Record<string, string>>) || (data.images as Array<Record<string, string>>) || [];
  const usedProvider = (innerData.usedProvider as string) || (data.usedProvider as string) || "unknown";
  const model = (innerData.model as string) || (data.model as string) || "";
  const totalCostUsd = (innerData.totalCostUsd as number) ?? (data.totalCostUsd as number) ?? 0;
  const costBreakdown = (innerData.costBreakdown as Array<Record<string, unknown>>) || (data.costBreakdown as Array<Record<string, unknown>>) || [];

  if (images.length === 0) {
    return <div className="text-gray-500 text-xs italic px-2 py-1">{t("image.noImagesGenerated")}</div>;
  }

  const handleImageClick = (index: number) => {
    setViewerIndex(index);
    setViewerOpen(true);
  };

  // 优先使用本地持久化 URL（刷新后不丢失），fallback 到远程 URL
  const imageUrls = images.map((img) => img.localUrl || img.url || "");
  const getSrc = (img: Record<string, string>) => img.localUrl || img.url || "";

  return (
    <div className="space-y-2">
      {/* 图片网格 */}
      <div
        className={`grid gap-1.5 ${
          images.length === 1
            ? "grid-cols-1"
            : images.length === 2
              ? "grid-cols-2"
              : "grid-cols-2"
        }`}
      >
        {images.map((img, i) => {
          const src = getSrc(img);
          const alt = img.alt || `${t("image.title")} ${i + 1}`;
          return (
            <div key={i} className="relative group">
              <button
                onClick={() => handleImageClick(i)}
                className="block w-full cursor-pointer border-0 p-0 bg-transparent rounded overflow-hidden hover:ring-1 hover:ring-blue-400/50 transition-shadow"
                title={alt}
              >
                <img
                  src={src}
                  alt={alt}
                  className="w-full h-auto object-cover"
                  loading="lazy"
                />
              </button>

              {/* 悬浮操作按钮 */}
              <div className="absolute bottom-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <a
                  href={src}
                  download={alt.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, "_").slice(0, 50)}
                  className="px-1.5 py-0.5 rounded text-[10px] bg-gray-900/80 text-gray-300 hover:bg-gray-800 no-underline"
                  onClick={(e) => e.stopPropagation()}
                  title={t("image.download")}
                >
                  ↓
                </a>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    sendMessage("请分析这张图片");
                  }}
                  className="px-1.5 py-0.5 rounded text-[10px] bg-gray-900/80 text-blue-300 hover:bg-gray-800 border-0 cursor-pointer"
                  title={t("image.analyze")}
                >
                  🔍
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* 全局操作按钮 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => navigate("/image")}
          className="text-[10px] px-2 py-0.5 rounded bg-blue-600/20 text-blue-300 hover:bg-blue-600/30 border-0 cursor-pointer"
        >
          {t("image.openInEditor")}
        </button>
        {images.length === 1 && (
          <button
            onClick={() => sendMessage("请分析这张图片")}
            className="text-[10px] px-2 py-0.5 rounded bg-purple-600/20 text-purple-300 hover:bg-purple-600/30 border-0 cursor-pointer"
          >
            {t("image.analyze")}
          </button>
        )}
      </div>

      {/* 元信息 */}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-gray-400">
        {usedProvider && (
          <span>
            {t("image.provider")}: <span className="text-gray-300">{usedProvider}</span>
          </span>
        )}
        {model && (
          <span>
            {t("image.model")}: <span className="text-gray-300">{model}</span>
          </span>
        )}
        {totalCostUsd > 0 && (
          <span>
            {t("image.cost")}: <span className="text-green-400">${totalCostUsd.toFixed(4)}</span>
          </span>
        )}
      </div>

      {/* 费用明细（可折叠） */}
      {costBreakdown.length > 0 && (
        <details className="text-[10px] text-gray-500">
          <summary className="cursor-pointer hover:text-gray-400">{t("image.costBreakdown")}</summary>
          <div className="mt-1 space-y-0.5">
            {costBreakdown.map((item, i) => (
              <div key={i} className="flex gap-2">
                <span>{item.provider as string}</span>
                <span className={item.status === "success" ? "text-green-500" : "text-red-400"}>
                  {item.status as string}
                </span>
                <span className="text-gray-400">${(item.estimatedCostUsd as number)?.toFixed(4) || "0"}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* 图片查看器 */}
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
