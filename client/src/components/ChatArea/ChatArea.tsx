import { useChatStore } from '../../stores/chatStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useBackendStore } from '../../stores/backendStore';
import ChatMessage from './ChatMessage';
import { useVirtualList } from '../../hooks/useVirtualList';

const ESTIMATED_ITEM_HEIGHT = 100;

function ChatArea() {
  const { messages, error, isStreaming } = useChatStore();
  const { currentSession } = useSessionStore();
  const backendRunning = useBackendStore((s) => s.status.running);

  const handleDismissError = () => {
    useChatStore.setState({ error: null });
  };

  const displayError = error
    && !backendRunning
    && (error.includes('fetch') || error.includes('connect') || error.includes('NetworkError'))
    ? '后端服务未运行。请点击左侧侧边栏底部的 "未连接" 按钮查看启动说明。'
    : error;

  const {
    containerRef,
    visibleItems,
    totalHeight,
    offsetY,
    measureItem,
  } = useVirtualList(messages, {
    itemHeight: ESTIMATED_ITEM_HEIGHT,
    overscan: 5,
  });

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto p-6 bg-gray-50 dark:bg-gray-900"
    >
      {displayError && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg flex items-start gap-2">
          <span className="text-red-500 dark:text-red-400 flex-shrink-0 mt-0.5">⚠</span>
          <span className="text-sm text-red-700 dark:text-red-300 flex-1">{displayError}</span>
          <button
            onClick={handleDismissError}
            className="text-red-400 hover:text-red-600 dark:hover:text-red-200 flex-shrink-0"
            title="关闭"
          >
            ✕
          </button>
        </div>
      )}
      {!currentSession ? (
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <p className="text-lg mb-2 text-gray-700 dark:text-gray-300">欢迎使用 PY_APP</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">请从左侧选择一个会话或创建新会话</p>
          </div>
        </div>
      ) : messages.length === 0 ? (
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <p className="text-lg mb-2 text-gray-700 dark:text-gray-300">{currentSession.title}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">开始发送消息进行对话</p>
          </div>
        </div>
      ) : (
        <div style={{ height: totalHeight, position: 'relative' }}>
          <div style={{ transform: `translateY(${offsetY}px)` }}>
            {visibleItems.map((message) => (
               <div
                 key={message.id}
                ref={(el) => {
                  if (el) {
                    measureItem(messages.indexOf(message), el.offsetHeight);
                  }
                }}
              >
                <ChatMessage
                  message={message}
                  isStreaming={isStreaming && message.role === 'assistant'}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default ChatArea;