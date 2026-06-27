/**
 * AnalysisResultCard
 * 分析结果路由分发 — 不渲染具体内容，按 action 分发到子组件
 */
import MetadataResult from "./MetadataResult";
import ColorAnalysisResult from "./ColorAnalysisResult";
import ContentAnalysisResult from "./ContentAnalysisResult";
import CompareAnalysisResult from "./CompareAnalysisResult";
import FullAnalysisResult from "./FullAnalysisResult";
import VisionAnalysisResult from "./VisionAnalysisResult";
import OcrResult from "./OcrResult";
import ObjectDetectionResult from "./ObjectDetectionResult";

interface Props {
  data: Record<string, unknown>;
}

export default function AnalysisResultCard({ data }: Props) {
  // 根据 data 的结构判断分析类型
  if (data.text !== undefined || data.blocks !== undefined) {
    return <OcrResult data={data} />;
  }
  if (data.objects !== undefined || data.count !== undefined) {
    return <ObjectDetectionResult data={data} />;
  }
  if (data.colors && data.content) {
    return <FullAnalysisResult data={data} />;
  }
  if (data.dominantColors || data.palette) {
    return <ColorAnalysisResult data={data} />;
  }
  if (data.sizeCategory || data.isSquare !== undefined) {
    return <ContentAnalysisResult data={data} />;
  }
  if (data.sameDimensions !== undefined) {
    return <CompareAnalysisResult data={data} />;
  }
  if (data.description) {
    return <VisionAnalysisResult data={data} />;
  }
  if (data.fileSize !== undefined || data.format) {
    return <MetadataResult data={data} />;
  }

  // 兜底
  return (
    <pre className="m-0 whitespace-pre-wrap break-words text-[10px] text-[#a9b1d6] font-mono bg-black/15 p-1 rounded max-h-[200px] overflow-y-auto">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}
