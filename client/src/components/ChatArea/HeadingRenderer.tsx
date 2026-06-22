/**
 * HeadingRenderer —— markdown 标题渲染组件
 *
 * 接收 content、level 和 renderText 回调，渲染 h1~h6 标题。
 * 从 MarkdownRenderer.tsx 提取，保持原逻辑不变。
 */
import React from "react";

interface HeadingRendererProps {
  content: string;
  level: number;
  renderText: (text: string, autoDetectFormula?: boolean) => JSX.Element[];
}

function HeadingRenderer({ content, level, renderText }: HeadingRendererProps) {
  const HeadingTag = `h${level}` as keyof JSX.IntrinsicElements;
  const sizes = ["text-2xl", "text-xl", "text-lg", "text-base", "text-sm", "text-xs"];
  const margins = ["my-4", "my-3", "my-2", "my-2", "my-1", "my-1"];

  return React.createElement(HeadingTag, {
    className: `${sizes[level - 1]} font-bold text-gray-900 dark:text-white ${margins[level - 1]}`,
  }, ...renderText(content));
}

export default HeadingRenderer;
