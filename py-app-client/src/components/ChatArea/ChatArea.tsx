import { useChatStore } from '../../stores/chatStore';
import { useSessionStore } from '../../stores/sessionStore';
import ChatMessage from './ChatMessage';

function ChatArea() {
  const { messages } = useChatStore();
  const { currentSession } = useSessionStore();

  return (
    <div className="flex-1 overflow-y-auto p-6">
      {!currentSession ? (
        <div className="flex items-center justify-center h-full">
          <div className="text-center text-gray-500">
            <p className="text-lg mb-2">欢迎使用 PY_APP</p>
            <p className="text-sm">请从左侧选择一个会话或创建新会话</p>
          </div>
        </div>
      ) : messages.length === 0 ? (
        <div className="flex items-center justify-center h-full">
          <div className="text-center text-gray-500">
            <p className="text-lg mb-2">{currentSession.title}</p>
            <p className="text-sm">开始发送消息进行对话</p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {messages.map((message) => (
            <ChatMessage key={message.id} message={message} />
          ))}
        </div>
      )}
    </div>
  );
}

export default ChatArea;