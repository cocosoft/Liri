import React, {
  useCallback,
  useEffect,
  useRef,
  useMemo,
  useState,
  type JSX,
} from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import mermaid from "mermaid";
import DOMPurify from "dompurify";
import { useTranslation } from "react-i18next";

/** 检测文本是否包含中文字符，含中文的 $...$ 内容不应走 KaTeX 解析 */
const CONTAINS_CHINESE_RE = /[\u4e00-\u9fa5]/;

/**
 * #3 修复：链接/图片 URL 协议白名单。
 * 行内链接 pattern 原直接把 match[2] 作为 href，`[x](javascript:alert(1))`
 * 会渲染为可点击链接（React 不阻止 javascript: 协议，rel=noopener 只防 opener）。
 * 允许：http/https/mailto + 相对路径 + file://（应用自身的本地文件引用）；
 * 拒绝：javascript:/data:/vbscript: 等执行类/嵌入类协议。
 */
function isSafeUrl(raw: string): boolean {
  const url = raw.trim();
  if (!url) return false;
  if (/^(\.{0,2}\/|\.\.\/|#|file:\/\/)/i.test(url)) return true;
  return /^(https?:|mailto:)/i.test(url);
}

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
import CitationLink from "./markdown/CitationLink";
import { CITATION_TOKEN_RE, parseCitationRef } from "../../utils/citation";
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
  // N6 修复：mermaid 只处理本组件容器内的元素（原全局 querySelectorAll 越权）
  const containerRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();

  /** content 归一化（undefined 防护）：调用方可能传未初始化的 result，直接 .length 会崩溃 */
  const normalizedContent = content ?? "";

  /** 超长内容保护：跳过 markdown 解析，用纯文本截断显示，防止浏览器 OOM */
  const isTruncated = normalizedContent.length > MAX_RENDER_LENGTH;
  const safeContent = isTruncated
    ? normalizedContent.slice(0, 5000)
    : normalizedContent;

  const blocks = useMemo(() => {
    if (isTruncated) return [];
    return parseMarkdown(safeContent, blockIdRef);
  }, [safeContent, isTruncated]);

  /**
   * P1-14（2026-09-27 审计）：超长内容降级后原本**只提示、无出口**——用户拿不到后半段。
   * 提供"复制全文"（剪贴板不受渲染上限约束），保证内容可达。
   */
  const [copiedFull, setCopiedFull] = useState(false);
  const handleCopyFull = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(normalizedContent);
      setCopiedFull(true);
      setTimeout(() => setCopiedFull(false), 2000);
    } catch {
      // @ignore-catch — 剪贴板不可用（权限/非安全上下文）：保持提示，用户仍可导出会话
    }
  }, [normalizedContent]);

  useEffect(() => {
    // N6 修复：
    // ① 显式 securityLevel: strict（默认值，显式声明避免依赖库默认行为）
    // ② 查询范围收敛到本组件容器（原全局 querySelectorAll 越权处理其它组件）
    // ③ cancelled 标志：卸载/依赖变化后不再 innerHTML 注入
    // ④ 渲染结果过 DOMPurify，与全局 sanitize 策略对齐（mermaid 输出唯一裸插点）
    // ⑤ try/catch 兜底：语法错误不再 unhandled rejection，降级显示原文
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
    const root = containerRef.current;
    if (!root) return;
    let cancelled = false;
    const mermaidElements = root.querySelectorAll<HTMLElement>(".mermaid");
    mermaidElements.forEach(async (el) => {
      if (el.classList.contains("rendered")) return;
      const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const code = el.textContent || "";
      try {
        // P1-1①（2026-09-28）：**先用 `parse` 预校验**——实测非法语法在此即抛
        // "Parse error on line 1"（`graph TD; A-->;`），因此不再进入 `render`
        // ⇒ mermaid 不会往 DOM 注入它自带的 "Syntax error in text mermaid version …" 错误图
        //（用户截图里右下角的红字即此）。
        await mermaid.parse(code);
        const { svg } = await mermaid.render(id, code);
        if (cancelled) return;
        el.innerHTML = DOMPurify.sanitize(svg, {
          USE_PROFILES: { svg: true, svgFilters: true },
        });
        el.classList.add("rendered");
      } catch {
        // 兜底清理：`render` 失败时可能在 document 上残留临时节点/错误图
        document.getElementById(id)?.remove();
        document.getElementById(`d${id}`)?.remove();
        if (cancelled) return;
        // 降级 UI：通俗提示（不用"语法/mermaid"等技术术语）+ 原样保留源码（可复制），
        // 不再以红字刷屏（文案见 `chat.mermaidRenderFailed`）
        const fallback = document.createElement("div");
        fallback.className =
          "mermaid-fallback rounded border border-amber-500/30 bg-amber-500/5 p-2";
        const hint = document.createElement("div");
        hint.className = "mb-1 text-xs text-amber-600 dark:text-amber-400";
        hint.textContent = t("chat.mermaidRenderFailed");
        const pre = document.createElement("pre");
        pre.className =
          "overflow-x-auto whitespace-pre-wrap text-xs opacity-70";
        pre.textContent = code;
        fallback.append(hint, pre);
        el.replaceWith(fallback);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [blocks, t]);

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
      // R5 引用锚点：file.pdf#p.12 / file.md#L42-L58（在 url/公式前优先）
      { regex: CITATION_TOKEN_RE, tag: "citation" as const },
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
          if (isSafeUrl(imgSrc)) {
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
          } else {
            // #3 修复：危险协议（data:/javascript: 等）不加载，降级为 alt 文本
            parts.push(
              <span key={key++} className="text-gray-700 dark:text-gray-300">
                {imgAlt}
              </span>,
            );
          }
        } else if (pattern.tag === "link") {
          const linkHref = match[2];
          if (isSafeUrl(linkHref)) {
            parts.push(
              <a
                key={key++}
                href={linkHref}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 hover:underline"
              >
                {match[1]}
              </a>,
            );
          } else {
            // #3 修复：危险协议（javascript: 等）降级为纯文本，不渲染可点击链接
            parts.push(
              <span key={key++} className="text-gray-700 dark:text-gray-300">
                {match[1]} ({linkHref})
              </span>,
            );
          }
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
        } else if (pattern.tag === "citation") {
          // R5：本地引用锚点（doc.pdf#p.N / file.md#L42-L58）→ 点击打开文件定位
          const file = match[1];
          const ref = match[2];
          parts.push(
            <CitationLink
              key={key++}
              citation={{ file, ref, ...parseCitationRef(ref) }}
              knownFilePaths={knownFilePaths}
            />,
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
              // #4 修复：尾段 KaTeX 输出此前直接裸插，统一走 DOMPurify
              dangerouslySetInnerHTML={{
                __html: DOMPurify.sanitize(
                  renderedFormula,
                ) as unknown as string,
              }}
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
      // P1-9（2026-09-27，D1=C）：原 `prose prose-sm` 为失效类（未装 typography 插件）⇒ 清理
      <div className="max-w-none">
        <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-xs">
          <p className="text-amber-600 dark:text-amber-400 font-medium mb-1">
            ⚠️ 内容过长（{(normalizedContent.length / 1024).toFixed(0)}{" "}
            KB），已截断显示前 5000 字符
          </p>
          <pre className="mt-2 p-2 bg-gray-100 dark:bg-gray-800 rounded text-gray-700 dark:text-gray-300 overflow-auto max-h-96 whitespace-pre-wrap text-[11px] leading-relaxed">
            {safeContent}
          </pre>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <span className="text-amber-500 dark:text-amber-400">
              ...{" "}
              {t("chat.truncatedChars", {
                count: (normalizedContent.length - 5000).toLocaleString(),
              })}{" "}
              ...
            </span>
            <button
              onClick={handleCopyFull}
              className="px-2 py-0.5 rounded border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
            >
              {copiedFull
                ? `\u2713 ${t("chat.copiedFullText")}`
                : t("chat.copyFullText")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    // P1-9（2026-09-27，D1=C）：清理失效的 prose 类
    <div ref={containerRef} className="max-w-none">
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
    </div>
  );
}

export default MarkdownRenderer;
