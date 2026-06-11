import React, { useState } from "react";
import type { Message, MessageBlock } from "../../types";
import MarkdownRenderer from "./MarkdownRenderer";
import ThinkingBlock from "./ThinkingBlock";
import StatusBlock from "./StatusBlock";
import ToolCallBlock from "./ToolCallBlock";
import ToolExecutionGroup from "./ToolExecutionGroup";
import ToolResultMessage from "./ToolResultMessage";
import TaskCard from "./TaskCard";
import QuestionBlock from "./QuestionBlock";
import { knowledgeService } from "../../services/knowledgeService";
import { useConfigStore } from "../../stores/configStore";
import { useChatStore } from "../../stores/chatStore";

interface ChatMessageProps {
  message: Message;
  isStreaming?: boolean;
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

function ChatMessage({ message, isStreaming, sessionUsage }: ChatMessageProps) {
  const setReplyMessage = useChatStore((s) => s.setReplyMessage);
  const regenerateMessage = useChatStore((s) => s.regenerateMessage);
  const retryFromError = useChatStore((s) => s.retryFromError);
  const [showActions, setShowActions] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveTitle, setSaveTitle] = useState("");
  const [saveBase, setSaveBase] = useState("default");
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const configTheme = useConfigStore((s) => s.config.theme);
  const isDark = configTheme === "dark";
  const isUser = message.role === "user";
  const isTool = message.role === "tool";

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
    if (typeof message.content === "string") {
      await navigator.clipboard.writeText(message.content);
    }
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

  const handleSaveToKnowledge = async () => {
    if (!saveTitle.trim() || !message.content) return;
    setSaveStatus("saving");
    try {
      const content =
        typeof message.content === "string" ? message.content : "";
      const title = saveTitle.trim();
      await knowledgeService.saveFromChat({
        base: saveBase,
        title,
        content,
      });
      setSaveStatus("saved");
      setTimeout(() => {
        setShowSaveModal(false);
        setSaveStatus("idle");
        setSaveTitle("");
      }, 1500);
    } catch {
      setSaveStatus("error");
    }
  };

  const openSaveModal = () => {
    const firstLine =
      typeof message.content === "string"
        ? message.content
            .split("\n")[0]
            .replace(/^#+\s*/, "")
            .slice(0, 50)
        : "对话内容";
    setSaveTitle(firstLine || "对话内容");
    setSaveBase("default");
    setSaveStatus("idle");
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
            {isUser ? "你" : "Liri"}
          </span>
        </div>

        {/* 消息气泡 */}
        <div
          className={`max-w-3xl px-4 py-3 rounded-xl ${
            isUser
              ? "bg-gradient-to-r from-blue-500 to-blue-600 text-white ml-auto"
              : "bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100"
          }`}
        >
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
              🔄 重试
            </button>
            <button
              onClick={handleContinue}
              className="px-4 py-1.5 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 rounded-md transition-colors"
            >
              继续
            </button>
          </div>
        )}

        {/* 操作按钮 */}
        {showActions && !isUser && !message.error && (
          <div className="flex items-center gap-2 mt-2 opacity-70">
            <button
              onClick={() => {
                setReplyMessage(message);
                setShowActions(false);
              }}
              className="px-3 py-1 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded transition-colors"
            >
              回复
            </button>
            <button
              onClick={handleCopy}
              className="px-3 py-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
            >
              复制
            </button>
            <button
              onClick={openSaveModal}
              className="px-3 py-1 text-xs text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 rounded transition-colors"
            >
              保存到知识库
            </button>
            <button
              onClick={handleRegenerate}
              className="px-3 py-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
            >
              重新生成
            </button>
          </div>
        )}

        {/* 保存到知识库弹窗 */}
        {showSaveModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div
              className={`w-96 p-5 rounded-xl shadow-xl ${
                isDark
                  ? "bg-gray-800 border border-gray-700"
                  : "bg-white border border-gray-200"
              }`}
            >
              <h3
                className={`text-sm font-semibold mb-4 ${isDark ? "text-gray-100" : "text-gray-900"}`}
              >
                保存到知识库
              </h3>
              <div className="space-y-3">
                <div>
                  <label
                    className={`block text-xs mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
                  >
                    标题
                  </label>
                  <input
                    type="text"
                    value={saveTitle}
                    onChange={(e) => setSaveTitle(e.target.value)}
                    placeholder="文档标题"
                    className={`w-full px-3 py-2 border rounded-md text-sm ${
                      isDark
                        ? "bg-gray-700 border-gray-600 text-white placeholder-gray-400"
                        : "bg-white border-gray-300 text-gray-900 placeholder-gray-400"
                    } focus:outline-none focus:ring-2 focus:ring-blue-500`}
                  />
                </div>
                <div>
                  <label
                    className={`block text-xs mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
                  >
                    知识库
                  </label>
                  <input
                    type="text"
                    value={saveBase}
                    onChange={(e) => setSaveBase(e.target.value)}
                    placeholder="知识库名称 (默认: default)"
                    className={`w-full px-3 py-2 border rounded-md text-sm ${
                      isDark
                        ? "bg-gray-700 border-gray-600 text-white placeholder-gray-400"
                        : "bg-white border-gray-300 text-gray-900 placeholder-gray-400"
                    } focus:outline-none focus:ring-2 focus:ring-blue-500`}
                  />
                </div>
                {saveStatus === "error" && (
                  <p className="text-xs text-red-500">保存失败，请重试</p>
                )}
                {saveStatus === "saved" && (
                  <p className="text-xs text-emerald-500">保存成功 ✓</p>
                )}
              </div>
              <div className="flex items-center justify-end gap-2 mt-4">
                <button
                  onClick={() => setShowSaveModal(false)}
                  className="px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md"
                >
                  取消
                </button>
                <button
                  onClick={handleSaveToKnowledge}
                  disabled={saveStatus === "saving" || !saveTitle.trim()}
                  className="px-4 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-md"
                >
                  {saveStatus === "saving" ? "保存中..." : "保存"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
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
  // 优先使用 blocks 渲染，如果 blocks 不存在则从 content 和 tool_calls 重建
  const blocks =
    message.blocks && message.blocks.length > 0
      ? message.blocks
      : buildFallbackBlocks(message);

  const renderedContent = renderBlocksWithGroups(blocks, !!isStreaming, message.session_id, (content) => {
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
  }, (content) => {
    // TaskCard/Todo 按钮点击：发送用户消息到对话流
    const store = useChatStore.getState();
    store.sendMessage(content, message.session_id);
  });
  return (
    <div className="text-sm break-words max-w-none space-y-3">
      {renderedContent}
    </div>
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
  isStreaming: boolean,
  sessionId?: string,
  onQuestionResponse?: (content: string) => void,
  onSendMessage?: (content: string) => void,
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
          isStreaming={isStreaming}
          sessionId={sessionId}
          onQuestionResponse={onQuestionResponse}
          onSendMessage={onSendMessage}
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
        isStreaming={isStreaming}
      />,
    );
  }

  return result;
}

interface BlockRendererProps {
  block: MessageBlock;
  isStreaming?: boolean;
  sessionId?: string;
  onQuestionResponse?: (content: string) => void;
  onSendMessage?: (content: string) => void;
}

function BlockRenderer({ block, isStreaming, sessionId, onQuestionResponse, onSendMessage }: BlockRendererProps) {
  const sessionFiles = useChatStore((s) => s.sessionFiles);
  const readFileToPreview = useChatStore((s) => s.readFileToPreview);
  const knownFilePaths = sessionFiles.map((f) => f.path);
  switch (block.type) {
    case "thinking":
      return (
        <ThinkingBlock
          content={block.content}
          isStreaming={block.isStreaming || isStreaming}
        />
      );
    case "status":
      return (
        <StatusBlock
          content={block.content}
          isStreaming={block.isStreaming || isStreaming}
        />
      );
    case "tool_call":
      return block.toolCall ? (
        <ToolCallBlock
          toolCall={block.toolCall}
          isStreaming={block.isStreaming || isStreaming}
        />
      ) : null;
    case "question":
      return block.questionData ? (
        <QuestionBlock
          questionData={block.questionData}
          sessionId={sessionId}
          onResponse={onQuestionResponse}
        />
      ) : null;
    case "task_decomposition":
      return block.taskCard ? <TaskCard data={block.taskCard} sessionId={sessionId} onSendMessage={onSendMessage} /> : null;
    case "todo":
      return block.taskCard ? <TaskCard data={block.taskCard} sessionId={sessionId} onSendMessage={onSendMessage} /> : null;
    case "text":
    default:
      return (
        <MarkdownRenderer
          content={block.content}
          isStreaming={block.isStreaming || isStreaming}
          onPreviewFile={readFileToPreview}
          knownFilePaths={knownFilePaths}
        />
      );
  }
}

export default ChatMessage;
