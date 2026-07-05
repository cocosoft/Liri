/**
 * ImageToolResult
 * 图片工具结果状态路由 — 四态分发（loading / failed / empty / success）
 */
import { useTranslation } from "react-i18next";
import type { ToolCall } from "../../../types";
import ImageGenerateResult from "./ImageGenerateResult";
import SvgPreviewResult from "./SvgPreviewResult";
import CanvasResultView from "./CanvasResult";
import ImageEditResultView from "./ImageEditResult";
import AnalysisResultCard from "./analysis/AnalysisResultCard";

interface Props {
  toolCall: ToolCall;
}

/** 检查数据是否为空 */
function isEmpty(data: unknown): boolean {
  if (!data) return true;
  if (typeof data === "object") {
    const obj = data as Record<string, unknown>;
    // images 数组为空
    if (Array.isArray(obj.images) && obj.images.length === 0) return true;
    // 空画布
    if (obj.canvasId && obj.elementCount === 0 && !obj.outputPath) return true;
  }
  return false;
}

function LoadingSkeleton() {
  return (
    <div className="animate-pulse space-y-2 p-2">
      <div className="h-4 bg-gray-700/30 rounded w-3/4" />
      <div className="h-20 bg-gray-700/20 rounded" />
    </div>
  );
}

function ErrorBanner({ error }: { error: string }) {
  return (
    <div className="bg-red-900/20 border border-red-800/40 rounded px-3 py-2 text-red-300 text-xs">
      {typeof error === "string" ? error : JSON.stringify(error)}
    </div>
  );
}

function EmptyResult({ message }: { message: string }) {
  return (
    <div className="text-gray-500 text-xs italic px-2 py-1">{message}</div>
  );
}

export default function ImageToolResult({ toolCall }: Props) {
  const { t } = useTranslation();

  console.log("[ImageToolResult] toolCall:", {
    name: toolCall.name,
    hasResult: !!toolCall.result,
    resultType: typeof toolCall.result,
    resultKeys: toolCall.result && typeof toolCall.result === "object"
      ? Object.keys(toolCall.result as Record<string, unknown>)
      : "N/A",
    result: toolCall.result,
  });

  // 1. waiting
  if (!toolCall.result) {
    console.log("[ImageToolResult] NO result — showing loading skeleton");
    return <LoadingSkeleton />;
  }

  const result = toolCall.result as { success: boolean; data?: unknown; error?: string };

  // 2. failed
  if (!result.success) {
    return <ErrorBanner error={result.error || t("image.unknownError")} />;
  }

  // 3. empty
  const data = result.data;
  if (!data || isEmpty(data)) {
    return <EmptyResult message={t("image.noImagesGenerated")} />;
  }

  // 4. success → 按工具名分发
  switch (toolCall.name) {
    case "image_generate":
      return <ImageGenerateResult data={data as Record<string, unknown>} />;
    case "image_svg_generate":
      return <SvgPreviewResult data={data as Record<string, unknown>} />;
    case "image_analysis":
      return <AnalysisResultCard data={data as Record<string, unknown>} />;
    case "canvas":
      return <CanvasResultView data={data as Record<string, unknown>} />;
    case "image":
      return <ImageEditResultView data={data as Record<string, unknown>} />;
    default:
      return (
        <pre className="m-0 whitespace-pre-wrap break-words text-[10px] leading-relaxed text-[#a9b1d6] font-mono bg-black/15 p-1 rounded max-h-[200px] overflow-y-auto">
          {JSON.stringify(data, null, 2)}
        </pre>
      );
  }
}
