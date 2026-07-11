import { useMemo, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useChatStore } from "../../stores/chatStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useBackendStore } from "../../stores/backendStore";
import { useAppStore } from "../../stores/appStore";
import { useAutoScroll } from "../../hooks/useAutoScroll";
import { voiceService } from "../../services/voiceService";
import { ErrorBoundary } from "../common/ErrorBoundary";
import ChatMessageList from "./ChatMessageList";
import RoundNavigator from "./RoundNavigator";
import ContextPanel from "./ContextPanel";
import { createLogger } from "@/utils/logger";

const logger = createLogger("components:chatArea");

function ChatArea() {
  const { t } = useTranslation();
  const { messages, error, isStreaming } = useChatStore();
  const sessionFiles = useChatStore((s) => s.sessionFiles);
  const { currentSession, createSession } = useSessionStore();
  const backendRunning = useBackendStore((s) => s.status.running);
  const [panelOpen, setPanelOpen] = useState(false);

  /** 统一滚动状态：isUserScrolledUp 和 scrollToBottom 均由 useAutoScroll 管理 */
  const { containerRef, isUserScrolledUp, scrollToBottom, distanceFromBottom } = useAutoScroll({
    messageCount: messages.length,
    isStreaming,
    sessionId: currentSession?.id,
  });

  const handleDismissError = () => {
    useChatStore.setState({ error: null });
  };

  const handleCreateSession = () => {
    createSession(t('chat.newSession'));
  };

  /** 点击入门提示卡片时发送预设消息 */
  const handleSendMessage = async (text: string) => {
    let sessionId = currentSession?.id;
    if (!sessionId) {
      const newSession = await createSession(t('chat.newSession'));
      sessionId = newSession.id;
    }
    const { streamMessage } = useChatStore.getState();
    await streamMessage(text, sessionId);
  };

  // ---- 自动 TTS 播放 ----
  const voiceSettings = useAppStore((s) => s.voiceSettings);
  const playResponse = useAppStore((s) => s.playResponse);
  const lastPlayedMsgRef = useRef<string | null>(null);

  useEffect(() => {
    // 流式传输结束，且最后一条消息是助手消息 → 自动 TTS
    if (
      !isStreaming &&
      messages.length > 0 &&
      voiceSettings?.config?.autoPlayTTS
    ) {
      const lastMsg = messages[messages.length - 1];
      const content =
        typeof lastMsg.content === "string" ? lastMsg.content : "";
      if (
        lastMsg.role === "assistant" &&
        content.trim() &&
        lastMsg.id !== lastPlayedMsgRef.current
      ) {
        lastPlayedMsgRef.current = lastMsg.id;
        voiceService
          .synthesizeSpeech(content)
          .then((audioUrl) => playResponse(audioUrl))
          .catch((err) =>
            logger.warn("自动 TTS 播放失败:", err),
          );
      }
    }
  }, [messages.length, isStreaming, voiceSettings?.config?.autoPlayTTS, playResponse]);

  const displayError =
    error &&
    !backendRunning &&
    (error.includes("fetch") ||
      error.includes("connect") ||
      error.includes("NetworkError") ||
      error.includes("typo") ||
      error.includes("url or port"))
      ? t('chat.backendNotRunning')
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
    <div className="flex-1 relative bg-gray-50 dark:bg-gray-900 flex">
      {/* 消息区域 */}
      <div className="flex-1 relative min-w-0">
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
                    🔄 {t('common.retry')}
                  </button>
                  <button
                    onClick={() => navigator.clipboard.writeText(displayError)}
                    className="text-xs px-2 py-1 rounded bg-red-100 dark:bg-red-800/50 text-red-600 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-700/50 transition-colors"
                  >
                    📋 {t('chat.copyMessage')}
                  </button>
                </div>
              </div>
              <button
                onClick={handleDismissError}
                className="text-red-400 hover:text-red-600 dark:hover:text-red-200 flex-shrink-0"
                title={t('common.close')}
              >
                ✕
              </button>
            </div>
          )}

          <ErrorBoundary
            fallback={
              <div className="flex items-center justify-center min-h-[400px] p-8">
                <div className="text-center">
                  <p className="text-gray-500 mb-4">{t('chat.messageListLoadError')}</p>
                  <button
                    onClick={() => window.location.reload()}
                    className="px-4 py-2 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                  >
                    {t('chat.refreshPage')}
                  </button>
                </div>
              </div>
            }
          >
            <ChatMessageList
              messages={messages}
              isStreaming={isStreaming}
              sessionUsage={sessionUsage}
              hasSession={!!currentSession}
              sessionTitle={currentSession?.title}
              onCreateSession={handleCreateSession}
              onSendMessage={handleSendMessage}
            />
          </ErrorBoundary>
        </div>

        {/* 回到底部按钮：复用已有样式，检测 isUserScrolledUp 后渐显，移动端避开 MobileBottomNav */}
        {isUserScrolledUp && distanceFromBottom > 200 && (
          <button
            onClick={scrollToBottom}
            aria-label={t('chat.scrollToBottom')}
            role="button"
            className="absolute bottom-16 right-6 z-10 w-10 h-10 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full shadow-lg flex items-center justify-center hover:bg-gray-50 dark:hover:bg-gray-700 transition-all max-md:bottom-20 opacity-80 hover:opacity-100"
            title={t('chat.scrollToBottom')}
          >
            <svg className="w-5 h-5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          </button>
        )}

        {/* 轮次导航器 */}
        <RoundNavigator
          messages={messages}
          isStreaming={isStreaming}
          containerRef={containerRef}
        />
      </div>

      {/* 右侧上下文面板 */}
      <ContextPanel
        isOpen={panelOpen}
        onToggle={() => setPanelOpen(!panelOpen)}
        sessionFiles={sessionFiles}
        sessionUsage={sessionUsage}
      />
    </div>
  );
}

export default ChatArea;
