/**
 * MarkdownRenderer — 基于 react-markdown 的 Markdown 渲染器
 * MIT License
 *
 * 替代手写版（1033 行），消除手写 parser 维护负担。
 * 复用共享模块：markdown/pathCache、markdown/InlineCodeLink、markdown/latexDetector
 */
export { default } from "./MarkdownRendererV2";
export type { MarkdownRendererProps } from "./MarkdownRendererV2";