/**
 * 消息气泡组件
 * 用于显示聊天消息
 */

import React from 'react';

export interface MessageBubbleProps {
  content: string;
  sender: 'user' | 'assistant' | 'system';
  timestamp?: Date;
  type?: 'text' | 'markdown' | 'code';
  codeLanguage?: string;
  isLoading?: boolean;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({
  content,
  sender,
  timestamp,
  type = 'text',
  codeLanguage,
  isLoading = false,
}) => {
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  };

  const getSenderStyle = () => {
    switch (sender) {
      case 'user':
        return 'bg-blue-500 text-white rounded-2xl rounded-br-md';
      case 'assistant':
        return 'bg-gray-100 text-gray-900 rounded-2xl rounded-bl-md border border-gray-200';
      case 'system':
        return 'bg-gray-50 text-gray-500 rounded-lg text-xs italic';
      default:
        return 'bg-gray-100 text-gray-900 rounded-2xl';
    }
  };

  const getSenderLabel = () => {
    switch (sender) {
      case 'user':
        return 'You';
      case 'assistant':
        return 'Assistant';
      case 'system':
        return 'System';
      default:
        return '';
    }
  };

  const renderContent = () => {
    if (isLoading) {
      return (
        <div className="flex items-center space-x-2">
          <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
          <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
          <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      );
    }

    if (type === 'code') {
      return (
        <pre className="whitespace-pre-wrap text-sm overflow-x-auto p-3 bg-gray-900 text-green-400 rounded-lg">
          <code className={codeLanguage ? `language-${codeLanguage}` : ''}>
            {content}
          </code>
        </pre>
      );
    }

    if (type === 'markdown') {
      return (
        <div className="markdown-content whitespace-pre-wrap">
          {content}
        </div>
      );
    }

    return <span className="whitespace-pre-wrap">{content}</span>;
  };

  return (
    <div className={`flex flex-col ${sender === 'user' ? 'items-end' : 'items-start'} mb-4`}>
      <div className={`px-4 py-3 max-w-[75%] ${getSenderStyle()}`}>
        {sender !== 'system' && (
          <div className={`text-xs font-semibold mb-1 ${sender === 'user' ? 'text-blue-200' : 'text-gray-500'}`}>
            {getSenderLabel()}
          </div>
        )}
        {renderContent()}
      </div>
      {timestamp && (
        <div className="text-xs text-gray-400 mt-1 px-1">
          {formatTime(timestamp)}
        </div>
      )}
    </div>
  );
};