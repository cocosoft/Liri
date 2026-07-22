/**
 * CanvasResult
 * 画布操作结果渲染 — 缩略图 + 格式/尺寸信息 + 下载按钮
 */
import { useTranslation } from "react-i18next";
import { imageService } from "../../../services/imageService";

interface Props {
  data: Record<string, unknown>;
}

export default function CanvasResultView({ data }: Props) {
  const { t } = useTranslation();
  const canvasId = (data.canvasId as string) || "";
  const width = (data.width as number) || 0;
  const height = (data.height as number) || 0;
  const elementCount = (data.elementCount as number) || 0;
  const format = (data.format as string) || "png";
  const outputPath = (data.outputPath as string) || undefined;

  const imageUrl = outputPath ? imageService.getImageUrl(outputPath) : null;

  return (
    <div className="space-y-2">
      {/* 画布缩略图 */}
      {imageUrl ? (
        <div className="bg-white/5 rounded overflow-hidden">
          <img
            src={imageUrl}
            alt={`${t("image.canvas")} ${canvasId}`}
            className="w-full max-w-[400px] h-auto object-contain"
            loading="lazy"
          />
        </div>
      ) : (
        <div className="bg-gray-800/50 rounded p-3 flex items-center justify-center text-gray-500 text-xs">
          <div className="text-center space-y-1">
            <div>
              {width} x {height}
            </div>
            <div>{elementCount} elements</div>
            <div className="text-[10px]">{t("image.noExport")}</div>
          </div>
        </div>
      )}

      {/* 画布信息 */}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-gray-400">
        <span>
          ID:{" "}
          <span className="text-gray-300 font-mono">
            {canvasId.slice(0, 16)}...
          </span>
        </span>
        <span>
          {t("image.size")}:{" "}
          <span className="text-gray-300">
            {width}x{height}
          </span>
        </span>
        <span>
          {t("image.elements")}:{" "}
          <span className="text-gray-300">{elementCount}</span>
        </span>
        <span>
          {t("image.outputFormat")}:{" "}
          <span className="text-gray-300">{format}</span>
        </span>
      </div>

      {/* 下载按钮 */}
      {imageUrl && (
        <a
          href={imageUrl}
          download={`canvas_${canvasId}.${format}`}
          className="inline-block text-[10px] px-2 py-1 rounded bg-blue-600/30 text-blue-300 hover:bg-blue-600/50 no-underline"
        >
          {t("image.download")}
        </a>
      )}
    </div>
  );
}
