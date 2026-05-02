import { useState } from 'react';
import { useChatStore } from '../../stores/chatStore';
import { useSessionStore } from '../../stores/sessionStore';

function ChatInput() {
  const [input, setInput] = useState('');
  const { sendMessage, isLoading } = useChatStore();
  const { currentSession } = useSessionStore();

  const handleSubmit = async () => {
    if (!input.trim() || !currentSession) return;

    await sendMessage(input, currentSession.id);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="p-4 border-t bg-white">
      <div className="flex space-x-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            currentSession
              ? '输入消息，按 Enter 发送...'
              : '请先选择或创建会话'
          }
          disabled={!currentSession || isLoading}
          className="flex-1 p-3 border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
          rows={2}
        />
        <button
          onClick={handleSubmit}
          disabled={!currentSession || isLoading || !input.trim()}
          className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium"
        >
          发送
        </button>
      </div>
      {isLoading && (
        <div className="mt-2 text-sm text-gray-500">正在等待回复...</div>
      )}
    </div>
  );
}

export default ChatInput;