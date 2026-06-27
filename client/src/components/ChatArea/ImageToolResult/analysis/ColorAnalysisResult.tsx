/**
 * ColorAnalysisResult — 色彩方块 + 占比条
 */
import { useTranslation } from "react-i18next";

interface Props { data: Record<string, unknown>; }

export default function ColorAnalysisResult({ data }: Props) {
  const { t } = useTranslation();
  const colors = (data.colors || data) as Record<string, unknown>;
  const dominantColors = (colors.dominantColors as Array<Record<string, unknown>>) || [];
  const brightness = (colors.brightness as number) ?? 0;
  const colorfulness = (colors.colorfulness as number) ?? 0;
  const palette = (colors.palette as string) || "";

  return (
    <div className="space-y-1.5">
      <div className="text-[10px] font-medium text-gray-300">{t("image.colorAnalysis")}</div>
      <div className="flex flex-wrap gap-1">
        {dominantColors.map((c, i) => {
          const hex = (c.hex as string) || "#000";
          const pct = ((c.percentage as number) || 0) * 100;
          return (
            <div key={i} className="text-center">
              <div
                className="w-6 h-6 rounded border border-gray-600"
                style={{ backgroundColor: hex }}
                title={`${hex} (${pct.toFixed(1)}%)`}
              />
              <div className="text-[8px] text-gray-400 mt-0.5">{pct.toFixed(0)}%</div>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-2 text-[10px] text-gray-400">
        <span>{t("image.palette")}: <span className="text-gray-300">{palette}</span></span>
        <span>{t("image.brightness")}: <span className="text-gray-300">{(brightness * 100).toFixed(0)}%</span></span>
        <span>{t("image.colorfulness")}: <span className="text-gray-300">{(colorfulness * 100).toFixed(0)}%</span></span>
      </div>
    </div>
  );
}
