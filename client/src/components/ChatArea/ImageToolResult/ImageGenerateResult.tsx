/**
 * ImageGenerateResult
 * 图片生成结果渲染 — 图片网格 + 点击放大 + 费用/Provider 信息
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import ImageViewer from "../ImageViewer/ImageViewer";

interface Props {
  data: Record<string, unknown>;
}

export default function ImageGenerateResult({ data }: Props) {
  const { t } = useTranslation();
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);

  const images = (data.images as Array<Record<string, string>>) || [];
  const usedProvider = (data.usedProvider as string) || "unknown";
  const model = (data.model as string) || "";
  const totalCostUsd = (data.totalCostUsd as number) ?? 0;
  const costBreakdown = (data.costBreakdown as Array<Record<string, unknown>>) || [];

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
        {images.map((img, i) => (
          <button
            key={i}
            onClick={() => handleImageClick(i)}
            className="block w-full cursor-pointer border-0 p-0 bg-transparent rounded overflow-hidden hover:ring-1 hover:ring-blue-400/50 transition-shadow"
            title={img.alt || `${t("image.title")} ${i + 1}`}
          >
            <img
              src={getSrc(img)}
              alt={img.alt || `${t("image.title")} ${i + 1}`}
              className="w-full h-auto object-cover"
              loading="lazy"
            />
          </button>
        ))}
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
