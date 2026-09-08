/**
 * citation — 本地引用锚点解析（R5：识别 doc.pdf#p.12 / #L42-L58）
 *
 * 支持两种引用格式（可由括号包裹，如 R4 snippet 前缀 "(doc.pdf#p.2)"）：
 *   file.pdf#p.12             页码
 *   file.pdf#p.12§3.1         页码 + 章节
 *   file.md#L42-L58           行区间（文本/代码定位）
 * 解析为 ParsedCitation，供 CitationLink 打开本地文件定位。
 */

export interface ParsedCitation {
  /** 源文件名（含扩展名，如 御数坊-AiDGAtlas知识工厂-v1.0.pdf） */
  file: string;
  /** 原始引用串（p.12 / p.12§3.1 / L42-L58） */
  ref: string;
  /** 页码（1 起；p. 引用时有） */
  page?: number;
  /** 章节/sheet 名（§ 后缀，可选） */
  section?: string;
  /** 起始行（L 引用时有） */
  lineFrom?: number;
  /** 结束行（区间引用；缺省与 lineFrom 相同） */
  lineTo?: number;
}

export interface CitationSegment {
  type: "text" | "citation";
  value: string;
  citation?: ParsedCitation;
}

/** 引用 token：<文件名.扩展名>#<p.N[§x] | L[a][-L?b]> */
const CITATION_RE =
  /([^\s()#]+?\.(?:pdf|docx|doc|xlsx|xls|pptx|md|txt|json|csv|tsv|xml|yaml|yml|log|png|jpe?g|gif))#(p\.\d+(?:§[^\s()]+)?|L\d+(?:[–\-]L?\d+)?)/gi;

/** 供行内渲染器（MarkdownRenderer patterns）复用的引用 token 正则 */
export const CITATION_TOKEN_RE = CITATION_RE;

/** 把单个 ref 串解析为结构化定位 */
export function parseCitationRef(
  ref: string,
): Pick<ParsedCitation, "page" | "section" | "lineFrom" | "lineTo"> {
  const pageMatch = /^p\.(\d+)(?:§(.+))?$/i.exec(ref.trim());
  if (pageMatch) {
    return {
      page: Number(pageMatch[1]),
      ...(pageMatch[2] ? { section: pageMatch[2].trim() } : {}),
    };
  }
  const lineMatch = /^L(\d+)(?:[–\-]L?(\d+))?$/i.exec(ref.trim());
  if (lineMatch) {
    const from = Number(lineMatch[1]);
    const to = lineMatch[2] ? Number(lineMatch[2]) : from;
    return { lineFrom: from, lineTo: to };
  }
  return {};
}

/** 解析文本中的引用段（保持顺序，非引用文本原样保留） */
export function splitCitationText(text: string): CitationSegment[] {
  const segments: CitationSegment[] = [];
  let lastIndex = 0;
  CITATION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CITATION_RE.exec(text)) !== null) {
    if (m.index > lastIndex) {
      segments.push({
        type: "text",
        value: text.slice(lastIndex, m.index),
      });
    }
    const file = m[1];
    const ref = m[2];
    segments.push({
      type: "citation",
      value: `${file}#${ref}`,
      citation: {
        file,
        ref,
        ...parseCitationRef(ref),
      },
    });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: "text", value: text.slice(lastIndex) });
  }
  return segments;
}
