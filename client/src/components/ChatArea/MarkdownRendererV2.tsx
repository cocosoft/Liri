/**
 * MarkdownRendererV2 — 基于 react-markdown 的 Markdown 渲染器
 * MIT License
 *
 * 替代手写 MarkdownRenderer.tsx（1033 行），消除手写 parser 维护负担。
 * 功能保留：
 * - 代码块复制/展开（接入 CodeBlock 组件）
 * - Mermaid 图表（ref callback 渲染）
 * - $...$ / $$...$$ KaTeX 公式（remark-math + rehype-katex）
 * - 裸 LaTeX 公式自动检测（latexDetector 共享模块）
 * - 行内代码 → 文件路径渐进式链接（InlineCodeLink 共享模块）
 * - URL 自动链接 + 文件路径自动检测（PlainParagraph 组件）
 */
import React, { memo, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import katex from "katex";
import mermaid from "mermaid";
import "katex/dist/katex.min.css";

import CodeBlock from "./CodeBlock";
import FileLink from "./FileLink";
import { InlineCodeLink } from "./markdown/InlineCodeLink";
import { isLatexFormula } from "./markdown/latexDetector";

// ============================================================
// 类型定义
// ============================================================

interface MarkdownRendererProps {
  content: string;
  isStreaming?: boolean;
  onPreviewFile?: (path: string) => void;
  knownFilePaths?: string[];
}

// ============================================================
// 模块级初始化
// ============================================================

/** mermaid 懒初始化（模块级，仅执行一次） */
let mermaidInitialized = false;

function ensureMermaidInit(): void {
  if (!mermaidInitialized) {
    mermaid.initialize({ startOnLoad: false });
    mermaidInitialized = true;
  }
}

// ============================================================
// 子组件：Mermaid 图表
// ============================================================

/** ref callback 方式渲染 mermaid，避免 useEffect 全量重查 DOM */
function MermaidBlock({ code }: { code: string }) {
  const mermaidRef = useCallback((el: HTMLDivElement | null) => {
    if (!el || el.dataset.mermaidRendered === "1") return;
    if (!code.trim()) return;

    const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    mermaid.render(id, code).then(({ svg }) => {
      el.innerHTML = svg;
      el.dataset.mermaidRendered = "1";
    }).catch(() => {
      /* 渲染失败静默处理 */
    });
  }, [code]);

  return (
    <div
      ref={mermaidRef}
      className="mermaid my-4"
      style={{ backgroundColor: "#1a1a1a", padding: "1rem", borderRadius: "8px" }}
    >
      {code}
    </div>
  );
}

// ============================================================
// 子组件：裸 LaTeX 公式兜底
// ============================================================

/** 处理 remark-math 无法识别的非 $ 包裹公式 */
function LatexText({ text }: { text: string }) {
  if (!isLatexFormula(text)) return <>{text}</>;

  let rendered: string;
  try {
    rendered = katex.renderToString(text, { displayMode: false });
  } catch {
    return <>{text}</>;
  }

  return (
    <span
      className="inline-block"
      dangerouslySetInnerHTML={{ __html: rendered }}
    />
  );
}

// ============================================================
// 子组件：纯文本段落 URL / 文件路径检测
// ============================================================

interface PlainParagraphProps {
  text: string;
  knownFilePaths?: string[];
  onPreviewFile?: (path: string) => void;
}

/**
 * 将纯文本段落中的裸 URL 和本地文件路径转换为可点击链接
 * 注意：仅在段落 children 为纯 string 时由 <p> 组件触发，
 * 含内联格式的混合段落走 react-markdown 默认行为
 */
function PlainParagraph({ text, knownFilePaths, onPreviewFile }: PlainParagraphProps) {
  const urlRegex = /(https?:\/\/[^\s<>)\]]+)/;
  const filePathRegex =
    /((?:[A-Za-z]:)?[\\/](?:[^\s<>")|]+[\\/])+[^\s<>")|]+\.[a-zA-Z0-9]{1,10})/;

  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;
  let match: RegExpExecArray | null;

  // 第一轮：裸 URL
  while ((match = urlRegex.exec(remaining)) !== null) {
    if (match.index > 0) {
      parts.push(<span key={key++}>{remaining.slice(0, match.index)}</span>);
    }
    parts.push(
      <a key={key++} href={match[1]} target="_blank" rel="noopener noreferrer"
         className="text-blue-500 hover:underline">
        {match[1]}
      </a>
    );
    remaining = remaining.slice(match.index + match[1].length);
  }

  // 第二轮：裸文件路径
  let textRemaining = remaining;
  while ((match = filePathRegex.exec(textRemaining)) !== null) {
    if (match.index > 0) {
      parts.push(<span key={key++}>{textRemaining.slice(0, match.index)}</span>);
    }
    const path = match[1];
    const isKnown = knownFilePaths?.some(
      (fp) => fp === path || fp.endsWith("/" + path) || fp.endsWith("\\" + path)
    );
    if (isKnown && onPreviewFile) {
      parts.push(
        <FileLink key={key++} filePath={path} onPreview={onPreviewFile} />
      );
    } else {
      parts.push(<span key={key++}>{path}</span>);
    }
    textRemaining = textRemaining.slice(match.index + match[1].length);
  }

  if (textRemaining) {
    parts.push(<LatexText key={key++} text={textRemaining} />);
  }

  return <>{parts}</>;
}

// ============================================================
// 主组件
// ============================================================

const MarkdownRendererV2 = memo(function MarkdownRendererV2({
  content,
  isStreaming,
  onPreviewFile,
  knownFilePaths,
}: MarkdownRendererProps) {
  ensureMermaidInit();

  return (
    <div className="leading-5">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeHighlight]}
        components={{
          // ---- 代码块 / 行内代码 ----
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || "");
            const lang = match?.[1];
            const codeString = String(children).replace(/\n$/, "");

            // Mermaid 代码块
            if (!props.node?.properties?.inline && lang === "mermaid") {
              return <MermaidBlock code={codeString} />;
            }

            // 普通代码块（带复制/展开）
            if (!props.node?.properties?.inline) {
              return <CodeBlock language={lang || "text"} code={codeString} className={className} />;
            }

            // 行内代码 → 文件路径渐进式链接
            return (
              <InlineCodeLink
                codeContent={codeString}
                knownFilePaths={knownFilePaths}
                onPreviewFile={onPreviewFile}
              />
            );
          },

          // ---- 表格（滚动 + 斑马纹） ----
          table({ children }) {
            return (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse my-4">{children}</table>
              </div>
            );
          },
          thead({ children }) {
            return <thead className="bg-gray-100 dark:bg-gray-700">{children}</thead>;
          },
          th({ children }) {
            return (
              <th className="border border-gray-300 dark:border-gray-600 px-4 py-2 text-left">
                {children}
              </th>
            );
          },
          td({ children }) {
            return (
              <td className="border border-gray-300 dark:border-gray-600 px-4 py-2">
                {children}
              </td>
            );
          },
          tr({ children }) {
            return <tr className="even:bg-gray-50 dark:even:bg-gray-750">{children}</tr>;
          },

          // ---- 标题 ----
          h1: ({ children }) => (
            <h1 className="text-2xl font-bold my-4 text-gray-900 dark:text-white">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-xl font-bold my-3 text-gray-900 dark:text-white">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-lg font-bold my-2 text-gray-900 dark:text-white">{children}</h3>
          ),
          h4: ({ children }) => (
            <h4 className="text-base font-bold my-2 text-gray-900 dark:text-white">{children}</h4>
          ),
          h5: ({ children }) => (
            <h5 className="text-sm font-bold my-1 text-gray-900 dark:text-white">{children}</h5>
          ),
          h6: ({ children }) => (
            <h6 className="text-xs font-bold my-1 text-gray-900 dark:text-white">{children}</h6>
          ),

          // ---- 文本叶子节点（覆盖混合 inline 段落的裸路径检测） ----
          text({ children }) {
            const text = String(children);
            // 所有纯文本叶子节点都经过这里，不论外层是否有 bold/italic 等 inline 元素
            // 这样混合段落中的 /path/to/file.yaml 也能被检测到
            return (
              <PlainParagraph
                text={text}
                knownFilePaths={knownFilePaths}
                onPreviewFile={onPreviewFile}
              />
            );
          },

          // ---- 链接 ----
          a({ href, children }) {
            if (href && !href.startsWith("http") && !href.startsWith("#")) {
              return (
                <FileLink
                  filePath={href}
                  onPreview={onPreviewFile || (() => {})}
                />
              );
            }

            // 外部链接：Tauri 环境下用系统浏览器打开
            const handleClick = (e: React.MouseEvent) => {
              const isTauri =
                typeof window !== "undefined" &&
                ("__TAURI__" in window || "__TAURI_INTERNALS__" in window);
              if (isTauri) {
                e.preventDefault();
                import("@tauri-apps/plugin-shell").then(({ open }) => {
                  open(href!);
                });
              }
              // 非 Tauri 环境走默认行为（target="_blank"）
            };

            return (
              <a
                href={href}
                onClick={handleClick}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 hover:underline"
              >
                {children}
              </a>
            );
          },

          // ---- 水平线 ----
          hr: () => <hr className="my-4 border-gray-300 dark:border-gray-600" />,

          // ---- 段落（纯文本 → URL/路径检测，混合内容 → 默认行为） ----
          p({ children }) {
            if (typeof children === "string") {
              return (
                <p className="my-2 whitespace-pre-wrap">
                  <PlainParagraph
                    text={children}
                    knownFilePaths={knownFilePaths}
                    onPreviewFile={onPreviewFile}
                  />
                </p>
              );
            }
            return <p className="my-2 whitespace-pre-wrap">{children}</p>;
          },
        }}
      >
        {content}
      </ReactMarkdown>

      {/* 流式光标 */}
      {isStreaming && <span className="animate-pulse">&#9642;</span>}
    </div>
  );
});

export default MarkdownRendererV2;
export type { MarkdownRendererProps };