import { useMemo, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useChatStore } from "../../stores/chat";
import { useSessionStore } from "../../stores/sessionStore";
import { useBackendStore } from "../../stores/backendStore";
import { useVoiceStore } from "../../stores/voiceStore";
import { useConfigStore } from "../../stores/configStore";
import { useModelSwitchStore } from "../../stores/modelSwitchStore";
import { useChatInspectorStore } from "../../stores/chatInspectorStore";
import { useAutoScroll } from "../../hooks/useAutoScroll";
import { useSessionContextSync } from "../../hooks/useSessionContextSync";
import { voiceService } from "../../services/voiceService";
import { ErrorBoundary } from "../common/ErrorBoundary";
import ChatMessageList from "./ChatMessageList";
import RoundNavigator from "./RoundNavigator";
import StatusFloatBar from "./StatusFloatBar";
import ChatInput from "./ChatInput";
import { ContextWatermark } from "../chat/ContextWatermark";
import VoiceSubtitleOverlay from "../VoiceSubtitleOverlay";
import VoiceSessionIndicator from "../VoiceSessionIndicator";
import { createLogger } from "@/utils/logger";
import { useNavigate } from "react-router-dom";

const logger = createLogger("components:chatArea");

function ChatArea({ fluid = false }: { fluid?: boolean }) {
  const { t } = useTranslation();
  const {
    messages,
    error,
    errorCode,
    isStreaming,
    recoverySessionId,
    dismissRecovery,
    resumeRecovery,
  } = useChatStore();
  const { currentSession, createSession } = useSessionStore();
  const backendRunning = useBackendStore((s) => s.status.running);
  const config = useConfigStore((s) => s.config);
  const isDark = config.theme === "dark";

  /** 诊断：会话变化时记录 */
  useEffect(() => {
    if (import.meta.env.DEV)
      console.info("[Diag:chatArea] 会话变更", {
        sessionId: currentSession?.id,
        title: currentSession?.title,
        msgCount: messages.length,
      });
  }, [currentSession?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 上下文面板点击消息摘要 → 滚动到对应消息 */
  const highlightedRoundId = useChatInspectorStore((s) => s.highlightedRoundId);
  const setHighlightedRoundId = useChatInspectorStore(
    (s) => s.setHighlightedRoundId,
  );
  useEffect(() => {
    if (!highlightedRoundId) return;
    // 等待 DOM 渲染完成后再滚动（消息列表可能还未挂载）
    requestAnimationFrame(() => {
      const el = document.querySelector(
        `[data-msg-id="${highlightedRoundId}"]`,
      );
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        // 高亮闪烁效果
        el.classList.add("ring-2", "ring-blue-400", "ring-offset-1");
        setTimeout(() => {
          el.classList.remove("ring-2", "ring-blue-400", "ring-offset-1");
        }, 1500);
      }
      // 重置以允许重复点击同一消息
      setHighlightedRoundId(null);
    });
  }, [highlightedRoundId, setHighlightedRoundId]);
  const { interimText, finalText, audioLevel, subtitleStatus } =
    useVoiceStore();

  /** 模块上下文同步：保存/恢复 ChatSessionContext */
  useSessionContextSync("chat", {
    save: () => ({
      moduleType: "chat" as const,
      modelId: useModelSwitchStore.getState().currentModelId || undefined,
      agentId: undefined,
    }),
    restore: (_ctx) => {
      // model switching is handled by the model switch system
    },
  });

  /** 统一滚动状态：isUserScrolledUp 和 scrollToBottom 均由 useAutoScroll 管理 */
  const {
    containerRef,
    contentRef,
    isUserScrolledUp,
    scrollToBottom,
    distanceFromBottom,
  } = useAutoScroll({
    messageCount: messages.length,
    isStreaming,
    sessionId: currentSession?.id,
  });

  const handleDismissError = () => {
    useChatStore.setState({ error: null });
  };

  const handleCreateSession = () => {
    createSession(t("chat.newSession"));
  };

  /** 点击入门提示卡片时发送预设消息 */
  const handleSendMessage = async (text: string) => {
    let sessionId = currentSession?.id;
    if (!sessionId) {
      const newSession = await createSession(t("chat.newSession"));
      sessionId = newSession.id;
    }
    const { streamMessage } = useChatStore.getState();
    await streamMessage(text, sessionId);
  };

  // ---- 自动 TTS 播放 ----
  const voiceSettings = useVoiceStore((s) => s.settings);
  const playResponse = useVoiceStore((s) => s.playResponse);
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
          .catch((err) => logger.warn("自动 TTS 播放失败:", err));
      }
    }
  }, [
    messages.length,
    isStreaming,
    voiceSettings?.config?.autoPlayTTS,
    playResponse,
  ]);

  // 使用结构化 errorCode 判断后端状态 (CS02)，取代字符串匹配
  const displayError =
    error && !backendRunning && errorCode === "BACKEND_UNREACHABLE"
      ? t("chat.backendNotRunning")
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
      ? {
          inputTokens,
          outputTokens,
          totalTokens,
          estimatedCostUsd,
          cacheReadTokens,
          cacheCreationTokens,
        }
      : undefined;
  }, [messages]);

  // 导航建议：create_project 工具完成后显示跳转提示
  const navigate = useNavigate();
  const [navSuggestion, setNavSuggestion] = useState<{
    target: string;
    label: string;
  } | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as Record<string, unknown>;
      setNavSuggestion({
        target: String(detail.target || "/projects"),
        label: String(detail.label || "查看项目"),
      });
    };
    window.addEventListener("pyapp:navigate-suggest", handler);
    return () => window.removeEventListener("pyapp:navigate-suggest", handler);
  }, []);

  return (
    <div className="flex-1 relative bg-gray-50 dark:bg-gray-900 flex flex-col min-h-0">
      <div ref={containerRef} className="flex-1 min-h-0 overflow-y-auto">
        <div ref={contentRef}>
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
                    🔄 {t("common.retry")}
                  </button>
                  <button
                    onClick={() => navigator.clipboard.writeText(displayError)}
                    className="text-xs px-2 py-1 rounded bg-red-100 dark:bg-red-800/50 text-red-600 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-700/50 transition-colors"
                  >
                    📋 {t("chat.copyMessage")}
                  </button>
                </div>
              </div>
              <button
                onClick={handleDismissError}
                className="text-red-400 hover:text-red-600 dark:hover:text-red-200 flex-shrink-0"
                title={t("common.close")}
              >
                ✕
              </button>
            </div>
          )}

          {/* 导航建议：create_project 完成后提示跳转 */}
          {navSuggestion && (
            <div className="m-4 p-3 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-xl flex items-center justify-between">
              <span className="text-sm text-blue-700 dark:text-blue-300">
                项目已创建 —{" "}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    navigate(navSuggestion.target);
                    setNavSuggestion(null);
                  }}
                  className="text-xs px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                >
                  {navSuggestion.label}
                </button>
                <button
                  onClick={() => setNavSuggestion(null)}
                  className="text-xs text-blue-400 hover:text-blue-600 dark:hover:text-blue-200"
                >
                  忽略
                </button>
              </div>
            </div>
          )}

          {/* P2-6: 中止恢复提示 */}
          {recoverySessionId && (
            <div className="m-4 p-4 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-xl flex items-start gap-3">
              <span className="text-amber-500 dark:text-amber-400 flex-shrink-0 mt-0.5 text-lg">
                ⏸
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-amber-800 dark:text-amber-200 font-medium">
                  {t("chat.abortRecoveryTitle")}
                </p>
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                  {t("chat.abortRecoveryDesc")}
                </p>
                <div className="flex items-center gap-2 mt-3">
                  <button
                    onClick={() => resumeRecovery(recoverySessionId)}
                    className="text-xs px-3 py-1.5 rounded bg-amber-500 text-white hover:bg-amber-600 transition-colors font-medium"
                  >
                    {t("chat.abortRecoveryResume")}
                  </button>
                  <button
                    onClick={dismissRecovery}
                    className="text-xs px-3 py-1.5 rounded bg-amber-100 dark:bg-amber-800/50 text-amber-600 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-700/50 transition-colors"
                  >
                    {t("chat.abortRecoveryDismiss")}
                  </button>
                </div>
              </div>
              <button
                onClick={dismissRecovery}
                className="text-amber-400 hover:text-amber-600 dark:hover:text-amber-200 flex-shrink-0"
                title={t("common.close")}
              >
                ✕
              </button>
            </div>
          )}

          <ErrorBoundary
            fallback={
              <div className="flex items-center justify-center min-h-[400px] p-8">
                <div className="text-center">
                  <p className="text-gray-500 mb-4">
                    {t("chat.messageListLoadError")}
                  </p>
                  <button
                    onClick={() => window.location.reload()}
                    className="px-4 py-2 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                  >
                    {t("chat.refreshPage")}
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
      </div>

      {/* 回到底部按钮：复用已有样式，检测 isUserScrolledUp 后渐显，移动端避开 MobileBottomNav */}
      {isUserScrolledUp && distanceFromBottom > 200 && (
        <button
          onClick={scrollToBottom}
          aria-label={t("chat.scrollToBottom")}
          role="button"
          className="absolute bottom-28 right-6 z-10 w-10 h-10 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full shadow-lg flex items-center justify-center hover:bg-gray-50 dark:hover:bg-gray-700 transition-all max-md:bottom-32 opacity-80 hover:opacity-100"
          title={t("chat.scrollToBottom")}
        >
          <svg
            className="w-5 h-5 text-gray-500 dark:text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 14l-7 7m0 0l-7-7m7 7V3"
            />
          </svg>
        </button>
      )}

      {/* 轮次导航器 */}
      <RoundNavigator
        messages={messages}
        isStreaming={isStreaming}
        containerRef={containerRef}
      />

      {/* 错误提示 */}
      {displayError && (
        <div
          className={`absolute bottom-[140px] left-0 right-0 z-20 pointer-events-none ${fluid ? "px-4" : "flex justify-center"}`}
        >
          <div className={fluid ? "w-full" : "w-full max-w-3xl px-4"}>
            <div className="p-4 bg-red-50 dark:bg-red-900/50 backdrop-blur-xl border border-red-200 dark:border-red-800 rounded-xl flex items-start gap-3 shadow-lg pointer-events-auto">
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
                    🔄 {t("common.retry")}
                  </button>
                  <button
                    onClick={() => navigator.clipboard.writeText(displayError)}
                    className="text-xs px-2 py-1 rounded bg-red-100 dark:bg-red-800/50 text-red-600 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-700/50 transition-colors"
                  >
                    📋 {t("chat.copyMessage")}
                  </button>
                </div>
              </div>
              <button
                onClick={handleDismissError}
                className="text-red-400 hover:text-red-600 dark:hover:text-red-200 flex-shrink-0"
                title={t("common.close")}
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 底部区域：AI 状态栏 + 输入区（flex-col，StatusFloatBar 自然贴着输入区上方） */}
      <div className="shrink-0 flex flex-col bg-gray-50 dark:bg-gray-900">
        <StatusFloatBar fluid={fluid} />

        {/* 语音会话状态指示器（录音/转录/播放） */}
        <div className="flex justify-center">
          <VoiceSessionIndicator isDark={isDark} />
        </div>

        {/* 上下文水位指示器 — 紧凑圆点，居中，hover 展开详情 */}
        <div className="flex justify-center">
          <ContextWatermark />
        </div>

        {/* 语音字幕覆盖层 */}
        <VoiceSubtitleOverlay
          interimText={interimText}
          finalText={finalText}
          audioLevel={audioLevel}
          status={subtitleStatus}
          isDark={isDark}
          position="bottom"
        />

        <ChatInput fluid={fluid} />
      </div>
    </div>
  );
}

export default ChatArea;
