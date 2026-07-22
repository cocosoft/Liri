/**
 * MetadataResult — 图片元数据表格
 */
import { useTranslation } from "react-i18next";

interface Props {
  data: Record<string, unknown>;
}

export default function MetadataResult({ data }: Props) {
  const { t } = useTranslation();
  const meta = (data.metadata || data) as Record<string, unknown>;
  return (
    <div className="text-[10px] space-y-0.5">
      <div className="font-medium text-gray-300">
        {t("image.imageMetadata")}
      </div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
        {!!meta.filePath && (
          <>
            <span className="text-gray-500">{t("image.file")}</span>
            <span className="text-gray-300 truncate font-mono">
              {String(meta.filePath).split(/[/\\]/).pop()}
            </span>
          </>
        )}
        {meta.fileSize !== undefined && (
          <>
            <span className="text-gray-500">{t("image.size")}</span>
            <span className="text-gray-300">
              {(Number(meta.fileSize) / 1024).toFixed(1)} KB
            </span>
          </>
        )}
        {!!meta.format && (
          <>
            <span className="text-gray-500">{t("image.outputFormat")}</span>
            <span className="text-gray-300">{String(meta.format)}</span>
          </>
        )}
        {!!meta.width && (
          <>
            <span className="text-gray-500">{t("image.dimensions")}</span>
            <span className="text-gray-300">
              {String(meta.width)} x {String(meta.height)}
            </span>
          </>
        )}
        {meta.aspectRatio !== undefined && (
          <>
            <span className="text-gray-500">{t("image.aspectRatio")}</span>
            <span className="text-gray-300">
              {Number(meta.aspectRatio).toFixed(3)}
            </span>
          </>
        )}
        {!!meta.mimeType && (
          <>
            <span className="text-gray-500">{t("image.mimeType")}</span>
            <span className="text-gray-300">{String(meta.mimeType)}</span>
          </>
        )}
      </div>
    </div>
  );
}
