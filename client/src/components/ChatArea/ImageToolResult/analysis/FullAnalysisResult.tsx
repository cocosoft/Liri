/**
 * FullAnalysisResult — 组合元数据 + 色彩 + 内容
 */
import MetadataResult from "./MetadataResult";
import ColorAnalysisResult from "./ColorAnalysisResult";
import ContentAnalysisResult from "./ContentAnalysisResult";

interface Props { data: Record<string, unknown>; }

export default function FullAnalysisResult({ data }: Props) {
  return (
    <div className="space-y-2">
      <MetadataResult data={data} />
      <ColorAnalysisResult data={data} />
      <ContentAnalysisResult data={data} />
    </div>
  );
}
