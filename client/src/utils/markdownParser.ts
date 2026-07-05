/**
 * Markdown 文本块解析器
 *
 * 从 MarkdownRenderer 中提取，将 Markdown 文本按行解析为结构化块数组。
 * 纯函数，无任何外部依赖。
 *
 * 支持的块类型：text | code | math | mermaid | table | heading | list | hr
 */

export interface RenderedBlock {
  id: number;
  type: 'text' | 'code' | 'math' | 'mermaid' | 'table' | 'heading' | 'list' | 'hr' | 'image';
  content: string;
  language?: string;
  level?: number;
  /** 图片 URL（仅 type='image' 时存在） */
  url?: string;
}

/**
 * 将 Markdown 文本解析为结构化块
 */
export function parseMarkdown(text: string, blockIdRef: { current: number }): RenderedBlock[] {
  const result: RenderedBlock[] = [];
  const lines = text.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('```')) {
      const match = line.match(/```(\w+)?/);
      const language = match?.[1] || 'text';
      let codeContent = '';
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeContent += lines[i] + '\n';
        i++;
      }
      i++;
      blockIdRef.current++;
      if (language === 'mermaid') {
        result.push({ id: blockIdRef.current, type: 'mermaid', content: codeContent.trim() });
      } else {
        result.push({ id: blockIdRef.current, type: 'code', content: codeContent.trim(), language });
      }
    } else if (line.startsWith('$$')) {
      let mathContent = line.slice(2);
      if (line.endsWith('$$')) {
        mathContent = line.slice(2, -2);
        blockIdRef.current++;
        result.push({ id: blockIdRef.current, type: 'math', content: mathContent.trim() });
        i++;
      } else {
        i++;
        while (i < lines.length && !lines[i].endsWith('$$')) {
          mathContent += '\n' + lines[i];
          i++;
        }
        if (i < lines.length) {
          mathContent += '\n' + lines[i].slice(0, -2);
          i++;
        }
        blockIdRef.current++;
        result.push({ id: blockIdRef.current, type: 'math', content: mathContent.trim() });
      }
    } else if (line.match(/^\|.+\|$/)) {
      let tableContent = line + '\n';
      i++;
      while (i < lines.length && lines[i].match(/^\|.+\|$/)) {
        tableContent += lines[i] + '\n';
        i++;
      }
      blockIdRef.current++;
      result.push({ id: blockIdRef.current, type: 'table', content: tableContent.trim() });
    } else if (line.match(/^#{1,6}\s/)) {
      const level = line.match(/^#{1,6}/)?.[0].length || 1;
      const content = line.replace(/^#{1,6}\s/, '').trim();
      blockIdRef.current++;
      result.push({ id: blockIdRef.current, type: 'heading', content, level });
      i++;
    } else if (line.match(/^[-*+]\s/) || line.match(/^\d+\.\s/)) {
      let listContent = line + '\n';
      i++;
      while (i < lines.length && (lines[i].match(/^[-*+]\s/) || lines[i].match(/^\d+\.\s/) || lines[i].startsWith('  ') || lines[i].startsWith('\t'))) {
        listContent += lines[i] + '\n';
        i++;
      }
      blockIdRef.current++;
      result.push({ id: blockIdRef.current, type: 'list', content: listContent.trim() });
    } else if (line.match(/^---*$/)) {
      blockIdRef.current++;
      result.push({ id: blockIdRef.current, type: 'hr', content: '' });
      i++;
    } else if (line.match(/^!\[[^\]]*\]\([^)]+\)$/)) {
      // 独立成行的 Markdown 图片语法：![alt](url)
      const imgMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
      const alt = imgMatch?.[1] || '';
      const url = imgMatch?.[2] || '';
      blockIdRef.current++;
      result.push({ id: blockIdRef.current, type: 'image', content: alt, url });
      i++;
    } else {
      let textContent = line;
      i++;
      while (i < lines.length &&
             !lines[i].startsWith('```') &&
             !lines[i].startsWith('$$') &&
             !lines[i].match(/^\|.+\|$/) &&
             !lines[i].match(/^#{1,6}\s/) &&
             !lines[i].match(/^[-*+]\s/) &&
             !lines[i].match(/^\d+\.\s/) &&
             !lines[i].match(/^---*$/) &&
             !lines[i].match(/^!\[[^\]]*\]\([^)]+\)$/)) {
        textContent += '\n' + lines[i];
        i++;
      }
      blockIdRef.current++;
      result.push({ id: blockIdRef.current, type: 'text', content: textContent.trim() });
    }
  }

  return result;
}