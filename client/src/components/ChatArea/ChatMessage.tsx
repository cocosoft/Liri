import React, { useState } from 'react';
import type { Message, MessageBlock } from '../../types';
import MarkdownRenderer from './MarkdownRenderer';
import ThinkingBlock from './ThinkingBlock';
import StatusBlock from './StatusBlock';
import ToolCallBlock from './ToolCallBlock';
import ToolExecutionGroup from './ToolExecutionGroup';

interface ChatMessageProps {
  message: Message;
  isStreaming?: boolean;
  sessionUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd?: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
  };
}

function ChatMessage({ message, isStreaming, sessionUsage }: ChatMessageProps) {
  const [showActions, setShowActions] = useState(false);
  const isUser = message.role === 'user';

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  };

  const formatCost = (costUsd?: number) => {
    if (!costUsd) return null;
    if (costUsd < 0.01) {
      return `${(costUsd * 100).toFixed(2)} ¢`;
    }
    return `$${costUsd.toFixed(4)}`;
  };

  const handleCopy = async () => {
    if (typeof message.content === 'string') {
      await navigator.clipboard.writeText(message.content);
    }
    setShowActions(false);
  };

  const handleRegenerate = () => {
    // TODO: 实现重新生成功能
    setShowActions(false);
  };

  return (
    <div
      className={`flex gap-3 p-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors rounded-lg mx-2 -mx-2`}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* 头像 */}
      <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium">
        {isUser ? (
          <div className="bg-blue-500 text-white">
            👤
          </div>
        ) : (
          <div className="bg-gradient-to-br from-purple-500 to-blue-500 text-white">
            🤖
          </div>
        )}
      </div>

      {/* 消息内容区域 */}
      <div className="flex-1 min-w-0">
        {/* 头部：名称 */}
        <div className="flex items-center gap-2 mb-1">
          <span className={`text-sm font-medium ${
            isUser ? 'text-gray-700 dark:text-gray-300' : 'text-gray-600 dark:text-gray-400'
          }`}>
            {isUser ? '你' : 'Liri'}
          </span>
        </div>

        {/* 消息气泡 */}
        <div
          className={`max-w-3xl px-4 py-3 rounded-xl ${
            isUser
              ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white ml-auto'
              : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100'
          }`}
        >
          {/* 消息内容 */}
          {isUser ? (
            <div className="text-sm whitespace-pre-wrap break-words leading-relaxed">
              {message.content}
            </div>
          ) : (
            <AssistantMessage
              message={message}
              isStreaming={isStreaming}
            />
          )}

          {/* 消息底部：时间、Token 用量和预估成本 */}
          <div className={`flex items-center justify-end gap-3 mt-2 pt-2 border-t ${
            isUser ? 'border-blue-400/30' : 'border-gray-200 dark:border-gray-700'
          }`}>
            {/* 时间 */}
            <span className={`text-xs ${
              isUser ? 'text-blue-200' : 'text-gray-400'
            }`}>
              {message.timestamp ? formatTime(message.timestamp) : ''}
            </span>

            {/* 会话累计 Token 和成本 */}
            {sessionUsage && sessionUsage.totalTokens > 0 && (
              <div className={`flex items-center gap-2 text-xs ${
                isUser ? 'text-blue-200' : 'text-gray-400'
              }`}>
                <span className="flex items-center gap-1">
                  <span>💬</span>
                  <span>{(sessionUsage.totalTokens).toLocaleString()} tokens</span>
                </span>
                {sessionUsage.cacheReadTokens != null && sessionUsage.cacheReadTokens > 0 && (
                  <span className="text-cyan-500">📖CR {(sessionUsage.cacheReadTokens).toLocaleString()}</span>
                )}
                {sessionUsage.cacheCreationTokens != null && sessionUsage.cacheCreationTokens > 0 && (
                  <span className="text-yellow-500">✏️CW {(sessionUsage.cacheCreationTokens).toLocaleString()}</span>
                )}
                {sessionUsage.estimatedCostUsd != null && sessionUsage.estimatedCostUsd > 0 && (
                  <span className={`flex items-center gap-1 ${
                    isUser ? 'text-green-300' : 'text-emerald-500 dark:text-emerald-400'
                  }`}>
                    <span>💰</span>
                    <span>{formatCost(sessionUsage.estimatedCostUsd)}</span>
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 操作按钮 */}
        {showActions && !isUser && (
          <div className="flex items-center gap-2 mt-2 opacity-70">
            <button
              onClick={handleCopy}
              className="px-3 py-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
            >
              复制
            </button>
            <button
              onClick={handleRegenerate}
              className="px-3 py-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
            >
              重新生成
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function AssistantMessage({ message, isStreaming }: { message: Message; isStreaming?: boolean }) {
  if (message.blocks && message.blocks.length > 0) {
    const renderedContent = renderBlocksWithGroups(message.blocks, isStreaming);
    return (
      <div className="text-sm break-words max-w-none space-y-3">
        {renderedContent}
      </div>
    );
  }

  return (
    <div className="text-sm break-words max-w-none space-y-3">
      <MarkdownRenderer content={message.content} isStreaming={isStreaming} />
      {message.tool_calls && message.tool_calls.length > 0 && (
        <div className="space-y-2">
          {message.tool_calls.map((tc) => (
            <ToolCallBlock
              key={tc.id}
              toolCall={tc}
              isStreaming={isStreaming}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 判断 block 是否为工具执行相关类型
 */
function isToolRelatedBlock(block: MessageBlock): boolean {
  return block.type === 'status' || block.type === 'tool_call';
}

/**
 * 将 blocks 中的连续工具相关 blocks 组合成 ToolExecutionGroup
 */
function renderBlocksWithGroups(blocks: MessageBlock[], isStreaming?: boolean): React.ReactNode[] {
  const result: React.ReactNode[] = [];
  let i = 0;

  while (i < blocks.length) {
    const block = blocks[i];

    if (!isToolRelatedBlock(block)) {
      result.push(
        <BlockRenderer
          key={block.id}
          block={block}
          isStreaming={isStreaming}
        />
      );
      i++;
      continue;
    }

    const toolBlocks: MessageBlock[] = [];

    while (i < blocks.length && isToolRelatedBlock(blocks[i])) {
      toolBlocks.push(blocks[i]);
      i++;
    }

    result.push(
      <ToolExecutionGroup
        key={`tool-group-${toolBlocks[0]?.id || i}`}
        blocks={toolBlocks}
        isStreaming={isStreaming}
      />
    );
  }

  return result;
}

interface BlockRendererProps {
  block: MessageBlock;
  isStreaming?: boolean;
}

function BlockRenderer({ block, isStreaming }: BlockRendererProps) {
  switch (block.type) {
    case 'thinking':
      return (
        <ThinkingBlock
          content={block.content}
          isStreaming={block.isStreaming || isStreaming}
        />
      );
    case 'status':
      return <StatusBlock content={block.content} isStreaming={block.isStreaming || isStreaming} />;
    case 'tool_call':
      return block.toolCall ? (
        <ToolCallBlock
          toolCall={block.toolCall}
          isStreaming={block.isStreaming || isStreaming}
        />
      ) : null;
    case 'text':
    default:
      return (
        <MarkdownRenderer
          content={block.content}
          isStreaming={block.isStreaming || isStreaming}
        />
      );
  }
}

export default ChatMessage;
