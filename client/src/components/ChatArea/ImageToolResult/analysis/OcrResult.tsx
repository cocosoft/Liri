/**
 * OcrResult — OCR 文字识别结果
 */
import { useTranslation } from "react-i18next";

interface Props { data: Record<string, unknown>; }

export default function OcrResult({ data }: Props) {
  const { t } = useTranslation();
  const text = (data.text as string) || "";
  const confidence = (data.confidence as number) ?? 0;
  const blocks = (data.blocks as Array<Record<string, unknown>>) || [];
  const language = (data.language as string) || "";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-[10px]">
        <span className="font-medium text-gray-300">{t("image.ocrResult")}</span>
        {language && <span className="text-gray-500">Lang: {language}</span>}
        <span className={`ml-auto ${confidence > 0.8 ? "text-green-400" : confidence > 0.5 ? "text-yellow-400" : "text-red-400"}`}>
          {(confidence * 100).toFixed(1)}%
        </span>
      </div>

      {blocks.length > 0 ? (
        <div className="space-y-1">
          {blocks.map((block, i) => (
            <div key={i} className="bg-white/5 rounded px-1.5 py-0.5 text-[10px] text-gray-300">
              {block.text as string}
              <span className="text-gray-500 ml-1">
                ({(Number(block.confidence) * 100).toFixed(0)}%)
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-[10px] text-gray-300 whitespace-pre-wrap">{text}</div>
      )}
    </div>
  );
}
