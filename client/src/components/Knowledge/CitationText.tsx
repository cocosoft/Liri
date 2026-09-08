import { memo } from "react";
import CitationLink from "../ChatArea/markdown/CitationLink";
import { splitCitationText } from "../../utils/citation";

/**
 * F1：把文本中 R5 引用锚点（doc.pdf#p.N / file.md#L42-L58）渲染为可点链接，
 * 供搜索卡片 snippet / 规则 / FAQ / 记录等纯文本区域复用（SearchHitCard 等不再整段纯文本）。
 */
interface CitationTextProps {
  text: string;
  /** 会话已知本地路径（可选，帮助 basename 匹配；缺省走后端 resolve 白名单） */
  knownFilePaths?: string[];
  className?: string;
}

export const CitationText = memo(function CitationText({
  text,
  knownFilePaths,
  className,
}: CitationTextProps) {
  const segments = splitCitationText(text);
  const hasCitation = segments.some((s) => s.type === "citation");
  if (!hasCitation) {
    return <span className={className}>{text}</span>;
  }
  return (
    <span className={className}>
      {segments.map((seg, i) =>
        seg.type === "citation" ? (
          <CitationLink
            key={i}
            citation={seg.citation!}
            knownFilePaths={knownFilePaths}
          />
        ) : (
          <span key={i}>{seg.value}</span>
        ),
      )}
    </span>
  );
});
