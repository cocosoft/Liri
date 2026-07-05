/**
 * ImageEditResult
 * 图片编辑结果渲染 — 输出路径 + 尺寸对比 + 批量结果 + 下载按钮
 */

import { useTranslation } from "react-i18next";
import { imageService } from "../../../services/imageService";

interface Props {
  data: Record<string, unknown>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function ImageEditResultView({ data }: Props) {
  const { t } = useTranslation();
  const action = (data.action as string) || "";
  const outputPath = (data.outputPath as string) || undefined;
  const originalSize = data.originalSize as number | undefined;
  const processedSize = data.processedSize as number | undefined;
  const width = data.width as number | undefined;
  const height = data.height as number | undefined;
  const aspectRatio = data.aspectRatio as number | undefined;
  const format = data.format as string | undefined;
  const batchResults = data.batchResults as Array<Record<string, unknown>> | undefined;

  const downloadUrl = outputPath ? imageService.getImageUrl(outputPath) : null;
  const fileName = outputPath ? outputPath.split(/[/\\]/).pop() || "edited_image" : "edited_image";

  // 批量结果
  if (batchResults && batchResults.length > 0) {
    return (
      <div className="space-y-1.5">
        <div className="text-[11px] text-gray-300 font-medium">
          Batch: {t("image.batchCount", { count: batchResults.length })}
        </div>
        <div className="space-y-0.5">
          {batchResults.map((item, i) => (
            <div key={i} className="flex items-center gap-2 text-[10px]">
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  item.action ? "bg-green-500" : "bg-red-500"
                }`}
              />
              <span className="text-gray-400">{String(item.action ?? '')}</span>
              {!!item.outputPath && (
                <span className="text-gray-500 truncate">
                  → {String(item.outputPath).split(/[/\\]/).pop()}
                </span>
              )}
              {item.width !== undefined && item.height !== undefined && (
                <span className="text-gray-600">
                  {String(item.width)}x{String(item.height)}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 单项结果
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-gray-400">
        <span>
          {t("image.action")}: <span className="text-gray-300">{action}</span>
        </span>
        {outputPath && (
          <span>
            Output:{" "}
            <span className="text-gray-300 font-mono">
              {outputPath.split(/[/\\]/).pop()}
            </span>
          </span>
        )}
        {format && (
          <span>
            {t("image.outputFormat")}: <span className="text-gray-300">{format}</span>
          </span>
        )}
      </div>

      {/* 尺寸对比 */}
      {width && height && (
        <div className="text-[10px] text-gray-500">
          {t("image.dimensions")}: <span className="text-gray-300">{width}x{height}</span>
          {aspectRatio && (
            <span className="ml-1">(AR: {aspectRatio.toFixed(3)})</span>
          )}
        </div>
      )}

      {/* 文件大小对比 */}
      {originalSize !== undefined && processedSize !== undefined && (
        <div className="flex items-center gap-2 text-[10px]">
          <span className="text-gray-500">
            {formatBytes(originalSize)} →{" "}
            <span className="text-gray-300">{formatBytes(processedSize)}</span>
          </span>
          {originalSize > 0 && (
            <span
              className={
                processedSize < originalSize
                  ? "text-green-500"
                  : "text-yellow-500"
              }
            >
              ({processedSize < originalSize ? "-" : "+"}
              {Math.abs(
                Math.round(
                  ((processedSize - originalSize) / originalSize) * 100
                )
              )}
              %)
            </span>
          )}
        </div>
      )}

      {/* 下载按钮 */}
      {downloadUrl && (
        <a
          href={downloadUrl}
          download={fileName}
          className="inline-block text-[10px] px-2 py-1 rounded bg-blue-600/30 text-blue-300 hover:bg-blue-600/50 no-underline"
        >
          ↓ {t("image.download")}
        </a>
      )}
    </div>
  );
}
