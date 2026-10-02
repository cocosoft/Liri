/**
 * 消息列表组件
 * 用于显示聊天消息列表
 */

import React, { useRef, useEffect } from 'react';
import { MessageBubble, MessageBubbleProps } from './MessageBubble';

/**
 * UI 渲染用消息（2026-10-01 数据契约专项 U2 #6：原名 `Message`，
 * 与规范来源 `chat/types/message.ts` 同名不同物（本版用 `sender` 而非 `role`）⇒ 依 §9.2 原则 2 改名 `UIMessage`）
 */
export interface UIMessage {
  id: string;
  content: string;
  sender: 'user' | 'assistant' | 'system';
  timestamp?: Date;
  type?: 'text' | 'markdown' | 'code';
  codeLanguage?: string;
  isLoading?: boolean;
  toolCall?: {
    id: string;
    name: string;
    args: Record<string, unknown>;
  };
  toolResult?: {
    toolName: string;
    success: boolean;
    result: string;
  };
}

export interface MessagesProps {
  messages: UIMessage[];
  isLoading?: boolean;
}

export const Messages: React.FC<MessagesProps> = ({ messages, isLoading }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const renderMessage = (message: UIMessage) => {
    const bubbleProps: MessageBubbleProps = {
      content: message.content,
      sender: message.sender,
      timestamp: message.timestamp,
      type: message.type,
      codeLanguage: message.codeLanguage,
      isLoading: message.isLoading,
    };

    return (
      <div key={message.id} className="message-wrapper">
        <MessageBubble {...bubbleProps} />

        {message.toolCall && (
          <div className="tool-call-container">
            <div className="tool-call-header">
              <span className="tool-call-icon">⚙️</span>
              <span className="tool-call-name">{message.toolCall.name}</span>
            </div>
            <pre className="tool-call-args">
              {JSON.stringify(message.toolCall.args, null, 2)}
            </pre>
          </div>
        )}

        {message.toolResult && (
          <div
            className={`tool-result-container ${message.toolResult.success ? 'success' : 'error'}`}
          >
            <div className="tool-result-header">
              <span className="tool-result-icon">
                {message.toolResult.success ? '✓' : '✗'}
              </span>
              <span className="tool-result-name">
                {message.toolResult.toolName}
              </span>
            </div>
            <pre className="tool-result-content">
              {message.toolResult.result}
            </pre>
          </div>
        )}
      </div>
    );
  };

  return (
    <div ref={scrollRef} className="messages-container overflow-y-auto">
      {messages.map(renderMessage)}

      {isLoading && (
        <div className="loading-indicator">
          <MessageBubble content="" sender="assistant" isLoading={true} />
        </div>
      )}
    </div>
  );
};

/**
 * 创建消息列表组件
 */
export function createMessages(props: MessagesProps): React.ReactElement {
  return <Messages {...props} />;
}
