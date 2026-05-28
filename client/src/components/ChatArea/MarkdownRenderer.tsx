import React, { useState, useEffect, useRef } from 'react';

interface MarkdownRendererProps {
  content: string;
  isStreaming?: boolean;
}

interface RenderedBlock {
  id: number;
  type: 'text' | 'code' | 'math' | 'mermaid' | 'table';
  content: string;
  language?: string;
}

declare global {
  interface Window {
    mermaid?: {
      initialize: (config: { startOnLoad: boolean }) => void;
      render: (id: string, code: string, callback: (svgCode: string) => void) => void;
    };
  }
}

function MarkdownRenderer({ content, isStreaming }: MarkdownRendererProps) {
  const [blocks, setBlocks] = useState<RenderedBlock[]>([]);
  const [mermaidLoaded, setMermaidLoaded] = useState(false);
  const blockIdRef = useRef(0);

  useEffect(() => {
    const renderedBlocks = parseMarkdown(content);
    setBlocks(renderedBlocks);
  }, [content]);

  useEffect(() => {
    const loadMermaid = async () => {
      try {
        const mermaidScript = document.createElement('script');
        mermaidScript.src = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js';
        mermaidScript.onload = () => {
          setMermaidLoaded(true);
          if (window.mermaid) {
            window.mermaid.initialize({ startOnLoad: false });
          }
        };
        document.head.appendChild(mermaidScript);
        return () => document.head.removeChild(mermaidScript);
      } catch {
        setMermaidLoaded(false);
      }
    };
    loadMermaid();
  }, []);

  useEffect(() => {
    if (mermaidLoaded && window.mermaid) {
      const mermaid = window.mermaid;
      const mermaidElements = document.querySelectorAll('.mermaid');
      mermaidElements.forEach((el) => {
        if (!el.classList.contains('rendered')) {
          mermaid.render(`mermaid-${Date.now()}`, (el as HTMLElement).textContent || '', (svgCode) => {
            (el as HTMLElement).innerHTML = svgCode;
            el.classList.add('rendered');
          });
        }
      });
    }
  }, [blocks, mermaidLoaded]);

  const parseMarkdown = (text: string): RenderedBlock[] => {
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
      } else {
        let textContent = line;
        i++;
        while (i < lines.length && !lines[i].startsWith('```') && !lines[i].startsWith('$$') && !lines[i].match(/^\|.+\|$/)) {
          textContent += '\n' + lines[i];
          i++;
        }
        blockIdRef.current++;
        result.push({ id: blockIdRef.current, type: 'text', content: textContent.trim() });
      }
    }

    return result;
  };

  const renderText = (text: string) => {
    const parts: JSX.Element[] = [];
    let remaining = text;
    let key = 0;

    const patterns = [
      { regex: /\*\*(.+?)\*\*/g, tag: 'strong' as const },
      { regex: /\*(.+?)\*/g, tag: 'em' as const },
      { regex: /`([^`]+)`/g, tag: 'code' as const },
      { regex: /\[([^\]]+)\]\(([^)]+)\)/g, tag: 'link' as const },
    ];

    let hasMatch = true;
    while (hasMatch) {
      hasMatch = false;
      let earliestMatch: { index: number; pattern: typeof patterns[0]; match: RegExpExecArray } | null = null;

      for (const pattern of patterns) {
        const match = pattern.regex.exec(remaining);
        if (match && (!earliestMatch || match.index < earliestMatch.index)) {
          earliestMatch = { index: match.index, pattern, match };
          hasMatch = true;
        }
      }

      if (earliestMatch) {
        const { index, pattern, match } = earliestMatch;
        if (index > 0) {
          parts.push(<span key={key++}>{remaining.slice(0, index)}</span>);
        }
        if (pattern.tag === 'link') {
          parts.push(
            <a
              key={key++}
              href={match[2]}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 hover:underline"
            >
              {match[1]}
            </a>
          );
        } else {
          parts.push(
            React.createElement(pattern.tag, { key: key++ }, match[1])
          );
        }
        remaining = remaining.slice(index + match[0].length);
      }
    }

    if (remaining) {
      parts.push(<span key={key}>{remaining}</span>);
    }

    return parts;
  };

  const renderTable = (content: string) => {
    const rows = content.split('\n');
    if (rows.length < 2) return null;

    const headers = rows[0].split('|').filter((cell) => cell.trim());
    const separator = rows[1];
    const dataRows = rows.slice(2);

    const alignments = separator.split('|').filter((cell) => cell.trim()).map((cell) => {
      if (cell.startsWith(':') && cell.endsWith(':')) return 'center';
      if (cell.startsWith(':')) return 'left';
      if (cell.endsWith(':')) return 'right';
      return 'left';
    });

    return (
      <table className="w-full border-collapse my-4">
        <thead>
          <tr className="bg-gray-100 dark:bg-gray-700">
            {headers.map((header, idx) => (
              <th
                key={idx}
                className="border border-gray-300 dark:border-gray-600 px-4 py-2 text-left"
                style={{ textAlign: alignments[idx] as 'left' | 'center' | 'right' }}
              >
                {header.trim()}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dataRows.map((row, rowIdx) => {
            const cells = row.split('|').filter((cell) => cell.trim());
            return (
              <tr
                key={rowIdx}
                className={rowIdx % 2 === 0 ? 'bg-white dark:bg-gray-800' : 'bg-gray-50 dark:bg-gray-750'}
              >
                {cells.map((cell, cellIdx) => (
                  <td
                    key={cellIdx}
                    className="border border-gray-300 dark:border-gray-600 px-4 py-2"
                    style={{ textAlign: alignments[cellIdx] as 'left' | 'center' | 'right' }}
                  >
                    {cell.trim()}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  };

  return (
    <div className="prose prose-sm max-w-none">
      {blocks.map((block) => {
        switch (block.type) {
          case 'code':
            return (
              <pre
                key={block.id}
                className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-sm my-2"
              >
                <code>{block.content}</code>
              </pre>
            );
          case 'math':
            return (
              <div
                key={block.id}
                className="my-4 text-center"
                dangerouslySetInnerHTML={{
                  __html: `<span class="katex">${block.content}</span>`,
                }}
              />
            );
          case 'mermaid':
            return (
              <div
                key={block.id}
                className="mermaid my-4"
                style={{ backgroundColor: '#1a1a1a', padding: '1rem', borderRadius: '8px' }}
              >
                {block.content}
              </div>
            );
          case 'table':
            return <div key={block.id} className="overflow-x-auto">{renderTable(block.content)}</div>;
          case 'text':
            return (
              <p key={block.id} className="my-2 whitespace-pre-wrap">
                {renderText(block.content)}
              </p>
            );
          default:
            return null;
        }
      })}
      {isStreaming && (
        <span className="animate-pulse">▌</span>
      )}
    </div>
  );
}

export default MarkdownRenderer;