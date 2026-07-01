import React, { useEffect, useRef, useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import mermaid from 'mermaid';
import { InlineCodeLink } from './markdown/InlineCodeLink';
import BlockContent from './BlockContent';
import HeadingRenderer from './HeadingRenderer';
import ListRenderer from './ListRenderer';
import TableBlock from './TableBlock';
import { parseMarkdown } from '../../utils/markdownParser';
import { isLatexFormula } from '../../utils/latexDetector';

interface MarkdownRendererProps {
  content: string;
  isStreaming?: boolean;
  onPreviewFile?: (path: string) => void;
  knownFilePaths?: string[];
}

function MarkdownRenderer({ content, isStreaming, onPreviewFile, knownFilePaths }: MarkdownRendererProps) {
  const blockIdRef = useRef(0);

  const blocks = useMemo(() => {
    return parseMarkdown(content, blockIdRef);
  }, [content]);

  useEffect(() => {
    mermaid.initialize({ startOnLoad: false });
    const mermaidElements = document.querySelectorAll('.mermaid');
    mermaidElements.forEach(async (el) => {
      if (!el.classList.contains('rendered')) {
        const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const code = (el as HTMLElement).textContent || '';
        const { svg } = await mermaid.render(id, code);
        (el as HTMLElement).innerHTML = svg;
        el.classList.add('rendered');
      }
    });
  }, [blocks]);



  const renderHeading = (content: string, level: number, key: string) => {
    return <HeadingRenderer key={key} content={content} level={level} renderText={renderText} />;
  };

  const renderList = (content: string, key: string) => {
    return <ListRenderer key={key} content={content} renderText={renderText} />;
  };

  /**
   * 将纯文本中的裸 URL 转换为可点击链接
   * 对标 cline remarkUrlToLink
   */
  const renderPlainTextWithUrls = (text: string, startKey: number): JSX.Element[] => {
    const urlRegex = /(https?:\/\/[^\s<>)\]]+)/;
    const parts: JSX.Element[] = [];
    let remaining = text;
    let key = startKey;
    let match;
    while ((match = urlRegex.exec(remaining)) !== null) {
      if (match.index > 0) {
        parts.push(<span key={key++}>{remaining.slice(0, match.index)}</span>);
      }
      parts.push(
        <a
          key={key++}
          href={match[1]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-500 hover:underline"
        >
          {match[1]}
        </a>
      );
      remaining = remaining.slice(match.index + match[1].length);
    }
    if (remaining) {
      parts.push(<span key={key++}>{remaining}</span>);
    }
    return parts;
  };

  const renderText = (text: string, autoDetectFormula: boolean = true) => {
    const parts: JSX.Element[] = [];
    let remaining = text;
    let key = 0;

    const patterns = [
      { regex: /\*\*(.+?)\*\*/g, tag: 'strong' as const },
      { regex: /\*(.+?)\*/g, tag: 'em' as const },
      { regex: /~~(.+?)~~/g, tag: 'del' as const },
      { regex: /`([^`]+)`/g, tag: 'code' as const },
      { regex: /\[([^\]]+)\]\(([^)]+)\)/g, tag: 'link' as const },
      { regex: /\$([^$]+)\$/g, tag: 'math' as const },
      { regex: /https?:\/\/[^\s<>)\]]+/g, tag: 'url' as const },
    ];

    let hasMatch = true;
    while (hasMatch) {
      hasMatch = false;
      let earliestMatch: { index: number; pattern: typeof patterns[0]; match: RegExpExecArray } | null = null;

      for (const pattern of patterns) {
        pattern.regex.lastIndex = 0;
        const match = pattern.regex.exec(remaining);
        if (match && (!earliestMatch || match.index < earliestMatch.index)) {
          earliestMatch = { index: match.index, pattern, match };
          hasMatch = true;
        }
      }

      if (earliestMatch) {
        const { index, pattern, match } = earliestMatch;
        if (index > 0) {
          const beforeText = remaining.slice(0, index);
          if (autoDetectFormula && isLatexFormula(beforeText)) {
            let renderedFormula: string;
            try {
              renderedFormula = katex.renderToString(beforeText, { displayMode: false });
            } catch {
              renderedFormula = '';
            }
            if (renderedFormula) {
              parts.push(
                <span
                  key={key++}
                  className="inline-block"
                  dangerouslySetInnerHTML={{ __html: renderedFormula }}
                />
              );
            } else {
              parts.push(<span key={key++}>{beforeText}</span>);
            }
          } else {
            parts.push(<span key={key++}>{beforeText}</span>);
          }
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
        } else if (pattern.tag === 'url') {
          const url = match[0];
          parts.push(
            <a
              key={key++}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 hover:underline"
            >
              {url}
            </a>
          );
        } else if (pattern.tag === 'math') {
          let renderedFormula: string;
          try {
            renderedFormula = katex.renderToString(match[1], { displayMode: false });
          } catch {
            renderedFormula = '';
          }
          if (renderedFormula) {
            parts.push(
              <span
                key={key++}
                className="inline-block"
                dangerouslySetInnerHTML={{ __html: renderedFormula }}
              />
            );
          } else {
            parts.push(<span key={key++}>{`$${match[1]}$`}</span>);
          }
        } else if (pattern.tag === 'code') {
          parts.push(
            <InlineCodeLink
              key={key++}
              codeContent={match[1]}
              knownFilePaths={knownFilePaths}
              onPreviewFile={onPreviewFile}
            />
          );
        } else if (pattern.tag === 'strong') {
          const remainderAfterStrong = remaining.slice(index + match[0].length);
          if (/^[a-zA-Z0-9_-]+$/.test(match[1]) && /^\.[a-zA-Z0-9]+/.test(remainderAfterStrong)) {
            parts.push(<span key={key++}>**{match[1]}**</span>);
          } else {
            parts.push(React.createElement('strong', { key: key++ }, match[1]));
          }
        } else if (pattern.tag === 'del') {
          parts.push(React.createElement('del', { key: key++ }, match[1]));
        } else {
          parts.push(
            React.createElement(pattern.tag, { key: key++ }, match[1])
          );
        }
        remaining = remaining.slice(index + match[0].length);
      }
    }

    if (remaining) {
      if (autoDetectFormula && isLatexFormula(remaining)) {
        let renderedFormula: string;
        try {
          renderedFormula = katex.renderToString(remaining, { displayMode: false });
        } catch {
          renderedFormula = '';
        }
        if (renderedFormula) {
          parts.push(
            <span
              key={key}
              className="inline-block"
              dangerouslySetInnerHTML={{ __html: renderedFormula }}
            />
          );
        } else {
          parts.push(...renderPlainTextWithUrls(remaining, key));
        }
      } else {
        parts.push(...renderPlainTextWithUrls(remaining, key));
      }
    }

    return parts;
  };

  const renderTable = (content: string, autoDetectFormula: boolean = true) => {
    const wrappedRenderText = (text: string) => renderText(text, autoDetectFormula);
    return <TableBlock content={content} renderText={wrappedRenderText} />;
  };

  return (
    <div className="prose prose-sm max-w-none">
      {blocks.map((block) => (
        <BlockContent
          key={block.id}
          block={block}
          isStreaming={isStreaming}
          renderText={renderText}
          renderHeading={renderHeading}
          renderList={renderList}
          renderTable={renderTable}
        />
      ))}
      {isStreaming && (
        <span className="animate-pulse">▌</span>
      )}
    </div>
  );
}

export default MarkdownRenderer;