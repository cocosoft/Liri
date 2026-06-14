import { useMemo } from "react";
import { useChatStore } from "../../stores/chatStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useBackendStore } from "../../stores/backendStore";
import { useAutoScroll } from "../../hooks/useAutoScroll";
import ChatMessageList from "./ChatMessageList";
import RoundNavigator from "./RoundNavigator";

function ChatArea() {
  const { messages, error, isStreaming } = useChatStore();
  const { currentSession } = useSessionStore();
  const backendRunning = useBackendStore((s) => s.status.running);

  const { containerRef } = useAutoScroll({
    messageCount: messages.length,
    isStreaming,
  });

  const handleDismissError = () => {
    useChatStore.setState({ error: null });
  };

  const displayError =
    error &&
    !backendRunning &&
    (error.includes("fetch") ||
      error.includes("connect") ||
      error.includes("NetworkError"))
      ? '后端服务未运行。请点击左侧侧边栏底部的 "未连接" 按钮查看启动说明。'
      : error;

  // 缓存 sessionUsage 计算，仅 messages 变化时重算 O(n)
  const sessionUsage = useMemo(() => {
    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;
    let estimatedCostUsd = 0;
    let cacheReadTokens = 0;
    let cacheCreationTokens = 0;
    for (const m of messages) {
      if (m.usage) {
        inputTokens += m.usage.inputTokens || 0;
        outputTokens += m.usage.outputTokens || 0;
        totalTokens += m.usage.totalTokens || 0;
        estimatedCostUsd += m.usage.estimatedCostUsd || 0;
        cacheReadTokens += m.usage.cacheReadTokens || 0;
        cacheCreationTokens += m.usage.cacheCreationTokens || 0;
      }
    }
    return totalTokens > 0
      ? { inputTokens, outputTokens, totalTokens, estimatedCostUsd, cacheReadTokens, cacheCreationTokens }
      : undefined;
  }, [messages]);

  return (
    <div className="flex-1 relative bg-gray-50 dark:bg-gray-900">
      <div
        ref={containerRef}
        className="absolute inset-0 overflow-y-auto"
      >
        {/* 错误提示 */}
        {displayError && (
          <div className="m-4 p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-xl flex items-start gap-3">
            <span className="text-red-500 dark:text-red-400 flex-shrink-0 mt-0.5">
              ⚠
            </span>
            <div className="flex-1 min-w-0">
              <span className="text-sm text-red-700 dark:text-red-300 block">
                {displayError}
              </span>
              <div className="flex items-center gap-2 mt-2">
                <button
                  onClick={() => useBackendStore.getState().checkStatus()}
                  className="text-xs px-2 py-1 rounded bg-red-100 dark:bg-red-800/50 text-red-600 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-700/50 transition-colors"
                >
                  🔄 重试连接
                </button>
                <button
                  onClick={() => navigator.clipboard.writeText(displayError)}
                  className="text-xs px-2 py-1 rounded bg-red-100 dark:bg-red-800/50 text-red-600 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-700/50 transition-colors"
                >
                  📋 复制错误
                </button>
              </div>
            </div>
            <button
              onClick={handleDismissError}
              className="text-red-400 hover:text-red-600 dark:hover:text-red-200 flex-shrink-0"
              title="关闭"
            >
              ✕
            </button>
          </div>
        )}

        <ChatMessageList
          messages={messages}
          isStreaming={isStreaming}
          sessionUsage={sessionUsage}
          hasSession={!!currentSession}
          sessionTitle={currentSession?.title}
        />
      </div>

      {/* 轮次导航器 */}
      <RoundNavigator
        messages={messages}
        isStreaming={isStreaming}
        containerRef={containerRef}
      />
    </div>
  );
}

export default ChatArea;