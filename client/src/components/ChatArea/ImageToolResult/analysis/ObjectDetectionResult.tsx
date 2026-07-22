/**
 * ObjectDetectionResult — 目标检测结果列表
 */
import { useTranslation } from "react-i18next";

interface Props {
  data: Record<string, unknown>;
}

export default function ObjectDetectionResult({ data }: Props) {
  const { t } = useTranslation();
  const objects = (data.objects as Array<Record<string, unknown>>) || [];
  const count = (data.count as number) || objects.length;
  const model = (data.model as string) || "";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-[10px]">
        <span className="font-medium text-gray-300">
          {t("image.objectDetection")}
        </span>
        {model && (
          <span className="text-gray-500">
            {t("image.model")}: {model}
          </span>
        )}
        <span className="ml-auto text-gray-400">{count} objects</span>
      </div>
      <div className="space-y-0.5">
        {objects.map((obj, i) => {
          const label = (obj.label as string) || "?";
          const confidence = (obj.confidence as number) || 0;
          const bbox = obj.bbox as Record<string, number> | undefined;
          return (
            <div key={i} className="flex items-center gap-2 text-[10px]">
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  confidence > 0.7
                    ? "bg-green-500"
                    : confidence > 0.4
                      ? "bg-yellow-500"
                      : "bg-red-500"
                }`}
              />
              <span className="text-gray-300">{label}</span>
              <span
                className={
                  confidence > 0.7 ? "text-green-500" : "text-yellow-500"
                }
              >
                {(confidence * 100).toFixed(0)}%
              </span>
              {bbox && (
                <span className="text-gray-600 ml-auto">
                  ({bbox.x}, {bbox.y}, {bbox.width}x{bbox.height})
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
