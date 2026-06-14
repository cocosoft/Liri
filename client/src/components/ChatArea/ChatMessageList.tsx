import ChatMessage from "./ChatMessage";
import type { Message } from "../../types";

interface ChatMessageListProps {
  messages: Message[];
  isStreaming: boolean;
  sessionUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd?: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
  };
  /** 无会话时显示 */
  hasSession: boolean;
  /** 会话标题（空消息时展示） */
  sessionTitle?: string;
}

/** 聊天消息列表：消息渲染 + 空状态展示 */
export default function ChatMessageList({
  messages,
  isStreaming,
  sessionUsage,
  hasSession,
  sessionTitle,
}: ChatMessageListProps) {
  // 无会话状态
  if (!hasSession) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center px-8">
          <div className="w-20 h-20 mx-auto mb-4 flex items-center justify-center">
            <img
              src="/liri_logo.png"
              alt="Liri Logo"
              className="w-20 h-20 object-contain"
            />
          </div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-200 mb-2">
            欢迎使用 Liri
          </h2>
          <p className="text-gray-500 dark:text-gray-400">
            官网: https://openliri.com
          </p>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            请从左侧选择一个会话或创建新会话开始聊天
          </p>
        </div>
      </div>
    );
  }

  // 空消息状态
  if (messages.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center px-8">
          <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 dark:bg-gray-800 rounded-xl flex items-center justify-center text-3xl">
            💬
          </div>
          <h2 className="text-lg font-medium text-gray-800 dark:text-gray-200 mb-2">
            {sessionTitle}
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
    );
  }

  // 消息列表（原生滚动，所有消息直接渲染）
  return (
    <div className="py-4">
      {messages.map((message) => (
        <div key={message.id} data-msg-id={message.id}>
          <ChatMessage
            message={message}
            isStreaming={isStreaming && message.role === "assistant"}
            sessionUsage={sessionUsage}
          />
        </div>
      ))}
    </div>
  );
}