import React, { useEffect, useRef, useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import mermaid from "mermaid";
import DOMPurify from "dompurify";

/** 检测文本是否包含中文字符，含中文的 $...$ 内容不应走 KaTeX 解析 */
const CONTAINS_CHINESE_RE = /[\u4e00-\u9fa5]/;

/** 诊断：统计 KaTeX 调用次数和中文拦截次数 */
let _diagKatexCalls = 0;
let _diagChineseBlocks = 0;
let _diagKatexMs = 0;
export function getKatexDiag() {
  const r = {
    calls: _diagKatexCalls,
    chineseBlocks: _diagChineseBlocks,
    ms: _diagKatexMs,
  };
  _diagKatexCalls = 0;
  _diagChineseBlocks = 0;
  _diagKatexMs = 0;
  return r;
}
import { InlineCodeLink } from "./markdown/InlineCodeLink";
import BlockContent from "./BlockContent";
import HeadingRenderer from "./HeadingRenderer";
import ListRenderer from "./ListRenderer";
import TableBlock from "./TableBlock";
import { parseMarkdown } from "../../utils/markdownParser";
import { isLatexFormula } from "../../utils/latexDetector";

interface MarkdownRendererProps {
  content: string;
  isStreaming?: boolean;
  onPreviewFile?: (path: string) => void;
  knownFilePaths?: string[];
}

/** 渲染安全上限：超过此长度的内容跳过 markdown 解析，直接截断显示 */
const MAX_RENDER_LENGTH = 150000;

function MarkdownRenderer({
  content,
  isStreaming,
  onPreviewFile,
  knownFilePaths,
}: MarkdownRendererProps) {
  const blockIdRef = useRef(0);

  /** 超长内容保护：跳过 markdown 解析，用纯文本截断显示，防止浏览器 OOM */
  const isTruncated = content.length > MAX_RENDER_LENGTH;
  const safeContent = isTruncated ? content.slice(0, 5000) : content;

  const blocks = useMemo(() => {
    if (isTruncated) return [];
    return parseMarkdown(safeContent, blockIdRef);
  }, [safeContent, isTruncated]);

  useEffect(() => {
    mermaid.initialize({ startOnLoad: false });
    const mermaidElements = document.querySelectorAll(".mermaid");
    mermaidElements.forEach(async (el) => {
      if (!el.classList.contains("rendered")) {
        const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const code = (el as HTMLElement).textContent || "";
        const { svg } = await mermaid.render(id, code);
        (el as HTMLElement).innerHTML = svg;
        el.classList.add("rendered");
      }
    });
  }, [blocks]);

  const renderHeading = (content: string, level: number, key: string) => {
    return (
      <HeadingRenderer
        key={key}
        content={content}
        level={level}
        renderText={renderText}
      />
    );
  };

  const renderList = (content: string, key: string) => {
    return <ListRenderer key={key} content={content} renderText={renderText} />;
  };

  /**
   * 将纯文本中的裸 URL 转换为可点击链接
   * 对标 cline remarkUrlToLink
   */
  const renderPlainTextWithUrls = (
    text: string,
    startKey: number,
  ): JSX.Element[] => {
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
        </a>,
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
      { regex: /\*\*(.+?)\*\*/g, tag: "strong" as const },
      { regex: /\*(.+?)\*/g, tag: "em" as const },
      { regex: /~~(.+?)~~/g, tag: "del" as const },
      { regex: /`([^`]+)`/g, tag: "code" as const },
      // 图片 pattern 必须放在链接 pattern 之前，确保 ![alt](url) 被优先匹配为图片
      { regex: /!\[([^\]]*)\]\(([^)]+)\)/g, tag: "image" as const },
      { regex: /\[([^\]]+)\]\(([^)]+)\)/g, tag: "link" as const },
      { regex: /\$([^$]+)\$/g, tag: "math" as const },
      { regex: /https?:\/\/[^\s<>)\]]+/g, tag: "url" as const },
    ];

    let hasMatch = true;
    while (hasMatch) {
      hasMatch = false;
      let earliestMatch: {
        index: number;
        pattern: (typeof patterns)[0];
        match: RegExpExecArray;
      } | null = null;

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
          if (
            autoDetectFormula &&
            isLatexFormula(beforeText) &&
            !CONTAINS_CHINESE_RE.test(beforeText)
          ) {
            let renderedFormula: string;
            try {
              const tk = performance.now();
              renderedFormula = katex.renderToString(beforeText, {
                displayMode: false,
                strict: false,
              });
              _diagKatexMs += performance.now() - tk;
              _diagKatexCalls++;
            } catch {
              renderedFormula = "";
            }
            if (renderedFormula) {
              parts.push(
                <span
                  key={key++}
                  className="inline-block"
                  dangerouslySetInnerHTML={{
                    __html: DOMPurify.sanitize(
                      renderedFormula,
                    ) as unknown as string,
                  }}
                />,
              );
            } else {
              parts.push(<span key={key++}>{beforeText}</span>);
            }
          } else {
            parts.push(<span key={key++}>{beforeText}</span>);
          }
        }
        if (pattern.tag === "image") {
          // 清理 AI 可能生成的异常包装如 ${"/path/to/image.png"} → /path/to/image.png
          let imgSrc = match[2];
          const stripped = imgSrc.match(/^\$\{?["']([^"']+)["']\}?$/);
          if (stripped) {
            imgSrc = stripped[1];
          }
          const imgAlt = match[1] || "";
          parts.push(
            <img
              key={key++}
              src={imgSrc}
              alt={imgAlt}
              className="max-w-full h-auto rounded-lg my-2 cursor-pointer hover:opacity-90 transition-opacity"
              loading="lazy"
              onClick={() => onPreviewFile?.(imgSrc)}
              onError={(e) => {
                // 加载失败时显示为链接文本
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />,
          );
        } else if (pattern.tag === "link") {
          parts.push(
            <a
              key={key++}
              href={match[2]}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 hover:underline"
            >
              {match[1]}
            </a>,
          );
        } else if (pattern.tag === "url") {
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
            </a>,
          );
        } else if (pattern.tag === "math") {
          // 预检：含中文内容跳过 KaTeX 解析，直接当普通文本渲染
          if (CONTAINS_CHINESE_RE.test(match[1])) {
            _diagChineseBlocks++;
            parts.push(<span key={key++}>{`$${match[1]}$`}</span>);
          } else {
            let renderedFormula: string;
            try {
              const tk = performance.now();
              renderedFormula = katex.renderToString(match[1], {
                displayMode: false,
                strict: false,
              });
              _diagKatexMs += performance.now() - tk;
              _diagKatexCalls++;
            } catch {
              renderedFormula = "";
            }
            if (renderedFormula) {
              parts.push(
                <span
                  key={key++}
                  className="inline-block"
                  dangerouslySetInnerHTML={{
                    __html: DOMPurify.sanitize(
                      renderedFormula,
                    ) as unknown as string,
                  }}
                />,
              );
            } else {
              parts.push(<span key={key++}>{`$${match[1]}$`}</span>);
            }
          }
        } else if (pattern.tag === "code") {
          parts.push(
            <InlineCodeLink
              key={key++}
              codeContent={match[1]}
              knownFilePaths={knownFilePaths}
              onPreviewFile={onPreviewFile}
            />,
          );
        } else if (pattern.tag === "strong") {
          const remainderAfterStrong = remaining.slice(index + match[0].length);
          if (
            /^[a-zA-Z0-9_-]+$/.test(match[1]) &&
            /^\.[a-zA-Z0-9]+/.test(remainderAfterStrong)
          ) {
            parts.push(<span key={key++}>**{match[1]}**</span>);
          } else {
            parts.push(React.createElement("strong", { key: key++ }, match[1]));
          }
        } else if (pattern.tag === "del") {
          parts.push(React.createElement("del", { key: key++ }, match[1]));
        } else {
          parts.push(
            React.createElement(pattern.tag, { key: key++ }, match[1]),
          );
        }
        remaining = remaining.slice(index + match[0].length);
      }
    }

    if (remaining) {
      if (
        autoDetectFormula &&
        isLatexFormula(remaining) &&
        !CONTAINS_CHINESE_RE.test(remaining)
      ) {
        let renderedFormula: string;
        try {
          const tk = performance.now();
          renderedFormula = katex.renderToString(remaining, {
            displayMode: false,
            strict: false,
          });
          _diagKatexMs += performance.now() - tk;
          _diagKatexCalls++;
        } catch {
          renderedFormula = "";
        }
        if (renderedFormula) {
          parts.push(
            <span
              key={key}
              className="inline-block"
              dangerouslySetInnerHTML={{ __html: renderedFormula }}
            />,
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
    const wrappedRenderText = (text: string) =>
      renderText(text, autoDetectFormula);
    return <TableBlock content={content} renderText={wrappedRenderText} />;
  };

  if (isTruncated) {
    return (
      <div className="prose prose-sm max-w-none">
        <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-xs">
          <p className="text-amber-600 dark:text-amber-400 font-medium mb-1">
            ⚠️ 内容过长（{(content.length / 1024).toFixed(0)} KB），已截断显示前
            5000 字符
          </p>
          <pre className="mt-2 p-2 bg-gray-100 dark:bg-gray-800 rounded text-gray-700 dark:text-gray-300 overflow-auto max-h-96 whitespace-pre-wrap text-[11px] leading-relaxed">
            {safeContent}
          </pre>
          <p className="mt-2 text-amber-500 dark:text-amber-400">
            ... 剩余 {(content.length - 5000).toLocaleString()} 字符未显示 ...
          </p>
        </div>
      </div>
    );
  }

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
      {isStreaming && <span className="animate-pulse">▌</span>}
    </div>
  );
}

export default MarkdownRenderer;
