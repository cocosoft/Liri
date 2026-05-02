/**
 * Markdown渲染组件
 * 用于渲染Markdown格式文本
 */

import React from 'react';

export interface MarkdownRendererProps {
  content: string;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  const renderMarkdown = () => {
    let result = content;

    // 处理粗体 **text**
    result = result.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    // 处理斜体 *text*
    result = result.replace(/\*(.*?)\*/g, '<em>$1</em>');

    // 处理代码 `text`
    result = result.replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 bg-gray-200 rounded text-sm font-mono">$1</code>');

    // 处理链接 [text](url)
    result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-blue-500 underline">$1</a>');

    // 处理标题
    result = result.replace(/^### (.*$)/gim, '<h3 class="text-lg font-bold mt-4 mb-2">$1</h3>');
    result = result.replace(/^## (.*$)/gim, '<h2 class="text-xl font-bold mt-6 mb-3">$1</h2>');
    result = result.replace(/^# (.*$)/gim, '<h1 class="text-2xl font-bold mt-8 mb-4">$1</h1>');

    // 处理列表项
    result = result.replace(/^- (.*$)/gim, '<li class="ml-4">$1</li>');
    result = result.replace(/(<li>.*<\/li>)/g, '<ul class="list-disc">$1</ul>');

    // 处理代码块
    result = result.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
      return `<pre class="bg-gray-900 text-green-400 p-4 rounded-lg overflow-x-auto"><code class="text-sm">${code.trim()}</code></pre>`;
    });

    // 处理换行
    result = result.replace(/\n/g, '<br/>');

    return <div dangerouslySetInnerHTML={{ __html: result }} />;
  };

  return (
    <div className="markdown-renderer text-gray-900 leading-relaxed">
      {renderMarkdown()}
    </div>
  );
};