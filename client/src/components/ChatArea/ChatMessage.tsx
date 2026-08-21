import React, { memo, useState, Suspense, useMemo } from "react";
import { handleClientError } from "../../utils/handleError";
import { createLogger } from "@/utils/logger";

const logger = createLogger("components:chatMessage");
import { useTranslation } from "react-i18next";
import type { Message, MessageBlock } from "../../types";
import ToolExecutionGroup from "./ToolExecutionGroup";
import ToolInlineTags from "./ToolInlineTags";
import WatermarkTag from "./WatermarkTag";
import ToolResultMessage from "./ToolResultMessage";
import BlockRenderer from "./BlockRenderer";
import { knowledgeService } from "../../services/knowledgeService";
import { useConfigStore } from "../../stores/configStore";
import { useChatStore, hasMeaningfulContentBlocks } from "../../stores/chat";
import { useShallow } from "zustand/shallow";
import { useSessionStore } from "../../stores/sessionStore";
import { useRootStore } from "../../stores/root-store";
import { saveArtifact } from "../../services/projectArtifactService";
import { exportMessageAsFormat } from "../../utils/exportMessage";

const SaveKnowledgeModal = React.lazy(() => import("./SaveKnowledgeModal"));

interface ChatMessageProps {
  message: Message;
  isStreaming?: boolean;
  hasReplies?: boolean;
  sessionUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd?: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
  };
  onReply?: (message: Message) => void;
}

/** R-L 修复：字符求和哈希（用于头像颜色等按字符串取色的场景），替代 id.length 哈希 */
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

/**
 * 从消息的 blocks 中提取完整文本内容（用于复制等操作）
 * 包含 text 块、thinking 块、tool_call 结果等所有可见文本
 */
function getFullContent(
  message: Message,
  labels: {
    thoughtProcess: string;
    toolCall: string;
    parameters: string;
    result: string;
  },
): string {
  const parts: string[] = [];

  if (message.content) {
    parts.push(message.content);
  }

  if (message.blocks && message.blocks.length > 0) {
    // 相邻 thinking 块先合并再 push（防御性：即使 blocks 有多个相邻 thinking——
    // 比如旧流式版本、回放迁移数据等——也只渲染一条 💭 [思考中]，避免重复标签和逐词换行）
    let thinkingBuffer: string[] = [];
    const flushThinking = (): void => {
      if (thinkingBuffer.length === 0) return;
      const merged = thinkingBuffer.join("");
      thinkingBuffer = [];
      if (!merged.trim()) return;
      parts.push(
        `> 💭 ${labels.thoughtProcess}\n> ${merged.replace(/\n/g, "\n> ")}`,
      );
    };
    // 相邻 text 块也合并（流式 text 是逐 token delta，绝不允许逐 token 分段换行）
    let textBuffer: string[] = [];
    const flushText = (): void => {
      if (textBuffer.length === 0) return;
      const merged = textBuffer.join("");
      textBuffer = [];
      if (!merged) return;
      // 去重：message.content 已包含完整正文时跳过（避免重复渲染）
      if (message.content && message.content.includes(merged)) return;
      parts.push(merged);
    };
    for (const block of message.blocks) {
      if (block.type === "text" && block.content) {
        flushThinking();
        textBuffer.push(block.content);
      } else if (block.type === "thinking" && block.content) {
        flushText();
        // thinking 块合并 + stripStructuralTags（去除 <response>/<think> 等结构标签碎片）
        thinkingBuffer.push(block.content);
      } else if (block.type === "tool_call" && block.toolCall) {
        flushText();
        flushThinking();
        const tc = block.toolCall;
        const argsStr = tc.arguments
          ? JSON.stringify(tc.arguments, null, 2)
          : "";
        const resultStr = tc.result
          ? typeof tc.result === "string"
            ? tc.result
            : JSON.stringify(tc.result, null, 2)
          : "";
        if (argsStr || resultStr) {
          const lines = [`**${labels.toolCall}${tc.name}**`];
          if (argsStr)
            lines.push(`${labels.parameters}\n\`\`\`json\n${argsStr}\n\`\`\``);
          // B-A2 修复：复制纯文本时工具结果不再截断（原 .slice(0,500) 导致复制内容不完整）
          if (resultStr) lines.push(`${labels.result}\n${resultStr}`);
          parts.push(lines.join("\n\n"));
        }
      }
    }
    flushText();
    flushThinking();
  }

  return parts.join("\n\n").trim();
}

/**
 * 提取消息正文（仅 content + text 块，不含 thinking/tool_call）
 * 用于 HTML/Word 导出——思考过程与工具调用不进文档，只导出最终正文
 */
function getBodyContent(message: Message): string {
  const parts: string[] = [];

  if (message.content) {
    parts.push(message.content);
  }

  if (message.blocks && message.blocks.length > 0) {
    for (const block of message.blocks) {
      if (block.type === "text" && block.content) {
        if (!message.content || !message.content.includes(block.content)) {
          parts.push(block.content);
        }
      }
    }
  }

  return parts.join("\n\n").trim();
}

/**
 * ChatMessage 的 memo 比较器：仅在消息实际内容变化时重渲染
 * 避免流式传输中无关消息（已完成的历史消息）被频繁刷新
 */
const ChatMessageMemo = memo(
  function ChatMessage({
    message,
    isStreaming,
    hasReplies,
    sessionUsage,
  }: ChatMessageProps) {
    const { t } = useTranslation();
    const setEditTarget = useChatStore((s) => s.setEditTarget);
    const regenerateMessage = useChatStore((s) => s.regenerateMessage);
    const retryFromError = useChatStore((s) => s.retryFromError);
    const continueGeneration = useChatStore((s) => s.continueGeneration);
    const deleteMessage = useChatStore((s) => s.deleteMessage);
    const rollbackToMessage = useChatStore((s) => s.rollbackToMessage);
    const restoreRollback = useChatStore((s) => s.restoreRollback);
    const storeIsStreaming = useChatStore((s) => s.isStreaming);
    const messages = useChatStore((s) => s.messages);
    const currentSession = useSessionStore((s) => s.currentSession);
    const remainingRollbacks =
      5 - ((currentSession?.metadata?.rollbackCount as number) ?? 0);
    const createSession = useSessionStore((s) => s.createSession);
    const switchSession = useSessionStore((s) => s.switchSession);
    const projectId = useRootStore((s) => s.moduleContext.projectId);
    const [showSaveModal, setShowSaveModal] = useState(false);
    const [branching, setBranching] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [confirmAction, setConfirmAction] = useState<
      "delete" | "rollback" | null
    >(null);
    const [copyToast, setCopyToast] = useState<"copied" | "failed" | null>(
      null,
    );
    const [captureToast, setCaptureToast] = useState(false);
    const [showUndo, setShowUndo] = useState(false);
    const [undoWarning, setUndoWarning] = useState<string | null>(null);
    /** 移动端长按/右键菜单 */
    const [contextMenu, setContextMenu] = useState<{
      x: number;
      y: number;
    } | null>(null);
    const configTheme = useConfigStore((s) => s.config.theme);
    const isDark = configTheme === "dark";
    const isUser = message.role === "user";
    const isTool = message.role === "tool";

    /** 查找被回复的原始消息 */
    const replyTarget = useMemo(() => {
      if (!message.replyToId) return null;
      return messages.find((m) => m.id === message.replyToId) || null;
    }, [message.replyToId, messages]);

    const formatTime = (timestamp: number) => {
      const date = new Date(timestamp);
      return date.toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
      });
    };

    const formatCost = (costUsd?: number) => {
      if (!costUsd) return null;
      if (costUsd < 0.01) {
        return `${(costUsd * 100).toFixed(2)} ¢`;
      }
      return `$${costUsd.toFixed(4)}`;
    };

    /**
     * 复制消息内容
     * @param asMarkdown true=复制 Markdown 源码；false/Shift+Click=复制纯文本
     */
    const handleCopy = async (asMarkdown: boolean = true) => {
      try {
        const textToCopy = asMarkdown
          ? typeof message.content === "string"
            ? message.content
            : ""
          : getFullContent(message, {
              thoughtProcess: t("chat.thoughtProcess"),
              toolCall: t("chat.toolCall"),
              parameters: t("chat.parameters"),
              result: t("chat.result"),
            });
        // B-A1 修复：内容为空时提示失败而非"已复制"（AI 仅输出 thinking/工具调用时 content 为空）
        if (!textToCopy.trim()) {
          setCopyToast("failed");
          setTimeout(() => setCopyToast(null), 2000);
          return;
        }
        await navigator.clipboard.writeText(textToCopy);
        setCopyToast("copied");
        setTimeout(() => setCopyToast(null), 2000);
      } catch (e) {
        handleClientError(e, {
          module: "components:chat:ChatMessage",
          action: "handleCopy",
        });
        setCopyToast("failed");
        setTimeout(() => setCopyToast(null), 2000);
      }
    };

    /**
     * 导出 AI 回复（md / html / word）
     * - md：完整内容（getFullContent，含 thinking/tool_call 文本）
     * - html/word：仅正文（getBodyContent，排除思考/工具调用），由工具层渲染成
     *   带 markdown 样式的 HTML / Word 文档（标题/粗体/代码块/表格等）
     */
    const handleExport = (format: "md" | "html" | "word") => {
      const content =
        format === "md"
          ? getFullContent(message, {
              thoughtProcess: t("chat.thoughtProcess"),
              toolCall: t("chat.toolCall"),
              parameters: t("chat.parameters"),
              result: t("chat.result"),
            })
          : getBodyContent(message);
      if (!content.trim()) {
        setCopyToast("failed");
        setTimeout(() => setCopyToast(null), 2000);
        return;
      }
      exportMessageAsFormat(content, format);
    };

    const handleRegenerate = () => {
      // #2 修复：传点击的 assistant 消息 id，重新生成该条而非永远最后一条
      regenerateMessage(message.id, message.session_id);
    };

    const handleRetry = () => {
      // 找到此 AI 消息前面的用户消息
      retryFromError(message.id, message.session_id);
    };

    // B-C1 修复：真「继续生成」——以该 AI 消息为引用，自动发送"请继续"触发新一轮生成
    const handleContinue = () => {
      if (storeIsStreaming) return;
      continueGeneration(
        message.id,
        message.session_id,
        t("chat.continuePrompt"),
      );
    };

    /** 沉淀为成果：手动将 AI 回复保存到项目成果区 */
    const handleCaptureAsDeliverable = async () => {
      if (!projectId) return;
      // R8 修复：content 可能为复杂对象（非 string），先归一化再 slice，
      // 原实现非 string content 时 TypeError 被外层 catch 静默吞掉，功能失效无提示
      const content =
        typeof message.content === "string" ? message.content : "";
      if (!content) return;
      try {
        await saveArtifact({
          projectId,
          kind: "output",
          title: content.slice(0, 80) || "未命名成果",
          content,
          sessionId: message.session_id,
        });
        setCaptureToast(true);
        setTimeout(() => setCaptureToast(false), 2000);
      } catch {
        /* 沉淀失败静默处理 */
      }
    };

    /** 创建分支：从当前消息处创建新会话并切换过去 */
    const handleBranch = async () => {
      if (branching) return;
      setBranching(true);
      try {
        const branchTitle = currentSession
          ? `${t("chat.branchPrefix")}${currentSession.title}`
          : t("chat.newBranchSession");
        const session = await createSession(branchTitle);
        await switchSession(session.id);
      } catch (err) {
        handleClientError(err, {
          module: "components:chat:ChatMessage",
          action: "handleBranch",
        });
        logger.error("创建分支失败", err);
      } finally {
        setBranching(false);
      }
    };

    /** 确认删除 */
    const handleConfirmDelete = async () => {
      setConfirmAction(null);
      try {
        await deleteMessage(message.id);
      } catch {
        // 错误已在 store 中 toast
      }
    };

    /** 确认回退 */
    const handleConfirmRollback = async () => {
      setConfirmAction(null);
      try {
        const result = await rollbackToMessage(message.id);
        if (result.remainingRollbacks >= 0) {
          setShowUndo(true);
          setTimeout(() => setShowUndo(false), 3000);
          // 检查是否有文件回滚失败
          const failedUndos = result.undoResults?.filter((r) => !r.success);
          if (failedUndos && failedUndos.length > 0) {
            setUndoWarning(
              t("chat.rollbackUndoFailed", { count: failedUndos.length }),
            );
            setTimeout(() => setUndoWarning(null), 8000);
          }
        }
      } catch {
        // 错误已在 store 中 toast
      }
    };

    /** 撤销回退 */
    const handleUndoRollback = () => {
      restoreRollback();
      setShowUndo(false);
    };

    const handleSaveToKnowledge = async (title: string, base: string) => {
      const content =
        typeof message.content === "string" ? message.content : "";
      // B-D2 修复：内容为空时直接抛错提示（避免后端 400 + 弹窗误导）
      if (!content.trim()) {
        throw new Error(t("chat.saveEmptyContent"));
      }
      // B-D3 修复：补传 sessionId，后端 frontmatter 写入 savedFrom 溯源
      await knowledgeService.saveFromChat({
        base,
        title,
        content,
        sessionId: message.session_id,
      });
    };

    const openSaveModal = () => {
      setShowSaveModal(true);
    };

    /** 移动端长按 / 右键菜单 */
    const handleContextMenu = (e: React.MouseEvent) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY });
    };

    /** 关闭菜单 */
    const closeContextMenu = () => setContextMenu(null);

    return (
      <div
        className={`flex w-full items-start gap-3 px-3 py-2 ${isUser ? "justify-end" : "justify-start"}`}
        onContextMenu={handleContextMenu}
      >
        {/* AI 头像（左侧，38px） */}
        {!isUser && !isTool && (
          <div className="flex-shrink-0" aria-hidden="true">
            <img
              src="/liri_logo.png"
              alt="Liri"
              className="w-9 h-9 rounded-full object-contain"
              onError={(e) => {
                // 头像加载失败：用首字母 fallback（L）
                const el = e.target as HTMLImageElement;
                el.style.display = "none";
                const fallback = document.createElement("div");
                fallback.className =
                  "w-9 h-9 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm font-bold";
                fallback.textContent = "L";
                el.parentElement!.appendChild(fallback);
              }}
            />
          </div>
        )}

        {/* 消息气泡 */}
        <div className="flex-1 min-w-0 max-w-[70%]">
          {/* 头部：AI 才显示 agent 标签和被回复标记 */}
          {!isUser && (message.agentName || hasReplies) && (
            <div className="flex items-center gap-2 mb-1">
              {/* Agent 名称标签 */}
              {message.agentName && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400 font-medium">
                  {message.agentName}
                </span>
              )}
              {/* 被回复标记 */}
              {hasReplies && (
                <span className="text-[10px] text-blue-500 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-1.5 py-0.5 rounded-full">
                  {t("chat.hasReplies")}
                </span>
              )}
            </div>
          )}

          {/* 气泡主体 */}
          <div
            className={`px-4 py-2.5 ${
              isUser
                ? "bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm rounded-2xl rounded-br-md"
                : isTool
                  ? "bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-2xl rounded-bl-md"
            }`}
          >
            {/* 被回复的引用 */}
            {replyTarget && (
              <div
                className={`mb-2 p-2 rounded-lg text-xs border-l-2 cursor-pointer ${
                  isUser
                    ? "bg-white/50 dark:bg-gray-600/50 border-gray-300 dark:border-gray-500 text-gray-600 dark:text-gray-300"
                    : "bg-gray-50 dark:bg-gray-700/50 border-gray-300 dark:border-gray-500 text-gray-500 dark:text-gray-400"
                }`}
                onClick={() => {
                  // N2 同模式修复：不把 id 拼进选择器（含特殊字符时 DOM 异常/注入风险），
                  // 静态选择器 + 属性值比对
                  const el = Array.from(
                    document.querySelectorAll<HTMLElement>("[data-msg-id]"),
                  ).find(
                    (n) => n.getAttribute("data-msg-id") === replyTarget.id,
                  );
                  el?.scrollIntoView({ behavior: "smooth", block: "center" });
                }}
                title={t("chat.jumpToReply")}
              >
                <div className="font-medium mb-0.5">
                  {replyTarget.role === "user"
                    ? `👤 ${t("chat.user")}`
                    : `🤖 ${t("chat.assistant")}`}
                </div>
                <div className="truncate">
                  {typeof replyTarget.content === "string"
                    ? replyTarget.content.slice(0, 80) +
                      (replyTarget.content.length > 80 ? "..." : "")
                    : t("chat.complexContent")}
                </div>
              </div>
            )}

            {/* 消息内容 */}
            {isUser ? (
              <div className="text-sm break-words leading-relaxed">
                <BlockRenderer
                  block={{
                    id: `${message.id}_content`,
                    type: "text",
                    content:
                      typeof message.content === "string"
                        ? message.content
                        : "",
                    isStreaming: false,
                  }}
                  sessionId={message.session_id}
                />
              </div>
            ) : isTool ? (
              <ToolResultMessage message={message} />
            ) : (
              <AssistantMessage message={message} isStreaming={isStreaming} />
            )}

            {/* Token/成本信息（默认隐藏，点 📊 图标展开） */}
            {sessionUsage && sessionUsage.totalTokens > 0 && (
              <TokenInfoSection
                sessionUsage={sessionUsage}
                isUser={isUser}
                formatCost={formatCost}
              />
            )}
          </div>

          {/* 底部：时间戳 + 操作按钮（同一行） */}
          {!message.error && (
            <div
              className={`flex items-center gap-2 mt-1 text-[10px] text-gray-400 dark:text-gray-500 ${isUser ? "justify-end flex-row-reverse" : "justify-start"}`}
            >
              {/* 时间戳 */}
              {message.timestamp && (
                <span>{formatTime(message.timestamp)}</span>
              )}

              {/* 用户消息：操作按钮常驻 */}
              {isUser && (
                <>
                  <button
                    onClick={(e) => handleCopy(!e.shiftKey)}
                    className="hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                    aria-label={t("chat.copyMessage")}
                  >
                    📋 {t("chat.copyMessage")}
                  </button>
                  <button
                    onClick={() => setEditTarget(message)}
                    className="hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                    aria-label={t("chat.editMessage")}
                  >
                    ✏️ {t("chat.editMessage")}
                  </button>
                  <button
                    onClick={() => setConfirmAction("delete")}
                    disabled={storeIsStreaming}
                    className={`${storeIsStreaming ? "cursor-not-allowed text-gray-300 dark:text-gray-600" : "hover:text-red-500 dark:hover:text-red-400"} transition-colors`}
                    aria-label={t("chat.deleteMessage")}
                  >
                    🗑️ {t("chat.deleteMessage")}
                  </button>
                  <button
                    onClick={() => setConfirmAction("rollback")}
                    disabled={storeIsStreaming || remainingRollbacks <= 0}
                    className={`${storeIsStreaming || remainingRollbacks <= 0 ? "cursor-not-allowed text-gray-300 dark:text-gray-600" : "hover:text-gray-600 dark:hover:text-gray-300"} transition-colors`}
                    aria-label={t("chat.rollback")}
                    title={
                      remainingRollbacks <= 0
                        ? t("chat.rollbackLimitReached")
                        : undefined
                    }
                  >
                    ↩️ {t("chat.rollback")}
                  </button>
                  <button
                    onClick={handleBranch}
                    disabled={branching || storeIsStreaming}
                    className={`${storeIsStreaming ? "cursor-not-allowed text-gray-300 dark:text-gray-600" : "hover:text-gray-600 dark:hover:text-gray-300"} transition-colors disabled:opacity-50`}
                    aria-label={t("chat.branch")}
                  >
                    {branching
                      ? "🌿 " + t("chat.branching")
                      : "🌿 " + t("chat.branch")}
                  </button>
                </>
              )}

              {/* AI 消息：复制常驻（Shift+Click 复制纯文本） */}
              {!isUser && !isTool && (
                <button
                  onClick={(e) => handleCopy(!e.shiftKey)}
                  className="hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                  aria-label={t("chat.copyMessage")}
                  title={
                    // B-A2 修复：Shift+Click 提示文案改"复制纯文本"（原误用 copyMessage）
                    t("chat.copyMessage") +
                    " (Shift+Click: " +
                    t("chat.copyPlainText") +
                    ")"
                  }
                >
                  📋 {t("chat.copyMessage")}
                </button>
              )}

              {/* AI 消息：重新生成常驻（流式中 disabled） */}
              {!isUser && !isTool && (
                <button
                  onClick={handleRegenerate}
                  // B-B1 修复：禁用条件补全局 isStreaming——ChatMessageList 只对最后一条
                  // assistant 传 isStreaming=true，跨会话并行流式时历史消息按钮需同样禁用
                  disabled={isStreaming || storeIsStreaming}
                  className={`${isStreaming || storeIsStreaming ? "cursor-not-allowed text-gray-300 dark:text-gray-600" : "hover:text-gray-600 dark:hover:text-gray-300"} transition-colors`}
                  aria-label={t("chat.regenerate")}
                >
                  {isStreaming || storeIsStreaming ? "⏳" : "🔄"}{" "}
                  {t("chat.regenerate")}
                </button>
              )}

              {/* AI 消息：继续生成常驻（B-C1 真续写；B-C2 流式中禁用） */}
              {!isUser && !isTool && (
                <button
                  onClick={handleContinue}
                  disabled={storeIsStreaming}
                  className={`${storeIsStreaming ? "cursor-not-allowed text-gray-300 dark:text-gray-600" : "hover:text-gray-600 dark:hover:text-gray-300"} transition-colors`}
                  aria-label={t("chat.continueGenerate")}
                >
                  ✏️ {t("chat.continueGenerate")}
                </button>
              )}

              {/* AI 消息：沉淀为成果（仅项目上下文） */}
              {!isUser && !isTool && projectId && (
                <button
                  onClick={handleCaptureAsDeliverable}
                  className="hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
                  aria-label="沉淀为成果"
                  title="将当前回复保存到项目成果区"
                >
                  📌 沉淀
                </button>
              )}

              {/* ⋯ 更多菜单 */}
              <div className="relative">
                <button
                  onClick={() => setMenuOpen(!menuOpen)}
                  onBlur={() => setTimeout(() => setMenuOpen(false), 150)}
                  className="hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                  aria-haspopup="true"
                  aria-expanded={menuOpen}
                  aria-label={t("chat.actionsMore")}
                >
                  ⋯
                </button>
                {menuOpen && (
                  <div className="absolute bottom-full left-0 mb-1 w-40 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 z-30">
                    {isUser ? (
                      <></>
                    ) : (
                      <>
                        <button
                          onClick={openSaveModal}
                          className="w-full px-3 py-1.5 text-left text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                        >
                          💾 {t("chat.saveToKnowledge")}
                        </button>
                        {/* AI 回复导出：md / html / word（导出为纯前端下载，零后端依赖） */}
                        <button
                          onClick={() => {
                            setMenuOpen(false);
                            handleExport("md");
                          }}
                          className="w-full px-3 py-1.5 text-left text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                        >
                          📤 {t("chat.exportAsMarkdown")}
                        </button>
                        <button
                          onClick={() => {
                            setMenuOpen(false);
                            handleExport("html");
                          }}
                          className="w-full px-3 py-1.5 text-left text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                        >
                          📤 {t("chat.exportAsHtml")}
                        </button>
                        <button
                          onClick={() => {
                            setMenuOpen(false);
                            handleExport("word");
                          }}
                          className="w-full px-3 py-1.5 text-left text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                        >
                          📤 {t("chat.exportAsWord")}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* 复制 toast */}
              {copyToast && (
                <span
                  className={`${copyToast === "copied" ? "text-emerald-500" : "text-red-400"} animate-pulse`}
                >
                  {copyToast === "copied"
                    ? t("chat.toastCopied")
                    : t("chat.toastCopyFailed")}
                </span>
              )}

              {/* 沉淀 toast */}
              {captureToast && (
                <span className="text-emerald-500 animate-pulse text-xs">
                  已沉淀到成果区
                </span>
              )}
            </div>
          )}

          {/* 错误状态操作按钮 */}
          {message.error && !isStreaming && (
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={handleRetry}
                className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
              >
                🔄 {t("common.retry")}
              </button>
              <button
                onClick={handleContinue}
                className="px-4 py-1.5 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 rounded-md transition-colors"
              >
                {t("chat.continueGenerate")}
              </button>
            </div>
          )}

          {/* 保存到知识库弹窗 */}
          {showSaveModal && (
            <Suspense fallback={null}>
              <SaveKnowledgeModal
                isDark={isDark}
                initialTitle={
                  typeof message.content === "string"
                    ? message.content
                        .split("\n")[0]
                        .replace(/^#+\s*/, "")
                        .slice(0, 50)
                    : t("chat.chatContent")
                }
                onClose={() => setShowSaveModal(false)}
                onSave={handleSaveToKnowledge}
              />
            </Suspense>
          )}

          {/* 删除/回退确认弹窗 */}
          {confirmAction && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 max-w-sm mx-4">
                <p className="text-sm text-gray-700 dark:text-gray-300 mb-4">
                  {confirmAction === "delete"
                    ? t("chat.confirmDeleteMessage")
                    : t("chat.confirmRollback")}
                </p>
                {confirmAction === "rollback" && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                    {t("chat.remainingRollbacks", { n: remainingRollbacks })}
                  </p>
                )}
                <div className="flex justify-end gap-3">
                  <button
                    onClick={() => setConfirmAction(null)}
                    className="px-4 py-1.5 text-xs border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    onClick={
                      confirmAction === "delete"
                        ? handleConfirmDelete
                        : handleConfirmRollback
                    }
                    className="px-4 py-1.5 text-xs bg-red-600 hover:bg-red-700 text-white rounded-md transition-colors"
                  >
                    {t("common.confirm")}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 回退撤销 toast */}
          {showUndo && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-gray-800 text-white rounded-lg shadow-xl px-4 py-3 flex items-center gap-3 animate-message-enter">
              <span className="text-sm">{t("chat.rollbackDone")}</span>
              <button
                onClick={handleUndoRollback}
                className="text-sm font-medium text-blue-400 hover:text-blue-300 transition-colors"
              >
                {t("common.undo")}
              </button>
            </div>
          )}

          {/* 回退不可逆操作警告 */}
          {undoWarning && (
            <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-amber-600 text-white rounded-lg shadow-xl px-4 py-3 flex items-center gap-2 animate-message-enter">
              <span className="text-sm">{undoWarning}</span>
            </div>
          )}
        </div>

        {/* 用户头像（右侧，32px） */}
        {isUser && (
          <div
            className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white"
            style={{
              // R-L 修复：前端 user 消息 id 是 crypto.randomUUID() 长度恒 36，
              // 原 length 哈希导致所有用户头像同色；改用字符求和哈希。
              background: `hsl(${hashString(message.id) % 360}, 70%, 60%)`,
            }}
            aria-hidden="true"
          >
            {"U"}
          </div>
        )}

        {/* 移动端长按/右键操作菜单 */}
        {contextMenu && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={closeContextMenu}
              onTouchEnd={closeContextMenu}
            />
            <div
              className="fixed z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl py-1 min-w-[140px]"
              style={{
                left: Math.min(contextMenu.x, window.innerWidth - 150),
                top: Math.min(contextMenu.y, window.innerHeight - 200),
              }}
            >
              {/* 复制（所有消息） */}
              <button
                onClick={() => {
                  handleCopy(true);
                  closeContextMenu();
                }}
                className="w-full px-4 py-2.5 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
              >
                📋 {t("chat.copyMessage")}
              </button>

              {/* AI 消息操作 */}
              {!isUser && !isTool && (
                <>
                  <button
                    onClick={() => {
                      handleRegenerate();
                      closeContextMenu();
                    }}
                    disabled={isStreaming || storeIsStreaming}
                    className="w-full px-4 py-2.5 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 flex items-center gap-2"
                  >
                    🔄 {t("chat.regenerate")}
                  </button>
                  <button
                    onClick={() => {
                      handleContinue();
                      closeContextMenu();
                    }}
                    disabled={storeIsStreaming}
                    className="w-full px-4 py-2.5 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 flex items-center gap-2"
                  >
                    ✏️ {t("chat.continueGenerate")}
                  </button>
                  <button
                    onClick={() => {
                      openSaveModal();
                      closeContextMenu();
                    }}
                    className="w-full px-4 py-2.5 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                  >
                    💾 {t("chat.saveToKnowledge")}
                  </button>
                  {/* AI 回复导出：md / html / word */}
                  <button
                    onClick={() => {
                      handleExport("md");
                      closeContextMenu();
                    }}
                    className="w-full px-4 py-2.5 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                  >
                    📤 {t("chat.exportAsMarkdown")}
                  </button>
                  <button
                    onClick={() => {
                      handleExport("html");
                      closeContextMenu();
                    }}
                    className="w-full px-4 py-2.5 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                  >
                    📤 {t("chat.exportAsHtml")}
                  </button>
                  <button
                    onClick={() => {
                      handleExport("word");
                      closeContextMenu();
                    }}
                    className="w-full px-4 py-2.5 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                  >
                    📤 {t("chat.exportAsWord")}
                  </button>
                </>
              )}

              {/* 用户消息操作 */}
              {isUser && (
                <>
                  <button
                    onClick={() => {
                      setEditTarget(message);
                      closeContextMenu();
                    }}
                    className="w-full px-4 py-2.5 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                  >
                    ✏️ {t("chat.editMessage")}
                  </button>
                  <button
                    onClick={() => {
                      setConfirmAction("delete");
                      closeContextMenu();
                    }}
                    disabled={storeIsStreaming}
                    className="w-full px-4 py-2.5 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 flex items-center gap-2"
                  >
                    🗑️ {t("chat.deleteMessage")}
                  </button>
                  <button
                    onClick={() => {
                      setConfirmAction("rollback");
                      closeContextMenu();
                    }}
                    disabled={storeIsStreaming || remainingRollbacks <= 0}
                    className="w-full px-4 py-2.5 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 flex items-center gap-2"
                  >
                    ↩️ {t("chat.rollback")}
                  </button>
                  <button
                    onClick={() => {
                      handleBranch();
                      closeContextMenu();
                    }}
                    disabled={branching || storeIsStreaming}
                    className="w-full px-4 py-2.5 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 flex items-center gap-2"
                  >
                    🌿 {branching ? t("chat.branching") : t("chat.branch")}
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    );
  },
  (prevProps, nextProps) => {
    // 自定义比较器：仅当消息实际内容变化时重渲染
    if (prevProps.message.id !== nextProps.message.id) return false;
    if (prevProps.isStreaming !== nextProps.isStreaming) return false;
    // #6 修复：补 hasReplies 比较——原比较器漏掉它，某消息从"无回复"变为
    // "有回复"（replyToId 指向它）时若自身 blocks/content 未变则跳过重渲染，
    // "被回复"标记不出现
    if (prevProps.hasReplies !== nextProps.hasReplies) return false;
    if (prevProps.message.content !== nextProps.message.content) return false;
    if (prevProps.message.role !== nextProps.message.role) return false;
    // blocks 长度变化说明有新 block 追加，引用变化说明 block 内部状态更新（如 isStreaming）
    const prevBlocks = prevProps.message.blocks;
    const nextBlocks = nextProps.message.blocks;
    if ((prevBlocks?.length ?? 0) !== (nextBlocks?.length ?? 0)) return false;
    // P9+1: 用 O(1) checksum（长度+首尾id）快速跳过未变化的 blocks
    if (prevBlocks && nextBlocks && prevBlocks.length > 0) {
      const prevHead = prevBlocks[0].id;
      const nextHead = nextBlocks[0].id;
      const prevTail = prevBlocks[prevBlocks.length - 1].id;
      const nextTail = nextBlocks[nextBlocks.length - 1].id;
      if (prevHead === nextHead && prevTail === nextTail) {
        // 首尾 id 相同且长度相同 → 数组结构未变。
        // J-2.2: 但 P2-3 原地修改可能替换了块对象（如 toolCall.pendingApproval/result 更新），
        // 需逐项比较块引用以触发重渲染；prevBlocks === nextBlocks（纯文本原地追加）时跳过 O(n)。
        if (prevBlocks !== nextBlocks) {
          for (let i = 0; i < prevBlocks.length; i++) {
            if (prevBlocks[i] !== nextBlocks[i]) return false;
          }
        }
      } else {
        // 首尾变化时才做 O(n) 逐项比较
        for (let i = 0; i < prevBlocks.length; i++) {
          if (prevBlocks[i].id !== nextBlocks[i].id) return false;
          if (prevBlocks[i].content !== nextBlocks[i].content) return false;
          if (prevBlocks[i].isStreaming !== nextBlocks[i].isStreaming)
            return false;
        }
      }
    }
    // R-B 修复：sessionUsage 用数值比较而非引用——ChatMessageList 把同一个
    // sessionUsage 传给每条消息，且 ChatArea 中 useMemo 依赖 messages，流式每来
    // 一个 chunk 引用就变；引用比较会让所有历史消息判"需重渲染"，memo 形同虚设。
    // 仅展示用的 Token/成本信息变化时更新，不影响用户交互。
    const prevUsage = prevProps.sessionUsage;
    const nextUsage = nextProps.sessionUsage;
    if (
      prevUsage?.totalTokens !== nextUsage?.totalTokens ||
      prevUsage?.inputTokens !== nextUsage?.inputTokens ||
      prevUsage?.outputTokens !== nextUsage?.outputTokens ||
      prevUsage?.estimatedCostUsd !== nextUsage?.estimatedCostUsd
    ) {
      return false;
    }
    return true;
  },
);

/**
 * Token/成本信息折叠组件
 * 默认隐藏，点击 📊 图标展开；Cache 信息仅 VITE_SHOW_DEBUG 时显示
 */
function TokenInfoSection({
  sessionUsage,
  isUser,
  formatCost,
}: {
  sessionUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd?: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
  };
  isUser: boolean;
  formatCost: (costUsd?: number) => string | null;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const showDebug = import.meta.env.VITE_SHOW_DEBUG === "true";

  return (
    <div className="mt-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className={`text-xs ${isUser ? "text-blue-200" : "text-gray-400"} hover:opacity-80`}
        aria-expanded={expanded}
        aria-label={t("chat.tokenInfo")}
      >
        📊{" "}
        {expanded ? "" : sessionUsage.totalTokens.toLocaleString() + " tokens"}
      </button>
      {expanded && (
        <div
          className={`mt-1 text-xs space-y-0.5 ${isUser ? "text-blue-200" : "text-gray-400 dark:text-gray-500"}`}
        >
          <div>💬 {sessionUsage.totalTokens.toLocaleString()} tokens</div>
          <div>📥 输入: {sessionUsage.inputTokens.toLocaleString()}</div>
          <div>📤 输出: {sessionUsage.outputTokens.toLocaleString()}</div>
          {sessionUsage.estimatedCostUsd != null &&
            sessionUsage.estimatedCostUsd > 0 && (
              <div>💰 {formatCost(sessionUsage.estimatedCostUsd)}</div>
            )}
          {showDebug &&
            sessionUsage.cacheReadTokens != null &&
            sessionUsage.cacheReadTokens > 0 && (
              <div>📖 CR: {sessionUsage.cacheReadTokens.toLocaleString()}</div>
            )}
          {showDebug &&
            sessionUsage.cacheCreationTokens != null &&
            sessionUsage.cacheCreationTokens > 0 && (
              <div>
                ✏️ CW: {sessionUsage.cacheCreationTokens.toLocaleString()}
              </div>
            )}
        </div>
      )}
    </div>
  );
}

function AssistantMessage({
  message,
  isStreaming,
}: {
  message: Message;
  isStreaming?: boolean;
}) {
  const { t } = useTranslation();
  const sessionFiles = useChatStore(useShallow((s) => s.sessionFiles));
  const knownPaths = useMemo(
    () => sessionFiles.map((f) => f.path),
    [sessionFiles],
  );

  // 优先使用 blocks 渲染。
  // H-FIX：blocks 存在但仅含 status/progress 临时块时，仍走兜底从 content 重建，
  // 避免流式过程中状态块被落盘而正文 text 块缺失时前端无正文。
  let blocks =
    message.blocks &&
    message.blocks.length > 0 &&
    hasMeaningfulContentBlocks(message.blocks)
      ? message.blocks
      : buildFallbackBlocks(message);

  // H-FIX-2 流式中断兜底：blocks 中没有 text 正文且 content 为空，
  // 但存在 thinking 块（典型的流式在思考阶段被打断场景），
  // 追加提示 text 块，避免用户以为"正文消失"。
  const hasTextBlock = blocks.some(
    (b) => b.type === "text" && (b.content || "").trim(),
  );
  const hasThinkBlock = blocks.some(
    (b) => b.type === "thinking" && (b.content || "").trim(),
  );
  const contentEmpty = !(
    typeof message.content === "string" && message.content.trim()
  );
  if (!hasTextBlock && hasThinkBlock && contentEmpty) {
    blocks = [
      {
        id: "fb_interrupted_hint_" + message.id,
        type: "text",
        content:
          "⚠️ **该回复生成中断，未完成最终输出。** 下方「💭 思考过程」标签中保留了模型当时的推理草稿，可点击展开查看。",
        isStreaming: false,
        groupId: "fb_interrupt_" + message.id,
      },
      ...blocks,
    ];
  }

  const renderedContent = renderBlocksWithGroups(
    blocks,
    message.session_id,
    knownPaths,
    (content) => {
      // 非流式路径：QuestionBlock 提交后后端返回了最终内容，追加为新的 assistant 消息
      const newMsg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content,
        timestamp: Date.now(),
        session_id: message.session_id,
      };
      const store = useChatStore.getState();
      store.addMessage(newMsg);
      // 用户已回答 question，清除该会话的待回答标记（P2-3 按会话隔离）
      const questionState = useChatStore.getState().hasPendingQuestion;
      useChatStore.setState({
        hasPendingQuestion: {
          ...questionState,
          [message.session_id]: false,
        },
      });
    },
  );

  return (
    <div className="text-sm break-words max-w-none space-y-1">
      {/* DEBUG: blocks 调试信息（仅 dev 模式或 VITE_SHOW_DEBUG=true 时显示） */}
      {(process.env.NODE_ENV === "development" ||
        import.meta.env.VITE_SHOW_DEBUG === "true") && (
        <DebugBlockInfo blocks={blocks} messageId={message.id} />
      )}
      {renderedContent}
      {/* 流式脉冲光标：消息仍在生成中时，显示 3 个脉冲圆点 */}
      {isStreaming && (
        <span
          className="streaming-cursor"
          aria-live="polite"
          aria-label={t("chat.streamingLabel")}
        />
      )}
    </div>
  );
}

/** 调试组件：显示 block 结构信息 */
function DebugBlockInfo({
  blocks,
  messageId,
}: {
  blocks: MessageBlock[];
  messageId: string;
}) {
  return (
    <details className="mb-2 border border-red-400/30 rounded bg-red-50/30 dark:bg-red-950/20 p-2 text-xs">
      <summary className="cursor-pointer text-red-500 font-medium">
        🐛 Debug: {blocks.length} blocks
      </summary>
      <div className="mt-1 font-mono space-y-0.5 text-gray-600 dark:text-gray-400">
        <div className="text-[10px] text-gray-400">
          msgId: {messageId.slice(0, 8)}...
        </div>
        {blocks.map((b, i) => (
          <div key={b.id} className="border-l-2 border-red-300 pl-2 py-0.5">
            <span className="font-semibold text-red-500">[{i}]</span>{" "}
            <span className="text-blue-500">{b.type}</span>
            {b.type === "question" && b.questionData ? (
              <span className="text-emerald-500">
                {" "}
                questionId={b.questionData.questionId.slice(0, 8)} options=
                {b.questionData.options?.length} header="{b.questionData.header}
                "
              </span>
            ) : b.type === "status" ? (
              <span className="text-amber-500" title={b.content}>
                {" "}
                status="{b.content.slice(0, 50)}
                {b.content.length > 50 ? "..." : ""}"
              </span>
            ) : null}
            <span className="text-gray-400">
              {" "}
              isStreaming={String(b.isStreaming)} groupId=
              {b.groupId?.slice(0, 8) ?? "none"}
            </span>
          </div>
        ))}
      </div>
    </details>
  );
}

/**
 * 当消息没有 blocks 时，从 content 和 tool_calls 重建（兜底方案）
 * 每次 rebuildBlocksFromContent 已在 chatStore 中处理，此处仅作为最后防线
 */
function buildFallbackBlocks(message: Message): MessageBlock[] {
  const newBlocks: MessageBlock[] = [];

  const groupId = "fb_" + message.id;

  if (message.content) {
    newBlocks.push({
      id: "fb_text_" + message.id,
      type: "text",
      content: message.content,
      isStreaming: false,
      groupId,
    });
  }

  if (message.tool_calls && message.tool_calls.length > 0) {
    message.tool_calls.forEach((tc) => {
      newBlocks.push({
        id: "fb_tc_" + tc.id,
        type: "tool_call",
        content: "",
        toolCall: tc,
        isStreaming: false,
        groupId,
      });
    });
  }

  return newBlocks;
}

/**
 * 判断 block 是否为工具执行相关类型
 */
function isToolRelatedBlock(block: MessageBlock): boolean {
  return block.type === "status" || block.type === "tool_call";
}

/**
 * 高风险工具名单（默认走完整 ToolExecutionGroup 卡片，不降级为小标签）
 * 判断标准：有副作用（写文件/执行命令/删数据/外发请求）的工具必须让用户看清楚。
 * 低风险工具（读文件/搜索/查询类）走 ToolInlineTags 行内小标签 + 点击展开。
 */
const HIGH_RISK_TOOL_NAMES = new Set<string>([
  // Shell / 进程
  "Bash",
  "bash",
  "shell",
  "run_command",
  "RunCommand",
  "kill_process",
  "KillProcess",
  // 文件写
  "write_file",
  "Write",
  "edit_file",
  "Edit",
  "delete_file",
  "DeleteFile",
  "apply_patch",
  "ApplyPatch",
  "move_file",
  "rename_file",
  // 外部网络副作用（web_fetch 是只读但可能触发外部日志，保留观察）
  "web_fetch",
  "WebFetch",
  // MCP 外部桥接
  "mcp_call",
  "run_mcp",
]);

function isHighRiskToolBlock(block: MessageBlock): boolean {
  if (block.type !== "tool_call" || !block.toolCall) return false;
  const name = block.toolCall.name ?? "";
  return HIGH_RISK_TOOL_NAMES.has(name);
}

/**
 * 将 blocks 中的连续工具相关 blocks 按 groupId 分组：
 * - 普通工具组 → ToolInlineTags 行内小标签（P2，详细过程移右侧会话日志）
 * - 审批等待组 → ToolExecutionGroup（保留琥珀徽标 + 审批交互）
 * - 纯 status / 多媒体展示 → 直接渲染 BlockRenderer
 * groupId 由 ChronologicalBlockBuilder 在流式构建时分配，
 * 或由 rebuildBlocksFromContent 在重建时分配，
 * 确保同一逻辑组（文本→工具调用→状态）始终共享相同 groupId，避免割裂。
 * 向后兼容：旧数据无 groupId 时回退到 toolCallId 分组。
 */
function renderBlocksWithGroups(
  blocks: MessageBlock[],
  sessionId?: string,
  knownFilePaths?: string[],
  onQuestionResponse?: (content: string) => void,
): React.ReactNode[] {
  const result: React.ReactNode[] = [];
  let i = 0;

  const getGroupKey = (b: MessageBlock): string | undefined => {
    return b.groupId || b.toolCallId || b.toolCall?.id;
  };

  while (i < blocks.length) {
    const block = blocks[i];

    if (!isToolRelatedBlock(block)) {
      result.push(
        <BlockRenderer
          key={block.id}
          block={block}
          sessionId={sessionId}
          knownFilePaths={knownFilePaths}
          onQuestionResponse={onQuestionResponse}
        />,
      );
      i++;
      continue;
    }

    const toolBlocks: MessageBlock[] = [];
    const groupKey = getGroupKey(block);

    while (i < blocks.length && isToolRelatedBlock(blocks[i])) {
      const currentBlock = blocks[i];
      const currentKey = getGroupKey(currentBlock);

      if (groupKey && currentKey && currentKey !== groupKey) {
        break;
      }

      toolBlocks.push(currentBlock);
      i++;
    }

    // key 优先用第一个 block 的唯一 id，避免无 groupId 时多个 group 因相同 toolCallId 产生 key 冲突
    const firstBlockId = toolBlocks[0]?.id;
    const hasToolCall = toolBlocks.some((b) => b.type === "tool_call");

    // 纯 status 块（无 tool_call）直接渲染，不包装为 "工具执行" 组
    if (!hasToolCall) {
      for (const tb of toolBlocks) {
        // 上下文水位：收缩为紧凑标签（结构化标记 block.status === "watermark"，
        // 旧数据无标记时回退内容匹配），完整详情在右侧「会话日志」面板
        if (
          tb.type === "status" &&
          (tb.status === "watermark" || /^上下文水位/.test(tb.content))
        ) {
          result.push(<WatermarkTag key={tb.id} content={tb.content} />);
          continue;
        }
        result.push(
          <BlockRenderer
            key={tb.id}
            block={tb}
            sessionId={sessionId}
            knownFilePaths={knownFilePaths}
            onQuestionResponse={onQuestionResponse}
          />,
        );
      }
      continue;
    }

    // 多媒体展示类工具（图片/视频/音频）直接渲染，不包装为 "工具执行" 组
    // 用户需要直接看到内容，不应要求展开两层折叠
    const isMediaDisplay = toolBlocks.some(
      (b) =>
        b.type === "tool_call" &&
        (b.toolCall?.name === "image_display" ||
          b.toolCall?.name === "video_display" ||
          b.toolCall?.name === "audio_play"),
    );
    if (isMediaDisplay) {
      for (const tb of toolBlocks) {
        result.push(
          <BlockRenderer
            key={tb.id}
            block={tb}
            sessionId={sessionId}
            knownFilePaths={knownFilePaths}
            onQuestionResponse={onQuestionResponse}
          />,
        );
      }
      continue;
    }

    // 审批等待组：保留完整交互（琥珀徽标 + 审批操作），走 ToolExecutionGroup
    const hasPendingApproval = toolBlocks.some(
      (b) => b.type === "tool_call" && b.toolCall?.pendingApproval,
    );
    // 高风险工具组：副作用大（写文件/Bash/MCP 等），默认走完整卡片让用户能直接看到 args/result
    const hasHighRiskTool = toolBlocks.some(isHighRiskToolBlock);
    if (hasPendingApproval || hasHighRiskTool) {
      result.push(
        <ToolExecutionGroup
          key={`tool-group-${firstBlockId || groupKey || i}`}
          blocks={toolBlocks}
        />,
      );
    } else {
      // 普通工具组：降级为行内小标签（P2），点击可就地展开详情
      result.push(
        <ToolInlineTags
          key={`tool-tags-${firstBlockId || groupKey || i}`}
          blocks={toolBlocks}
        />,
      );
    }
  }

  return result;
}

export default ChatMessageMemo;
