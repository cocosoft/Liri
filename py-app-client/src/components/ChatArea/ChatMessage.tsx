import { Message } from '../../types';

interface ChatMessageProps {
  message: Message;
}

function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-lg p-4 rounded-lg ${
          isUser
            ? 'bg-blue-500 text-white'
            : 'bg-white border border-gray-200'
        }`}
      >
        <div className="text-sm whitespace-pre-wrap break-words">
          {message.content}
        </div>

        {message.tool_calls && message.tool_calls.length > 0 && (
          <div className="mt-3 space-y-2">
            {message.tool_calls.map((toolCall) => (
              <div
                key={toolCall.id}
                className={`p-2 rounded text-xs ${
                  isUser ? 'bg-blue-600' : 'bg-yellow-50 border border-yellow-200'
                }`}
              >
                <div className="font-medium">工具: {toolCall.name}</div>
                <div className="mt-1 text-xs opacity-80">
                  参数: {JSON.stringify(toolCall.arguments)}
                </div>
                {toolCall.result !== undefined && (
                  <div className="mt-1 text-xs opacity-80">
                    结果: {String(toolCall.result)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default ChatMessage;