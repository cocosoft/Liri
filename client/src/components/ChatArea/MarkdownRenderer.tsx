import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import CodeBlock from './CodeBlock';
import './markdown-theme.css';

interface MarkdownRendererProps {
  content: string;
  isStreaming?: boolean;
}

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, isStreaming }) => {
  const [renderedContent, setRenderedContent] = React.useState(content);

  React.useEffect(() => {
    setRenderedContent(content);
  }, [content]);

  const [showMarkdown, setShowMarkdown] = React.useState(!isStreaming);

  React.useEffect(() => {
    if (!isStreaming) {
      setTimeout(() => setShowMarkdown(true), 100);
    }
  }, [isStreaming, content]);

  if (!showMarkdown) {
    return <div className="markdown-body prose-content whitespace-pre-wrap">{content}</div>;
  }

  return (
    <div className="markdown-body prose-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          code({ className, children, ...props }) {
            const match = className?.match(/language-(\w+)/);
            const language = match ? match[1] : 'text';
            const isInline = !className || !className.startsWith('language-');
            
            if (isInline) {
              return (
                <code className={`inline-code ${className || ''}`} {...props}>
                  {children}
                </code>
              );
            }
            
            return (
              <CodeBlock language={language} code={String(children).replace(/\n$/, '')} />
            );
          },
          link({ href, children }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="markdown-link"
              >
                {children}
              </a>
            );
          },
          table({ children }) {
            return (
              <div className="markdown-table-wrapper overflow-x-auto">
                <table className="markdown-table">{children}</table>
              </div>
            );
          },
        }}
        skipHtml={false}
      >
        {renderedContent}
      </ReactMarkdown>
    </div>
  );
};

export default MarkdownRenderer;
