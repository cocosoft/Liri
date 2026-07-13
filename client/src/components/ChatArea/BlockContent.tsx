/**
 * Markdown 块内容渲染组件
 *
 * 根据 RenderedBlock 类型分发到对应的渲染方式：
 * code → pre/code 块 | math → KaTeX | mermaid → Mermaid 图
 * table → 表格 | heading → h1~h6 | list → ul/ol | hr → 分隔线 | text → 段落
 */
import React from "react";
import katex from "katex";
import type { RenderedBlock } from "../../utils/markdownParser";
import CodeBlock from "./CodeBlock";

interface BlockContentProps {
  block: RenderedBlock;
  isStreaming?: boolean;
  renderText: (text: string, autoDetectFormula?: boolean) => JSX.Element[];
  renderHeading: (content: string, level: number, key: string) => React.ReactElement;
  renderList: (content: string, key: string) => React.ReactElement;
  renderTable: (content: string, autoDetectFormula?: boolean) => React.ReactElement | null;
}

const BlockContent = React.memo(
  function BlockContent({ block, isStreaming, renderText, renderHeading, renderList, renderTable }: BlockContentProps) {
    switch (block.type) {
      case 'code':
        return <CodeBlock code={block.content} language={block.language} />;
      case 'math': {
        let renderedFormula: string;
        try {
          renderedFormula = katex.renderToString(block.content, { displayMode: true });
        } catch {
          renderedFormula = '';
        }
        if (renderedFormula) {
          return (
            <div
              className="my-4 text-center"
              dangerouslySetInnerHTML={{
                __html: renderedFormula,
              }}
            />
          );
        }
        return (
          <div className="my-4 text-center text-gray-500 dark:text-gray-400">
            {block.content}
          </div>
        );
      }
      case 'mermaid':
        return (
          <div
            className="mermaid my-4"
            style={{ backgroundColor: '#1a1a1a', padding: '1rem', borderRadius: '8px' }}
          >
            {block.content}
          </div>
        );
      case 'table':
        return <div className="overflow-x-auto">{renderTable(block.content, !isStreaming)}</div>;
      case 'heading':
        return renderHeading(block.content, block.level || 1, String(block.id));
      case 'list':
        return renderList(block.content, String(block.id));
      case 'hr':
        return <hr className="my-4 border-gray-300 dark:border-gray-600" />;
      case 'image':
        return (
          <div className="my-2">
            <img
              src={block.url || block.content}
              alt={block.content}
              className="max-w-full h-auto rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
              loading="lazy"
            />
          </div>
        );
      case 'text':
        return (
          <p className="my-2 whitespace-pre-wrap">
            {renderText(block.content, !isStreaming)}
          </p>
        );
      default:
        return null;
    }
  },
  (prevProps, nextProps) =>
    prevProps.block.content === nextProps.block.content &&
    prevProps.block.type === nextProps.block.type &&
    prevProps.isStreaming === nextProps.isStreaming
);

BlockContent.displayName = 'BlockContent';

export default BlockContent;