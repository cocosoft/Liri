import React, { memo, useState, Suspense, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Message, MessageBlock } from "../../types";
import ToolExecutionGroup from "./ToolExecutionGroup";
import ToolResultMessage from "./ToolResultMessage";
import BlockRenderer from "./BlockRenderer";
import { knowledgeService } from "../../services/knowledgeService";
import { useConfigStore } from "../../stores/configStore";
import { useChatStore } from "../../stores/chatStore";
import { useSessionStore } from "../../stores/sessionStore";

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

/**
 * 从消息的 blocks 中提取完整文本内容（用于复制等操作）
 * 包含 text 块、thinking 块、tool_call 结果等所有可见文本
 */
function getFullContent(message: Message, labels: { thoughtProcess: string; toolCall: string; parameters: string; result: string }): string {
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
      } else if (block.type === "thinking" && block.content) {
        parts.push(`> 💭 ${labels.thoughtProcess}\n> ${block.content.replace(/\n/g, "\n> ")}`);
      } else if (block.type === "tool_call" && block.toolCall) {
        const tc = block.toolCall;
        const argsStr = tc.arguments ? JSON.stringify(tc.arguments, null, 2) : "";
        const resultStr = tc.result
          ? typeof tc.result === "string"
            ? tc.result
            : JSON.stringify(tc.result, null, 2)
          : "";
        if (argsStr || resultStr) {
          const lines = [`**${labels.toolCall}${tc.name}**`];
          if (argsStr) lines.push(`${labels.parameters}\n\`\`\`json\n${argsStr}\n\`\`\``);
          if (resultStr) lines.push(`${labels.result}\n${resultStr.slice(0, 500)}`);
          parts.push(lines.join("\n\n"));
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
const ChatMessageMemo = memo(function ChatMessage({
  message,
  isStreaming,
  hasReplies,
  sessionUsage,
}: ChatMessageProps) {
  const { t } = useTranslation();
  const setReplyMessage = useChatStore((s) => s.setReplyMessage);
  const setEditTarget = useChatStore((s) => s.setEditTarget);
  const regenerateMessage = useChatStore((s) => s.regenerateMessage);
  const retryFromError = useChatStore((s) => s.retryFromError);
  const messages = useChatStore((s) => s.messages);
  const createSession = useSessionStore((s) => s.createSession);
  const switchSession = useSessionStore((s) => s.switchSession);
  const currentSession = useSessionStore((s) => s.currentSession);
  const [showActions, setShowActions] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [branching, setBranching] = useState(false);
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

  const handleCopy = async () => {
    const textToCopy = getFullContent(message, {
      thoughtProcess: t('chat.thoughtProcess'),
      toolCall: t('chat.toolCall'),
      parameters: t('chat.parameters'),
      result: t('chat.result'),
    });
    await navigator.clipboard.writeText(textToCopy);
    setShowActions(false);
  };

  const handleRegenerate = () => {
    setShowActions(false);
    regenerateMessage(message.session_id);
  };

  const handleRetry = () => {
    // 找到此 AI 消息前面的用户消息
    retryFromError(message.id, message.session_id);
  };

  const handleContinue = () => {
    setReplyMessage(message);
  };

  /** 创建分支：从当前消息处创建新会话并切换过去 */
  const handleBranch = async () => {
    if (branching) return;
    setBranching(true);
    setShowActions(false);
    try {
      const branchTitle = currentSession
        ? `${t('chat.branchPrefix')}${currentSession.title}`
        : t('chat.newBranchSession');
      const session = await createSession(branchTitle);
      await switchSession(session.id);
    } catch (err) {
      console.error("[ChatMessage] 创建分支失败", err);
    } finally {
      setBranching(false);
    }
  };

  const handleSaveToKnowledge = async (title: string, base: string) => {
    const content = typeof message.content === "string" ? message.content : "";
    await knowledgeService.saveFromChat({ base, title, content });
  };

  const openSaveModal = () => {
    setShowSaveModal(true);
    setShowActions(false);
  };

  return (
    <div
      className={`flex gap-3 p-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors rounded-lg mx-2 -mx-2`}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* 头像 */}
      <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium overflow-hidden">
        {isUser ? (
          <div className="bg-blue-500 text-white">👤</div>
        ) : (
          <img
            src="/liri_logo.png"
            alt="Liri"
            className="w-8 h-8 object-contain"
          />
        )}
      </div>

      {/* 消息内容区域 */}
      <div className="flex-1 min-w-0">
        {/* 头部：名称 */}
        <div className="flex items-center gap-2 mb-1">
          <span
            className={`text-sm font-medium ${
              isUser
                ? "text-gray-700 dark:text-gray-300"
                : "text-gray-600 dark:text-gray-400"
            }`}
          >
            {isUser ? t('chat.user') : t('chat.assistant')}
          </span>
          {/* Agent 名称标签 */}
          {!isUser && message.agentName && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400 font-medium">
              {message.agentName}
            </span>
          )}
          {/* 被回复标记 */}
          {hasReplies && (
            <span className="text-[10px] text-blue-500 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-1.5 py-0.5 rounded-full">
              {t('chat.hasReplies')}
            </span>
          )}
        </div>

        {/* 消息气泡 */}
        <div
          className={`max-w-3xl px-4 py-3 rounded-xl ${
            isUser
              ? "bg-gradient-to-r from-blue-500 to-blue-600 text-white ml-auto"
              : "bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100"
          }`}
        >
          {/* 被回复的引用 */}
          {replyTarget && (
            <div
              className={`mb-2 p-2 rounded-lg text-xs border-l-2 cursor-pointer ${
                isUser
                  ? "bg-blue-400/20 border-blue-300 text-blue-100"
                  : "bg-gray-50 dark:bg-gray-700/50 border-gray-300 dark:border-gray-500 text-gray-500 dark:text-gray-400"
              }`}
              onClick={() => {
                const el = document.querySelector(`[data-msg-id="${replyTarget.id}"]`);
                el?.scrollIntoView({ behavior: "smooth", block: "center" });
              }}
              title={t('chat.jumpToReply')}
            >
              <div className="font-medium mb-0.5">
                {replyTarget.role === "user" ? `👤 ${t('chat.user')}` : `🤖 ${t('chat.assistant')}`}
              </div>
              <div className="truncate">
                {typeof replyTarget.content === "string"
                  ? replyTarget.content.slice(0, 80) +
                    (replyTarget.content.length > 80 ? "..." : "")
                  : t('chat.complexContent')}
              </div>
            </div>
          )}

          {/* 消息内容 */}
          {isUser ? (
            <div className="text-sm whitespace-pre-wrap break-words leading-relaxed">
              {message.content}
            </div>
          ) : isTool ? (
            <ToolResultMessage message={message} />
          ) : (
            <AssistantMessage message={message} isStreaming={isStreaming} />
          )}

          {/* 消息底部：时间、Token 用量和预估成本 */}
          <div
            className={`flex items-center justify-end gap-3 mt-2 pt-2 border-t ${
              isUser
                ? "border-blue-400/30"
                : "border-gray-200 dark:border-gray-700"
            }`}
          >
            {/* 时间 */}
            <span
              className={`text-xs ${
                isUser ? "text-blue-200" : "text-gray-400"
              }`}
            >
              {message.timestamp ? formatTime(message.timestamp) : ""}
            </span>

            {/* 会话累计 Token 和成本 */}
            {sessionUsage && sessionUsage.totalTokens > 0 && (
              <div
                className={`flex items-center gap-2 text-xs ${
                  isUser ? "text-blue-200" : "text-gray-400"
                }`}
              >
                <span className="flex items-center gap-1">
                  <span>💬</span>
                  <span>
                    {sessionUsage.totalTokens.toLocaleString()} tokens
                  </span>
                </span>
                {sessionUsage.cacheReadTokens != null &&
                  sessionUsage.cacheReadTokens > 0 && (
                    <span className="text-cyan-500">
                      📖CR {sessionUsage.cacheReadTokens.toLocaleString()}
                    </span>
                  )}
                {sessionUsage.cacheCreationTokens != null &&
                  sessionUsage.cacheCreationTokens > 0 && (
                    <span className="text-yellow-500">
                      ✏️CW {sessionUsage.cacheCreationTokens.toLocaleString()}
                    </span>
                  )}
                {sessionUsage.estimatedCostUsd != null &&
                  sessionUsage.estimatedCostUsd > 0 && (
                    <span
                      className={`flex items-center gap-1 ${
                        isUser
                          ? "text-green-300"
                          : "text-emerald-500 dark:text-emerald-400"
                      }`}
                    >
                      <span>💰</span>
                      <span>{formatCost(sessionUsage.estimatedCostUsd)}</span>
                    </span>
                  )}
              </div>
            )}
          </div>
        </div>

        {/* 错误状态操作按钮 */}
        {message.error && !isStreaming && (
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={handleRetry}
              className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
            >
              🔄 {t('common.retry')}
            </button>
            <button
              onClick={handleContinue}
              className="px-4 py-1.5 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 rounded-md transition-colors"
            >
              {t('chat.continueGenerate')}
            </button>
          </div>
        )}

        {/* 操作按钮 */}
        {showActions && isUser && !message.error && (
          <div className="flex items-center gap-2 mt-2 opacity-70">
            <button
              onClick={() => {
                setEditTarget(message);
                setShowActions(false);
              }}
              className="px-3 py-1 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded transition-colors"
            >
              {t('chat.editMessage')}
            </button>
            <button
              onClick={handleBranch}
              disabled={branching}
              className="px-3 py-1 text-xs text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-900/30 rounded transition-colors disabled:opacity-50"
            >
              {branching ? t('chat.branching') : t('chat.branch')}
            </button>
          </div>
        )}
        {showActions && !isUser && !message.error && (
          <div className="flex items-center gap-2 mt-2 opacity-70">
            <button
              onClick={() => {
                setReplyMessage(message);
                setShowActions(false);
              }}
              className="px-3 py-1 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded transition-colors"
            >
              {t('chat.reply')}
            </button>
            <button
              onClick={handleCopy}
              className="px-3 py-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
            >
              {t('chat.copyMessage')}
            </button>
            <button
              onClick={openSaveModal}
              className="px-3 py-1 text-xs text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 rounded transition-colors"
            >
              {t('chat.saveToKnowledge')}
            </button>
            <button
              onClick={handleContinue}
              className="px-3 py-1 text-xs text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/30 rounded transition-colors"
            >
              {t('chat.continueGenerate')}
            </button>
            <button
              onClick={handleRegenerate}
              className="px-3 py-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
            >
              {t('chat.regenerate')}
            </button>
            <button
              onClick={handleBranch}
              disabled={branching}
              className="px-3 py-1 text-xs text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-900/30 rounded transition-colors disabled:opacity-50"
            >
              {branching ? t('chat.branching') : t('chat.branch')}
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
                  : t('chat.chatContent')
              }
              onClose={() => setShowSaveModal(false)}
              onSave={handleSaveToKnowledge}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  // 自定义比较器：仅当消息实际内容变化时重渲染
  if (prevProps.message.id !== nextProps.message.id) return false;
  if (prevProps.isStreaming !== nextProps.isStreaming) return false;
  if (prevProps.message.content !== nextProps.message.content) return false;
  if (prevProps.message.role !== nextProps.message.role) return false;
  // blocks 长度变化说明有新 block 追加，引用变化说明 block 内部状态更新（如 isStreaming）
  const prevBlocks = prevProps.message.blocks;
  const nextBlocks = nextProps.message.blocks;
  if ((prevBlocks?.length ?? 0) !== (nextBlocks?.length ?? 0)) return false;
  if (prevBlocks !== nextBlocks) return false;
  // sessionUsage 引用变化时更新（仅显示用，不影响用户交互）
  if (prevProps.sessionUsage !== nextProps.sessionUsage) return false;
  return true;
});

function AssistantMessage({
  message,
  isStreaming,
}: {
  message: Message;
  isStreaming?: boolean;
}) {
  // 优先使用 blocks 渲染，如果 blocks 不存在则从 content 和 tool_calls 重建
  const blocks =
    message.blocks && message.blocks.length > 0
      ? message.blocks
      : buildFallbackBlocks(message);

  const renderedContent = renderBlocksWithGroups(blocks, message.session_id, (content) => {
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
    // 用户已回答 question，清除待回答标记
    useChatStore.setState({ hasPendingQuestion: false });
  });

  return (
    <div className="text-sm break-words max-w-none space-y-1">
      {/* DEBUG: blocks 调试信息 */}
      {process.env.NODE_ENV === "development" && (
        <DebugBlockInfo blocks={blocks} messageId={message.id} />
      )}
      {renderedContent}
      {/* 流式光标：消息仍在生成中时，末尾显示闪烁指示器 */}
      {isStreaming && (
        <span className="streaming-cursor" aria-hidden="true" />
      )}
    </div>
  );
}

/** 调试组件：显示 block 结构信息 */
function DebugBlockInfo({ blocks, messageId }: { blocks: MessageBlock[]; messageId: string }) {
  return (
    <details className="mb-2 border border-red-400/30 rounded bg-red-50/30 dark:bg-red-950/20 p-2 text-xs">
      <summary className="cursor-pointer text-red-500 font-medium">
        🐛 Debug: {blocks.length} blocks
      </summary>
      <div className="mt-1 font-mono space-y-0.5 text-gray-600 dark:text-gray-400">
        <div className="text-[10px] text-gray-400">msgId: {messageId.slice(0, 8)}...</div>
        {blocks.map((b, i) => (
          <div key={b.id} className="border-l-2 border-red-300 pl-2 py-0.5">
            <span className="font-semibold text-red-500">[{i}]</span>{" "}
            <span className="text-blue-500">{b.type}</span>
            {b.type === "question" && b.questionData ? (
              <span className="text-emerald-500">
                {" "}questionId={b.questionData.questionId.slice(0, 8)}
                {" "}options={b.questionData.options?.length}
                {" "}header="{b.questionData.header}"
              </span>
            ) : b.type === "status" ? (
              <span className="text-amber-500" title={b.content}>
                {" "}status="{b.content.slice(0, 50)}{b.content.length > 50 ? "..." : ""}"
              </span>
            ) : null}
            <span className="text-gray-400">
              {" "}isStreaming={String(b.isStreaming)}
              {" "}groupId={b.groupId?.slice(0, 8) ?? "none"}
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
 * 将 blocks 中的连续工具相关 blocks 按 groupId 分组成 ToolExecutionGroup
 * groupId 由 ChronologicalBlockBuilder 在流式构建时分配，
 * 或由 rebuildBlocksFromContent 在重建时分配，
 * 确保同一逻辑组（文本→工具调用→状态）始终共享相同 groupId，避免割裂。
 * 向后兼容：旧数据无 groupId 时回退到 toolCallId 分组。
 */
function renderBlocksWithGroups(
  blocks: MessageBlock[],
  sessionId?: string,
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
    result.push(
      <ToolExecutionGroup
        key={`tool-group-${firstBlockId || groupKey || i}`}
        blocks={toolBlocks}
      />,
    );
  }

  return result;
}

export default ChatMessageMemo;
