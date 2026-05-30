import { useChatStore } from '../../stores/chatStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useBackendStore } from '../../stores/backendStore';
import ChatMessage from './ChatMessage';
import { useVirtualList } from '../../hooks/useVirtualList';

const ESTIMATED_ITEM_HEIGHT = 120;

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
      className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900"
    >
      {/* 错误提示 */}
      {displayError && (
        <div className="m-4 p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-xl flex items-start gap-3">
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

      {/* 无会话状态 */}
      {!currentSession ? (
        <div className="flex items-center justify-center h-full">
          <div className="text-center px-8">
            <div className="w-20 h-20 mx-auto mb-4 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center text-white text-4xl shadow-lg">
              🤖
            </div>
            <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-200 mb-2">欢迎使用 Liri</h2>
            <p className="text-gray-500 dark:text-gray-400">
              官网: https://openliri.com
            </p>
            <p className="text-gray-500 dark:text-gray-400 mt-1">
              请从右侧选择一个会话或创建新会话开始聊天
            </p>
          </div>
        </div>
      ) : messages.length === 0 ? (
        /* 空消息状态 */
        <div className="flex items-center justify-center h-full">
          <div className="text-center px-8">
            <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 dark:bg-gray-800 rounded-xl flex items-center justify-center text-3xl">
              💬
            </div>
            <h2 className="text-lg font-medium text-gray-800 dark:text-gray-200 mb-2">
              {currentSession.title}
            </h2>
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              开始发送消息进行对话
            </p>
            <div className="mt-4 flex items-center justify-center gap-2">
              <span className="px-3 py-1 bg-gray-100 dark:bg-gray-800 rounded-full text-xs text-gray-500">
                支持 Markdown 格式
              </span>
              <span className="px-3 py-1 bg-gray-100 dark:bg-gray-800 rounded-full text-xs text-gray-500">
                按 Enter 发送
              </span>
            </div>
          </div>
        </div>
      ) : (
        /* 消息列表 */
        <div className="py-4">
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
        </div>
      )}
    </div>
  );
}

export default ChatArea;
