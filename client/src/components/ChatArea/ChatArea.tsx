import { useMemo, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useChatStore } from "../../stores/chat";
import { useSessionStore } from "../../stores/sessionStore";
import { useBackendStore } from "../../stores/backendStore";
import { useVoiceStore } from "../../stores/voiceStore";
import { useConfigStore } from "../../stores/configStore";
import { useModelSwitchStore } from "../../stores/modelSwitchStore";
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
import { friendlyErrorSummary } from "@/utils/friendlyError";
import { useNavigate } from "react-router-dom";

const logger = createLogger("components:chatArea");

function ChatArea({ fluid = false }: { fluid?: boolean }) {
  const { t } = useTranslation();
  // P0-5 修复：精准 selector 订阅，避免流式 chunk / voice audioLevel 变化导致整树重渲染
  const messages = useChatStore((s) => s.messages);
  const error = useChatStore((s) => s.error);
  const errorCode = useChatStore((s) => s.errorCode);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const recoverySessionId = useChatStore((s) => s.recoverySessionId);
  const dismissRecovery = useChatStore((s) => s.dismissRecovery);
  const resumeRecovery = useChatStore((s) => s.resumeRecovery);
  // 阶段2 断连挂起-恢复
  const pausedStreams = useChatStore((s) => s.pausedStreams);
  const resumeStream = useChatStore((s) => s.resumeStream);
  const abortPausedStream = useChatStore((s) => s.abortPausedStream);
  const currentSession = useSessionStore((s) => s.currentSession);
  const createSession = useSessionStore((s) => s.createSession);
  const backendRunning = useBackendStore((s) => s.status.running);
  const config = useConfigStore((s) => s.config);
  const isDark = config.theme === "dark";
  // 阶段2：当前会话若存在挂起流则显示断连 Banner
  const currentSid = currentSession?.id;
  const pausedInfo = currentSid ? pausedStreams[currentSid] : undefined;

  /** 诊断：会话变化时记录 */
  useEffect(() => {
    if (import.meta.env.DEV)
      console.info("[Diag:chatArea] 会话变更", {
        sessionId: currentSession?.id,
        title: currentSession?.title,
        msgCount: messages.length,
      });
  }, [currentSession?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /** P0-5 日志：isStreaming 状态变化边界（每个流式开始/结束记录一次，用于排查重渲染频率异常） */
  const prevIsStreamingRef = useRef(isStreaming);
  useEffect(() => {
    if (prevIsStreamingRef.current !== isStreaming) {
      prevIsStreamingRef.current = isStreaming;
      logger.debug("[P0-5:ChatArea] isStreaming 切换", {
        isStreaming,
        msgCount: messages.length,
        sessionId: currentSession?.id,
        at: new Date().toISOString(),
      });
    }
  }, [isStreaming, messages.length, currentSession?.id]);

  /** P0-5 日志：error / errorCode 变化边界（错误状态切换记录） */
  const prevErrorRef = useRef(error);
  useEffect(() => {
    if (prevErrorRef.current !== error) {
      const prevErr = prevErrorRef.current;
      prevErrorRef.current = error;
      logger.debug("[P0-5:ChatArea] error 状态切换", {
        hadError: !!prevErr,
        hasError: !!error,
        errorCode,
        sessionId: currentSession?.id,
      });
    }
  }, [error, errorCode, currentSession?.id]);

  /**
   * 上下文面板点击消息摘要 → 滚动到对应消息
   * P1-1 修复：已下沉到 ChatMessageList（虚拟列表内用 virtualizer.scrollToIndex，
   * 替代 DOM 查询——离屏消息不在 DOM 中会静默失效）。
   */

  // P0-5 修复：voice store 改精准 selector，audioLevel 30fps 更新不再触发整树重渲染
  const interimText = useVoiceStore((s) => s.interimText);
  const finalText = useVoiceStore((s) => s.finalText);
  const audioLevel = useVoiceStore((s) => s.audioLevel);
  const subtitleStatus = useVoiceStore((s) => s.subtitleStatus);

  /** 模块上下文同步：保存/恢复 ChatSessionContext */
  const { scheduleSave } = useSessionContextSync("chat", {
    save: () => ({
      moduleType: "chat" as const,
      modelId: useModelSwitchStore.getState().currentModelId || undefined,
      agentId: undefined,
    }),
    restore: (_ctx) => {
      // model switching is handled by the model switch system
    },
  });

  /** P0-3：modelId 变更时触发保存（Chat 模块的 context 主要是 modelId） */
  const currentModelId = useModelSwitchStore((s) => s.currentModelId);
  const prevModelIdRef = useRef(currentModelId);
  useEffect(() => {
    if (prevModelIdRef.current !== currentModelId) {
      prevModelIdRef.current = currentModelId;
      logger.debug("[P0-3:ChatArea] modelId 变更，触发 scheduleSave", {
        modelId: currentModelId,
        sessionId: currentSession?.id,
      });
      scheduleSave();
    }
  }, [currentModelId, scheduleSave, currentSession?.id]);

  /** 统一滚动状态：isUserScrolledUp 和 scrollToBottom 均由 useAutoScroll 管理 */
  const {
    containerRef,
    contentRef,
    isUserScrolledUp,
    scrollToBottom,
    showScrollButton,
  } = useAutoScroll({
    messageCount: messages.length,
    isStreaming,
    sessionId: currentSession?.id,
  });

  const handleDismissError = () => {
    // 补清 errorCode：仅清 error 会残留错误码，导致 displayError 后续误判后端状态
    useChatStore.setState({ error: null, errorCode: null });
  };

  /**
   * 错误面板重试（2026-08-16 修复）：原实现仅 checkStatus()（探测后端状态），
   * 既不重新发送失败的消息、也不清除 chat store 的 error/errorCode——
   * 后端恢复后面板仍显示错误文本，点击"重试"看似无效。
   * 现改为：探测后端 → 清除聊天错误 → 后端可达时用 retryFromError 重发
   * 最后一条失败的 assistant 消息（内部找前置 user 消息重新发送并截断失败残留）。
   */
  const handleRetryError = async () => {
    await useBackendStore.getState().checkStatus();
    const running = useBackendStore.getState().status.running;
    // 先清掉当前错误显示（无论后端是否恢复）
    useChatStore.setState({ error: null, errorCode: null });
    if (!running) {
      logger.warn("handleRetryError: 后端仍不可达，仅清除错误提示，未重发消息");
      return;
    }
    const { messages } = useChatStore.getState();
    const lastAssistant = [...messages]
      .reverse()
      .find((m) => m.role === "assistant");
    if (!lastAssistant) {
      // 边界：无 assistant 消息（纯后端不可达提示/消息已被清空），无失败消息可重发
      logger.debug("handleRetryError: 无 assistant 消息可重发，仅清除错误", {
        messageCount: messages.length,
      });
      return;
    }
    logger.info("handleRetryError: 后端已恢复，准备重发失败消息", {
      assistantMsgId: lastAssistant.id,
      sessionId: lastAssistant.session_id,
      messageCount: messages.length,
    });
    try {
      await useChatStore
        .getState()
        .retryFromError(lastAssistant.id, lastAssistant.session_id);
      logger.info("handleRetryError: 重发失败消息已触发", {
        assistantMsgId: lastAssistant.id,
      });
    } catch (e) {
      logger.warn("handleRetryError: 重发失败消息异常", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };

  /**
   * 错误面板继续（2026-08-29）：异常后基于已落盘上下文续写——
   * ① 先 flush 待保存 blocks（写前持久化：异常时上下文落盘，确保继续基于完整状态）
   * ② 再以最后 assistant 消息（含已生成的部分内容）为引用发送"请继续"，
   *    后端基于整轮上下文接着输出（区别于"重试"从头重新生成）。
   */
  const handleContinueError = async () => {
    // ① 异常时上下文落盘（flushPendingSaves 内置 3s 超时保护）
    try {
      await useChatStore.getState().flushPendingSaves();
      logger.debug("handleContinueError: 上下文已落盘");
    } catch (e) {
      logger.warn("handleContinueError: flushPendingSaves 失败", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
    // ② 清除错误显示（无论是否可继续）
    useChatStore.setState({ error: null, errorCode: null });
    // ③ 找最后 assistant 消息（含已生成的部分内容）继续生成
    const { messages } = useChatStore.getState();
    const lastAssistant = [...messages]
      .reverse()
      .find((m) => m.role === "assistant");
    if (!lastAssistant) {
      // 边界：无已生成内容（纯后端不可达提示），无从继续，提示用户用重试
      logger.warn("handleContinueError: 无 assistant 消息可继续，仅清除错误", {
        messageCount: messages.length,
      });
      return;
    }
    logger.info("handleContinueError: 基于已落盘上下文继续生成", {
      assistantMsgId: lastAssistant.id,
      sessionId: lastAssistant.session_id,
      messageCount: messages.length,
    });
    try {
      await useChatStore
        .getState()
        .continueGeneration(lastAssistant.id, lastAssistant.session_id);
      logger.info("handleContinueError: 继续生成已触发", {
        assistantMsgId: lastAssistant.id,
      });
    } catch (e) {
      logger.warn("handleContinueError: 继续生成异常", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const handleCreateSession = () => {
    // W1 修复：失败已在 createChatSession 内 toast + 记录，这里仅防 unhandledRejection
    createSession(t("chat.newSession")).catch(() => {});
  };

  /** 点击入门提示卡片时发送预设消息 */
  const handleSendMessage = async (text: string) => {
    let sessionId = currentSession?.id;
    if (!sessionId) {
      const newSession = await createSession(t("chat.newSession"));
      sessionId = newSession.id;
    }
    if (!sessionId) return;
    // F9 修复（2026-08-24）：对齐 handleSubmit 守卫——挂起流拦截、流式中入队，
    // 避免绕过守卫直接 streamMessage 触发 F2（同会话双流 controller 竞态）
    const chatStore = useChatStore.getState();
    if (chatStore.pausedStreams[sessionId]) return;
    if (chatStore.isStreaming) {
      chatStore.enqueueMessage(text, sessionId);
      return;
    }
    await chatStore.streamMessage(text, sessionId);
  };

  // ---- 自动 TTS 播放 ----
  const voiceSettings = useVoiceStore((s) => s.settings);
  const playResponse = useVoiceStore((s) => s.playResponse);
  const lastPlayedMsgRef = useRef<string | null>(null);

  // #13 修复：切会话时重置已播放标记，避免新会话最后一条助手消息被跳过不朗读
  useEffect(() => {
    lastPlayedMsgRef.current = null;
  }, [currentSession?.id]);

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
    // #13 修复：依赖补 messages——原只依赖 messages.length，消息被整体替换
    // （长度不变）时不触发自动朗读；lastPlayedMsgRef 按消息 id 防重，不会重复播
  }, [messages, isStreaming, voiceSettings?.config?.autoPlayTTS, playResponse]);

  // 使用结构化 errorCode 判断后端状态 (CS02)，取代字符串匹配
  const displayError =
    error && !backendRunning && errorCode === "BACKEND_UNREACHABLE"
      ? t("chat.backendNotRunning")
      : error;
  // 友好化（2026-08-26）：主文案用小白可读的映射（friendlyError），
  // 原始技术信息（含 Provider/端点/证书详情）折叠展示，专业用户可展开查看。
  // 后端未启动分支（i18n 文案已友好）不再二次映射。
  const errorSummary =
    displayError && displayError !== error
      ? displayError
      : displayError
        ? friendlyErrorSummary(displayError)
        : null;
  const errorDetail = error;

  // P2-2 修复：流式期间跳过 sessionUsage 计算（O(n) → O(1)），流式结束后一次性计算
  type SessionUsage =
    | {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        estimatedCostUsd: number;
        cacheReadTokens: number;
        cacheCreationTokens: number;
      }
    | undefined;
  const sessionUsageRef = useRef<SessionUsage>(undefined);
  const sessionUsage = useMemo((): SessionUsage => {
    // 流式中复用上次结果，避免每 chunk O(n) 重算
    if (isStreaming && sessionUsageRef.current) {
      return sessionUsageRef.current;
    }
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
    const result: SessionUsage =
      totalTokens > 0
        ? {
            inputTokens,
            outputTokens,
            totalTokens,
            estimatedCostUsd,
            cacheReadTokens,
            cacheCreationTokens,
          }
        : undefined;
    // 流式结束后缓存结果供下次流式期间复用
    if (!isStreaming) {
      sessionUsageRef.current = result;
    }
    return result;
  }, [messages, isStreaming]);

  // 自适应导航（P0-F，2026-08-14）：AI 明确调用 create_project 建项目后，
  // 前端自动切换到项目管理页面并打开新项目，无需用户手动点击提示
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as Record<string, unknown>;
      const target = String(detail.target || "/projects");
      // 跳转时机日志（保留）：记录收到导航建议事件 → 跳转的完整上下文，便于排查
      // create_project 后前端未/重复/错误跳转的问题
      logger.info("自适应导航：create_project 完成，自动跳转项目管理页", {
        target,
        label: String(detail.label || "查看项目"),
        eventAt: new Date().toISOString(),
        location: window.location.pathname + window.location.search,
      });
      // 流式仍在继续（后续 LLM 轮），跳转后 chunk 由 store 层继续处理，消息照常落盘
      navigate(target);
    };
    window.addEventListener("pyapp:navigate-suggest", handler);
    return () => window.removeEventListener("pyapp:navigate-suggest", handler);
  }, [navigate]);

  return (
    <div className="flex-1 relative bg-gray-50 dark:bg-gray-900 flex flex-col min-h-0">
      <div ref={containerRef} className="flex-1 min-h-0 overflow-y-auto">
        <div ref={contentRef}>
          {/* 错误提示（1.10-4：删除文档流重复渲染，保留底部绝对定位浮层版本，始终可见） */}

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

          {/* 阶段2: 断连挂起提示 */}
          {currentSid && pausedInfo && (
            <div className="m-4 p-4 bg-sky-50 dark:bg-sky-900/30 border border-sky-200 dark:border-sky-800 rounded-xl flex items-start gap-3">
              <span className="text-sky-500 dark:text-sky-400 flex-shrink-0 mt-0.5 text-lg">
                📡
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-sky-800 dark:text-sky-200 font-medium">
                  {pausedInfo.phase === "recovering"
                    ? t("chat.pausedStreamRecovering")
                    : t("chat.pausedStreamTitle")}
                </p>
                <p className="text-xs text-sky-600 dark:text-sky-400 mt-1">
                  {t("chat.pausedStreamDesc")}
                </p>
                <div className="flex items-center gap-2 mt-3">
                  <button
                    onClick={() => resumeStream(currentSid)}
                    className="text-xs px-3 py-1.5 rounded bg-sky-500 text-white hover:bg-sky-600 transition-colors font-medium"
                  >
                    {t("chat.pausedStreamResume")}
                  </button>
                  <button
                    onClick={() => abortPausedStream(currentSid)}
                    className="text-xs px-3 py-1.5 rounded bg-sky-100 dark:bg-sky-800/50 text-sky-600 dark:text-sky-300 hover:bg-sky-200 dark:hover:bg-sky-700/50 transition-colors"
                  >
                    {t("chat.pausedStreamAbandon")}
                  </button>
                </div>
              </div>
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
              // P0-2：渲染层一致性校验用（消息区与侧栏高亮对齐）
              currentSessionId={currentSession?.id}
              // W3：虚拟滚动需要滚动容器引用（滚动容器在 ChatArea，overflow-y-auto）
              scrollRef={containerRef}
              onCreateSession={handleCreateSession}
              onSendMessage={handleSendMessage}
            />
          </ErrorBoundary>
        </div>
      </div>

      {/* 回到底部按钮：复用已有样式，检测 isUserScrolledUp 后渐显，移动端避开 MobileBottomNav */}
      {isUserScrolledUp && showScrollButton && (
        <button
          onClick={() => scrollToBottom()}
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
      {errorSummary && (
        <div
          className={`absolute bottom-[140px] left-0 right-0 z-20 pointer-events-none ${fluid ? "px-4" : "flex justify-center"}`}
        >
          <div className={fluid ? "w-full" : "w-full max-w-3xl px-4"}>
            <div className="p-4 bg-red-50 dark:bg-red-900/50 backdrop-blur-xl border border-red-200 dark:border-red-800 rounded-xl flex items-start gap-3 shadow-lg pointer-events-auto">
              <span className="text-red-500 dark:text-red-400 flex-shrink-0 mt-0.5">
                ⚠
              </span>
              <div className="flex-1 min-w-0">
                <span className="text-sm text-red-700 dark:text-red-300 block whitespace-pre-line">
                  {errorSummary}
                </span>
                {/* 技术详情（2026-08-26）：折叠展示原始错误，专业用户可展开 */}
                {errorDetail && errorDetail !== errorSummary && (
                  <details className="mt-1.5">
                    <summary className="text-xs text-red-400 dark:text-red-400/80 cursor-pointer hover:text-red-500 select-none">
                      查看技术详情
                    </summary>
                    <pre className="mt-1.5 text-[11px] text-red-500/90 dark:text-red-400/70 whitespace-pre-wrap break-all max-h-40 overflow-y-auto bg-red-100/40 dark:bg-red-900/30 rounded p-2">
                      {errorDetail}
                    </pre>
                  </details>
                )}
                <div className="flex items-center gap-2 mt-2">
                  <button
                    onClick={() => void handleRetryError()}
                    className="text-xs px-2 py-1 rounded bg-red-100 dark:bg-red-800/50 text-red-600 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-700/50 transition-colors"
                  >
                    🔄 {t("common.retry")}
                  </button>
                  <button
                    onClick={() => void handleContinueError()}
                    className="text-xs px-2 py-1 rounded bg-red-100 dark:bg-red-800/50 text-red-600 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-700/50 transition-colors"
                  >
                    ▶ {t("chat.continueGenerate")}
                  </button>
                  <button
                    onClick={() =>
                      navigator.clipboard.writeText(
                        errorDetail ?? errorSummary ?? "",
                      )
                    }
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
