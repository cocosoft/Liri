/**
 * VisionAnalysisResult — AI 视觉描述文本
 */
import { useTranslation } from "react-i18next";

interface Props {
  data: Record<string, unknown>;
}

export default function VisionAnalysisResult({ data }: Props) {
  const { t } = useTranslation();
  const description = (data.description as string) || "";
  const durationMs = data.durationMs as number | undefined;

  return (
    <div className="space-y-1">
      <div className="text-[10px] font-medium text-gray-300">
        {t("image.visionAnalysis")}
      </div>
      <div className="text-[11px] text-gray-300 leading-relaxed">
        {description}
      </div>
      {durationMs !== undefined && (
        <div className="text-[10px] text-gray-500">
          {t("image.duration")}: {(durationMs / 1000).toFixed(1)}s
        </div>
      )}
    </div>
  );
}
