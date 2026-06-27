/**
 * CompareAnalysisResult — 图片对比结果
 */
import { useTranslation } from "react-i18next";

interface Props { data: Record<string, unknown>; }

export default function CompareAnalysisResult({ data }: Props) {
  const { t } = useTranslation();
  const comparison = (data.comparison || data) as Record<string, unknown>;
  return (
    <div className="text-[10px] space-y-0.5">
      <div className="font-medium text-gray-300">{t("image.compareResult")}</div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-gray-400">
        <span>{t("image.sameDimensions")}: <span className={comparison.sameDimensions ? "text-green-400" : "text-yellow-400"}>{String(comparison.sameDimensions)}</span></span>
        {comparison.sizeRatio !== undefined && <span>{t("image.sizeRatio")}: <span className="text-gray-300">{Number(comparison.sizeRatio).toFixed(2)}x</span></span>}
        <span>{t("image.sameFormat")}: <span className={comparison.sameFormat ? "text-green-400" : "text-yellow-400"}>{String(comparison.sameFormat)}</span></span>
      </div>
    </div>
  );
}
