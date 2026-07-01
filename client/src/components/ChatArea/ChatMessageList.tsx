import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import ChatMessage from "./ChatMessage";
import type { Message } from "../../types";
import { SkeletonMessageList } from "../common/Skeleton";
import { useSessionStore } from "../../stores/sessionStore";
import { ErrorBoundary } from "../common/ErrorBoundary";

/** 消息级别的轻量级错误降级 UI */
function MessageErrorFallback({ error }: { error: Error | null }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3 p-4 mx-2 my-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg" role="alert">
      <span className="text-lg shrink-0" aria-hidden="true">⚠️</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-red-700 dark:text-red-300">{t('chat.messageRenderError')}</p>
        <p className="text-xs text-red-500 dark:text-red-400 truncate mt-0.5">
          {error?.message || t('common.noData')}
        </p>
      </div>
    </div>
  );
}

/** 从消息中提取所有可搜索文本 */
function getMessageSearchText(message: Message): string {
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
        parts.push(block.content);
      }
    }
  }

  if (message.error) {
    parts.push(message.error);
  }

  return parts.join("\n");
}

/**
 * 搜索栏组件
 * 在消息列表顶部叠加显示搜索输入框和结果导航
 */
function SearchBar({
  query,
  onQueryChange,
  matchCount,
  currentIndex,
  onPrev,
  onNext,
  onClose,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  matchCount: number;
  currentIndex: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="sticky top-0 z-20 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-4 py-2 flex items-center gap-3">
      <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.shiftKey ? onPrev() : onNext();
          } else if (e.key === "Escape") {
            onClose();
          }
        }}
        placeholder={t('chat.searchSessions')}
        className="flex-1 text-sm bg-transparent border-none outline-none text-gray-800 dark:text-gray-200 placeholder-gray-400"
      />
      {query && (
        <span className="text-xs text-gray-500 shrink-0 whitespace-nowrap">
          {matchCount > 0
            ? `${currentIndex + 1}/${matchCount} ${t('chat.searchResults')}`
            : t('chat.noResults')}
        </span>
      )}
      {matchCount > 1 && (
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={onPrev} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500" title={t('chat.prevMatch')}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
            </svg>
          </button>
          <button onClick={onNext} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500" title={t('chat.nextMatch')}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      )}
      <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600" title={t('chat.closeSearch')}>
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

/**
 * 将消息列表导出为 Markdown 格式
 */
function exportAsMarkdown(messages: Message[], roleLabels: Record<string, string>): string {
  return messages
    .map((msg) => {
      const roleLabel =
        msg.role === "user" ? `👤 ${roleLabels.user}` :
        msg.role === "assistant" ? `🤖 ${roleLabels.assistant}` :
        msg.role === "system" ? `⚙️ ${roleLabels.system}` : `🛠 ${roleLabels.tool}`;
      const date = new Date(msg.timestamp).toLocaleString();
      const text = getMessageSearchText(msg);
      return `### ${roleLabel}  (${date})\n\n${text}\n`;
    })
    .join("\n---\n");
}

/**
 * 将消息列表导出为 JSON 格式
 */
function exportAsJson(messages: Message[]): string {
  const cleaned = messages.map(({ id, role, content, timestamp, error, tool_calls }) => ({
    id,
    role,
    content: getMessageSearchText({ content, blocks: undefined } as Message) || content,
    timestamp,
    error,
    toolCalls: tool_calls,
  }));
  return JSON.stringify(cleaned, null, 2);
}

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
  /** 创建新会话回调（欢迎页按钮） */
  onCreateSession?: () => void;
}

/** 聊天消息列表：消息渲染 + 空状态展示 + 搜索 + 导出 */
export default function ChatMessageList({
  messages,
  isStreaming,
  sessionUsage,
  hasSession,
  sessionTitle,
  onCreateSession,
}: ChatMessageListProps) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement>(null);
  const switching = useSessionStore((s) => s.switching);

  // 搜索状态
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

  // 导出菜单状态
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  /** 计算搜索匹配的消息 ID 列表 */
  const matchedIds = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return messages
      .filter((msg) => getMessageSearchText(msg).toLowerCase().includes(q))
      .map((msg) => msg.id);
  }, [messages, searchQuery]);

  /** 处理搜索导航：滚动到指定匹配消息 */
  const scrollToMatch = useCallback((index: number) => {
    const id = matchedIds[index];
    if (!id || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-msg-id="${id}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [matchedIds]);

  /** 上一个匹配 */
  const goToPrevMatch = useCallback(() => {
    if (matchedIds.length === 0) return;
    const next = (currentMatchIndex - 1 + matchedIds.length) % matchedIds.length;
    setCurrentMatchIndex(next);
    scrollToMatch(next);
  }, [matchedIds, currentMatchIndex, scrollToMatch]);

  /** 下一个匹配 */
  const goToNextMatch = useCallback(() => {
    if (matchedIds.length === 0) return;
    const next = (currentMatchIndex + 1) % matchedIds.length;
    setCurrentMatchIndex(next);
    scrollToMatch(next);
  }, [matchedIds, currentMatchIndex, scrollToMatch]);

  /** 切换搜索 */
  const toggleSearch = useCallback(() => {
    setSearchOpen((prev) => {
      if (prev) {
        setSearchQuery("");
        setCurrentMatchIndex(0);
      }
      return !prev;
    });
  }, []);

  /** 关闭搜索 */
  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
    setCurrentMatchIndex(0);
  }, []);

  /** Ctrl+F / Cmd+F 快捷键 */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        toggleSearch();
      } else if (e.key === "Escape" && searchOpen) {
        e.preventDefault();
        closeSearch();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [searchOpen, toggleSearch, closeSearch]);

  /** 搜索 query 变化时重置索引 */
  useEffect(() => {
    setCurrentMatchIndex(0);
  }, [searchQuery]);

  /** 导出菜单点击外部关闭 */
  useEffect(() => {
    if (!exportOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [exportOpen]);

  /** 匹配集用于高亮标记 */
  const matchedSet = useMemo(() => new Set(matchedIds), [matchedIds]);

  /** 导出 Markdown */
  const handleExportMarkdown = useCallback(() => {
    const md = exportAsMarkdown(messages, {
      user: t('chat.user'),
      assistant: t('chat.assistant'),
      system: t('chat.system'),
      tool: t('chat.tool'),
    });
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chat-export-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
    setExportOpen(false);
  }, [messages, t]);

  /** 导出 JSON */
  const handleExportJson = useCallback(() => {
    const json = exportAsJson(messages);
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chat-export-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setExportOpen(false);
  }, [messages]);

  // 重置导出菜单标识
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
            {t('chat.welcomeTitle')}
          </h2>
          <p className="text-gray-500 dark:text-gray-400">
            官网: https://openliri.com
          </p>
          <p className="text-gray-500 dark:text-gray-400 mt-1 mb-8">
            {t('chat.welcomeHint')}
          </p>
          <button
            onClick={onCreateSession}
            className="inline-flex items-center gap-2 px-8 py-3.5 text-base font-medium text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-xl shadow-lg hover:shadow-xl transition-all"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            {t('chat.startChat')}
          </button>
        </div>
      </div>
    );
  }

  // 空消息状态
  if (messages.length === 0) {
    if (isStreaming || switching) {
      return <SkeletonMessageList count={2} />;
    }

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
            {t('chat.noMessages')}
          </p>
          <div className="mt-4 flex items-center justify-center gap-2">
            <span className="px-3 py-1 bg-gray-100 dark:bg-gray-800 rounded-full text-xs text-gray-500">
              {t('chat.markdownSupport')}
            </span>
            <span className="px-3 py-1 bg-gray-100 dark:bg-gray-800 rounded-full text-xs text-gray-500">
              {t('chat.enterToSend')}
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={listRef} className="relative">
      {/* 顶部工具栏：搜索 + 导出 */}
      {searchOpen && (
        <SearchBar
          query={searchQuery}
          onQueryChange={setSearchQuery}
          matchCount={matchedIds.length}
          currentIndex={currentMatchIndex}
          onPrev={goToPrevMatch}
          onNext={goToNextMatch}
          onClose={closeSearch}
        />
      )}

      {/* 搜索按钮 + 导出按钮（固定在右上角，搜索栏打开时隐藏） */}
      {!searchOpen && (
        <div className="sticky top-0 z-10 flex items-center justify-end gap-1 px-4 py-1.5 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm">
          <button
            onClick={toggleSearch}
            className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            title={t('common.search')}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>

          {/* 导出按钮 + 下拉菜单 */}
          <div ref={exportRef} className="relative">
            <button
              onClick={() => setExportOpen((prev) => !prev)}
              className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              title={t('chat.exportSession')}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </button>

            {exportOpen && (
              <div className="absolute right-0 top-full mt-1 w-40 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 z-30">
                <button
                  onClick={handleExportMarkdown}
                  className="w-full px-3 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  导出为 Markdown
                </button>
                <button
                  onClick={handleExportJson}
                  className="w-full px-3 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  {t('chat.exportAsJson')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 消息列表（原生滚动，content-visibility 优化离屏渲染） */}
      <div className="py-4">
        {messages.map((message) => {
          const isMatched = matchedSet.has(message.id);
          const isCurrentMatch = matchedIds.length > 0 && matchedIds[currentMatchIndex] === message.id;
          const hasReplies = messages.some((m) => m.replyToId === message.id);

          return (
            <div
              key={message.id}
              data-msg-id={message.id}
              className={`transition-colors animate-message-enter ${
                isMatched
                  ? "bg-yellow-50/40 dark:bg-yellow-900/10 border-l-2 border-yellow-400 dark:border-yellow-500"
                  : "border-l-2 border-transparent"
              } ${isCurrentMatch ? "bg-yellow-100/60 dark:bg-yellow-900/20 ring-1 ring-yellow-400/30" : ""}`}
              style={{ contentVisibility: "auto", containIntrinsicSize: "auto 200px" } as React.CSSProperties}
            >
              <ErrorBoundary fallback={<MessageErrorFallback error={null} />}>
                <ChatMessage
                  message={message}
                  isStreaming={isStreaming && message.role === "assistant"}
                  hasReplies={hasReplies}
                  sessionUsage={sessionUsage}
                />
              </ErrorBoundary>
            </div>
          );
        })}
      </div>
    </div>
  );
}
