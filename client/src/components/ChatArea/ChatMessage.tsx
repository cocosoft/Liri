import { useState } from 'react';
import { Message } from '../../types';
import MarkdownRenderer from './MarkdownRenderer';

interface ChatMessageProps {
  message: Message;
  isStreaming?: boolean;
}

function ChatMessage({ message, isStreaming }: ChatMessageProps) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-2xl p-4 rounded-lg ${
          isUser
            ? 'bg-blue-500 text-white'
            : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100'
        }`}
      >
        {isUser ? (
          <div className="text-sm whitespace-pre-wrap break-words">
            {message.content}
          </div>
        ) : (
          <div className="text-sm break-words max-w-none">
            <MarkdownRenderer content={message.content} isStreaming={isStreaming} />
          </div>
        )}

        {message.tool_calls && message.tool_calls.length > 0 && (
          <div className="mt-3 space-y-2">
            {message.tool_calls.map((toolCall) => (
              <ToolCallCard
                key={toolCall.id}
                toolCall={toolCall}
                isUser={isUser}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface ToolCallCardProps {
  toolCall: NonNullable<Message['tool_calls']>[number];
  isUser: boolean;
}

function ToolCallCard({ toolCall, isUser }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);

  const hasResult = toolCall.result !== undefined;
  const hasError = hasResult && typeof toolCall.result === 'object' &&
    toolCall.result !== null && 'error' in (toolCall.result as Record<string, unknown>);
  const isRunning = !hasResult;

  const statusIcon = isRunning ? '⏳' : hasError ? '❌' : '✅';
  const statusColor = isRunning
    ? 'border-blue-300 dark:border-blue-600'
    : hasError
      ? 'border-red-300 dark:border-red-600'
      : 'border-green-300 dark:border-green-600';
  const headerBg = isRunning
    ? 'bg-blue-50 dark:bg-blue-900/30'
    : hasError
      ? 'bg-red-50 dark:bg-red-900/30'
      : 'bg-green-50 dark:bg-green-900/30';

  return (
    <div
      className={`rounded border ${statusColor} text-xs overflow-hidden transition-colors ${
        isUser ? '' : ''
      }`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className={`w-full flex items-center gap-2 px-3 py-2 ${headerBg} hover:opacity-80 transition-opacity text-left`}
      >
        <span className="text-sm">{statusIcon}</span>
        <span className="font-medium flex-1 truncate">{toolCall.name}</span>
        <span className="text-gray-400 dark:text-gray-500">
          {expanded ? '▲' : '▼'}
        </span>
      </button>

      {expanded && (
        <div className="p-3 space-y-2 bg-white dark:bg-gray-800">
          <div>
            <div className="font-medium text-gray-500 dark:text-gray-400 mb-1">
              参数
            </div>
            <pre className="bg-gray-50 dark:bg-gray-900 p-2 rounded text-xs overflow-x-auto text-gray-700 dark:text-gray-300">
              {JSON.stringify(toolCall.arguments, null, 2)}
            </pre>
          </div>

          {hasResult && (
            <div>
              <div className="font-medium text-gray-500 dark:text-gray-400 mb-1">
                结果
              </div>
              <pre className="bg-gray-50 dark:bg-gray-900 p-2 rounded text-xs overflow-x-auto max-h-40 overflow-y-auto text-gray-700 dark:text-gray-300">
                {typeof toolCall.result === 'string'
                  ? toolCall.result
                  : JSON.stringify(toolCall.result, null, 2)}
              </pre>
            </div>
          )}

          {isRunning && (
            <div className="flex items-center gap-2 text-blue-500 dark:text-blue-400">
              <span className="inline-block w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
              执行中...
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ChatMessage;
