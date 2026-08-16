/**
 * OfficeChatPanel — 右侧 AI 辅助聊天面板（25%）
 * 消息持久化 + 清空对话 + 抽屉关闭 + 排队提示 + chatDirty 保护 + backdrop 遮罩
 */

import {
  useEffect,
  useRef,
  useState,
  useCallback,
  type FormEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { useOfficeStore, type ChatMessage } from "../../../stores/officeStore";

/** localStorage 存储键 */
const CHAT_STORAGE_KEY = "liri-office-chat-messages";
/** 聊天消息上限 */
const MAX_MESSAGES = 50;

/** 从 localStorage 恢复消息 */
function loadMessages(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) return [];
    const msgs = JSON.parse(raw) as ChatMessage[];
    return msgs.slice(-MAX_MESSAGES);
  } catch {
    return [];
  }
}

/** 持久化消息到 localStorage */
function saveMessages(msgs: ChatMessage[]) {
  try {
    localStorage.setItem(
      CHAT_STORAGE_KEY,
      JSON.stringify(msgs.slice(-MAX_MESSAGES)),
    );
  } catch {
    // localStorage 满时静默失败
  }
}

interface OfficeChatPanelProps {
  /** 是否显示遮罩（抽屉模式） */
  showBackdrop?: boolean;
  /** 关闭抽屉回调 */
  onClose?: () => void;
  /** 是否为抽屉模式（显示收起按钮） */
  drawerMode?: boolean;
  /** 用户发送消息回调（接入 AI） */
  onSendMessage?: (message: string) => void;
}

export function OfficeChatPanel({
  showBackdrop = false,
  onClose,
  drawerMode = false,
  onSendMessage,
}: OfficeChatPanelProps) {
  const { t } = useTranslation();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const {
    chatMessages,
    pendingMessage,
    setChatDirty,
    addChatMessage,
    clearChatMessages,
    restoreChatMessages,
  } = useOfficeStore();

  const [input, setInput] = useState("");
  /** 跳过首次挂载和恢复时的自动滚动，仅在新增消息时滚动 */
  const skipScrollRef = useRef(true);

  /** 初始化：从 localStorage 恢复 */
  useEffect(() => {
    if (chatMessages.length === 0) {
      const saved = loadMessages();
      if (saved.length > 0) {
        restoreChatMessages(saved);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 消息变更 → 持久化 */
  useEffect(() => {
    if (chatMessages.length > 0) {
      saveMessages(chatMessages);
    }
  }, [chatMessages]);

  /** 自动滚到底部（跳过挂载和恢复时的首次触发） */
  useEffect(() => {
    if (skipScrollRef.current) {
      skipScrollRef.current = false;
      return;
    }
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  /** 生成唯一 ID */
  const genId = () =>
    `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  /** 发送消息 */
  const handleSend = useCallback(
    (e?: FormEvent) => {
      e?.preventDefault();
      const text = input.trim();
      if (!text) return;

      const userMsg: ChatMessage = {
        id: genId(),
        role: "user",
        content: text,
        timestamp: Date.now(),
      };
      addChatMessage(userMsg);
      setInput("");
      setChatDirty(false);

      onSendMessage?.(text);
    },
    [input, addChatMessage, setChatDirty, onSendMessage],
  );

  /** 清空对话 */
  const handleClear = useCallback(() => {
    if (!window.confirm(t("office.confirmClearChat", "确定要清空所有对话吗？")))
      return;
    clearChatMessages();
    localStorage.removeItem(CHAT_STORAGE_KEY);
  }, [clearChatMessages, t]);

  /** 输入变更 */
  const handleInputChange = (value: string) => {
    setInput(value);
    setChatDirty(value.trim().length > 0);
  };

  /** 快捷指令 */
  const quickActions = [
    {
      label: t("office.createDoc", "创建文档"),
      prompt: "请帮我创建一份文档：",
    },
    {
      label: t("office.createTable", "创建表格"),
      prompt: "请帮我创建一份表格：",
    },
    {
      label: t("office.createPpt", "创建演示"),
      prompt: "请帮我创建一份演示文稿：",
    },
  ];

  return (
    <div
      className="h-full flex flex-col bg-white dark:bg-gray-950 border-l border-gray-200 dark:border-gray-700"
      role="region"
      aria-label={t("office.aiAssistant", "AI 辅助")}
    >
      {/* Backdrop 遮罩（抽屉模式） */}
      {showBackdrop && (
        <div
          className="fixed inset-0 bg-black/30 z-[999]"
          onClick={onClose}
          aria-label={t("office.closeAiPanel", "关闭AI面板")}
        />
      )}

      {/* ChatHeader */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
        <div className="flex items-center gap-2">
          {drawerMode && (
            <button
              onClick={onClose}
              className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 p-0.5"
              aria-label={t("office.closeAiPanel", "关闭AI面板")}
            >
              ←
            </button>
          )}
          <span className="text-sm font-semibold text-gray-900 dark:text-white">
            💬 {t("office.aiAssistant", "AI 助手")}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleClear}
            className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            title={t("office.clearChat", "清空对话")}
            aria-label={t("office.clearChat", "清空对话")}
          >
            🗑️
          </button>
        </div>
      </div>

      {/* ChatMessages */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-3">
        {chatMessages.length === 0 ? (
          <ChatWelcome
            quickActions={quickActions}
            onActionClick={(prompt) => {
              setInput(prompt);
              setChatDirty(true);
            }}
          />
        ) : (
          chatMessages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] px-3 py-1.5 rounded-xl text-sm whitespace-pre-wrap
                  ${
                    msg.role === "user"
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white"
                  }
                `}
              >
                {msg.content}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 排队提示 */}
      {pendingMessage && (
        <div className="px-3 py-1.5 text-xs text-center text-gray-500 bg-yellow-50 dark:bg-yellow-950 dark:text-yellow-400">
          {t("office.generationQueued", "正在生成中，您的消息已排队...")}
        </div>
      )}

      {/* ChatInput */}
      <form
        onSubmit={handleSend}
        className="border-t border-gray-200 dark:border-gray-700 p-2"
      >
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            placeholder={t(
              "office.chatPlaceholder",
              "输入指令，让 AI 帮你处理文档...",
            )}
            data-office-chat-input
            className="flex-1 px-2.5 py-1.5 text-sm border border-gray-200 
              dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 
              text-gray-900 dark:text-white placeholder-gray-400
              focus:outline-none focus:ring-1 focus:ring-blue-400"
            aria-label={t("office.chatInput", "输入消息")}
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg 
              hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            aria-label={t("office.send", "发送")}
          >
            {t("office.send", "发送")}
          </button>
        </div>
      </form>
    </div>
  );
}

/** ChatWelcome — 欢迎语 + 快捷指令 */
function ChatWelcome({
  quickActions,
  onActionClick,
}: {
  quickActions: Array<{ label: string; prompt: string }>;
  onActionClick: (prompt: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-4">
      <div className="text-2xl mb-3" aria-hidden="true">
        💬
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
        {t("office.aiWelcome", "我可以帮你创建/编辑文档...")}
      </p>
      <div className="flex flex-col gap-1.5 mt-3">
        {quickActions.map((action) => (
          <button
            key={action.label}
            onClick={() => onActionClick(action.prompt)}
            className="px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-700 
              rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors 
              text-gray-600 dark:text-gray-400"
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}
