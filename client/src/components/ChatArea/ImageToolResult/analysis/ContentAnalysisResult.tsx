/**
 * ContentAnalysisResult — 内容特征卡片
 */
import { useTranslation } from "react-i18next";

interface Props { data: Record<string, unknown>; }

export default function ContentAnalysisResult({ data }: Props) {
  const { t } = useTranslation();
  const content = (data.content || data) as Record<string, unknown>;
  return (
    <div className="text-[10px] space-y-0.5">
      <div className="font-medium text-gray-300">{t("image.contentAnalysis")}</div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-gray-400">
        <span>{t("image.orientation")}: <span className="text-gray-300">
          {content.isSquare ? t("image.square") : content.isLandscape ? t("image.landscape") : content.isPortrait ? t("image.portrait") : "?"}
        </span></span>
        <span>{t("image.category")}: <span className="text-gray-300">{String(content.sizeCategory)}</span></span>
        <span>{t("image.density")}: <span className="text-gray-300">{String(content.contentDensity)}</span></span>
        <span>{t("image.sharpness")}: <span className="text-gray-300">{((Number(content.sharpness) || 0) * 100).toFixed(0)}%</span></span>
      </div>
    </div>
  );
}
