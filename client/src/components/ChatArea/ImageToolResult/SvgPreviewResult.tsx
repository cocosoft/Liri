/**
 * SvgPreviewResult
 * SVG 生成结果渲染 — 内嵌 SVG 预览 + 代码切换
 * 安全过滤：移除 <script> 标签和事件处理器
 */
import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  data: Record<string, unknown>;
}

/** 基础 SVG 安全过滤（复用后端 validateSvg 逻辑的前端子集） */
function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?<\/script>/gi, "")            // 移除 script 标签
    .replace(/\s+on\w+\s*=\s*"[^"]*"/gi, "")               // 移除事件处理器
    .replace(/\s+on\w+\s*=\s*'[^']*'/gi, "")
    .replace(/xlink:href\s*=\s*"javascript:[^"]*"/gi, "")  // 移除 javascript: 协议
    .replace(/<use[^>]*href\s*=\s*"data:[^"]*"[^>]*>/gi, ""); // 移除 data: URI
}

export default function SvgPreviewResult({ data }: Props) {
  const { t } = useTranslation();
  const [showCode, setShowCode] = useState(false);

  const rawSvg = (data.svg as string) || "";
  const filePath = (data.filePath as string) || undefined;
  const size = (data.size as string) || "";
  const validation = data.validation as { valid?: boolean; errors?: string[]; warnings?: string[] } | undefined;

  const safeSvg = useMemo(() => sanitizeSvg(rawSvg), [rawSvg]);

  return (
    <div className="space-y-2">
      {/* SVG 预览 */}
      {!showCode && safeSvg ? (
        <div className="bg-white/5 rounded p-2 flex justify-center">
          <div
            className="max-w-full overflow-hidden"
            dangerouslySetInnerHTML={{ __html: safeSvg }}
          />
        </div>
      ) : (
        <pre className="m-0 whitespace-pre-wrap break-words text-[10px] leading-relaxed text-[#a9b1d6] font-mono bg-black/15 p-2 rounded max-h-[300px] overflow-y-auto">
          {rawSvg}
        </pre>
      )}

      {/* 控制栏 */}
      <div className="flex flex-wrap items-center gap-2 text-[10px] text-gray-400">
        <button
          onClick={() => setShowCode(!showCode)}
          className="text-[#7aa2f7] hover:underline cursor-pointer bg-transparent border-0 p-0"
        >
          {showCode ? t("image.showPreview") : t("image.showCode")}
        </button>
        {size && <span>{t("image.size")}: {size}</span>}
        {filePath && <span className="text-gray-500">{t("image.saved")}: {filePath}</span>}
        {rawSvg && (
          <a
            href={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(rawSvg)}`}
            download={filePath ? filePath.split(/[/\\]/).pop() || "image.svg" : "image.svg"}
            className="text-[10px] px-2 py-0.5 rounded bg-blue-600/30 text-blue-300 hover:bg-blue-600/50 no-underline"
          >
            ↓ {t("image.download")}
          </a>
        )}
      </div>

      {/* 校验结果 */}
      {validation && !validation.valid && (
        <div className="bg-yellow-900/20 border border-yellow-800/40 rounded px-2 py-1 text-yellow-300 text-[10px]">
          {validation.errors?.map((err, i) => (
            <div key={i} className="text-red-400">Error: {err}</div>
          ))}
          {validation.warnings?.map((warn, i) => (
            <div key={i} className="text-yellow-400">Warning: {warn}</div>
          ))}
        </div>
      )}
    </div>
  );
}
