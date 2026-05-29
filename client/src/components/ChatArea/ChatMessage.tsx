import type { Message, MessageBlock } from '../../types';
import MarkdownRenderer from './MarkdownRenderer';
import ThinkingBlock from './ThinkingBlock';
import StatusBlock from './StatusBlock';
import ToolCallBlock from './ToolCallBlock';

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
          <AssistantMessage
            message={message}
            isStreaming={isStreaming}
          />
        )}
      </div>
    </div>
  );
}

function AssistantMessage({ message, isStreaming }: { message: Message; isStreaming?: boolean }) {
  if (message.blocks && message.blocks.length > 0) {
    return (
      <div className="text-sm break-words max-w-none space-y-2">
        {message.blocks.map((block) => (
          <BlockRenderer
            key={block.id}
            block={block}
            isStreaming={isStreaming}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="text-sm break-words max-w-none space-y-2">
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
