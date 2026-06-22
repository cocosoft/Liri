import React, { useState, useRef, useEffect, Suspense } from "react";
import { useChatStore, inferFileType } from "../../stores/chatStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useConfigStore } from "../../stores/configStore";
import { useAppStore } from "../../stores/appStore";
import { useFeatureFlagStore } from "../../stores/featureFlags";
import { fileService } from "../../services/fileService";
import VoiceInputButton from "../VoiceInputButton";
import FileAttachmentBar from "./FileAttachmentBar";
import SlashCommandMenu, { SLASH_COMMANDS } from "./SlashCommandMenu";
import { useChatDraft } from "./useChatDraft";
import type { Message } from "../../types";

const EmojiPicker = React.lazy(() => import("./EmojiPicker"));

interface FileAttachment {
  name: string;
  size: number;
  data: string;
}

function ChatInput() {
  const [showCommands, setShowCommands] = useState(false);
  const [commandIndex, setCommandIndex] = useState(0);
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const wasShowingCommandsRef = useRef(false);

  const { streamMessage, isSending, isStreaming, isUploading, clearMessages, messageQueue, stopMessage } = useChatStore();
  const { currentSession, createSession } = useSessionStore();
  const { config } = useConfigStore();
  const setActivePage = useAppStore((s) => s.setActivePage);
  const messageQueueEnabled = useFeatureFlagStore((s) => s.flags.message_queue);

  // 草稿持久化
  const { input, setInput, setInputWithDraft, clearDraft } = useChatDraft(currentSession?.id);

  // 回复/编辑状态同步
  const [replyMessage, setReplyMessage] = useState<Message | null>(null);
  const [editTarget, setEditTarget] = useState<Message | null>(null);

  useEffect(() => {
    const unsub = useChatStore.subscribe((state) => {
      if (state.replyMessage !== replyMessage) {
        setReplyMessage(state.replyMessage);
        if (state.replyMessage) textareaRef.current?.focus();
      }
    });
    return unsub;
  }, [replyMessage]);

  useEffect(() => {
    const unsub = useChatStore.subscribe((state) => {
      if (state.editTarget !== editTarget) {
        setEditTarget(state.editTarget);
        if (state.editTarget) {
          const c = typeof state.editTarget.content === "string" ? state.editTarget.content : "";
          setInput(c);
          textareaRef.current?.focus();
          textareaRef.current?.setSelectionRange(c.length, c.length);
        }
      }
    });
    return unsub;
  }, [editTarget, setInput]);

  /**
   * 插入 emoji 到输入框
   */
  const handleEmojiSelect = (emoji: string) => {
    const textarea = textareaRef.current;
    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newValue = input.substring(0, start) + emoji + input.substring(end);
      setInput(newValue);
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(start + emoji.length, start + emoji.length);
      }, 0);
    } else {
      setInput(input + emoji);
    }
  };

  /**
   * 发送消息，先上传附件
   */
  const handleSubmit = async () => {
    const trimmed = input.trim();

    // 流式传输中：消息排队模式下不阻塞，旧模式下阻止
    if (isStreaming && !messageQueueEnabled) return;

    const matched = SLASH_COMMANDS.find((cmd) => cmd.key === trimmed);
    if (matched) {
      // 命令由 ChatInput 执行（因为涉及 createSession、setActivePage 等 store 调用）
      if (matched.key === "/clear") {
        clearMessages();
        setInput("");
      } else if (matched.key === "/dashboard") {
        setActivePage("dashboard");
      } else if (matched.key === "/files") {
        setActivePage("files");
      } else if (matched.key === "/knowledge") {
        setActivePage("knowledge");
      } else if (matched.key === "/agent") {
        setActivePage("agent");
      } else if (matched.key === "/help") {
        setShowCommands(true);
      }
      setInput("");
      setShowCommands(false);
      return;
    }

    if (!trimmed && attachments.length === 0) return;

    useChatStore.setState({ isUploading: true });

    try {
      let sessionId = currentSession?.id;

      if (!sessionId) {
        const newSession = await createSession("新会话");
        sessionId = newSession.id;
      }

      const uploadedPaths: string[] = [];
      const uploadedFiles: Array<{ name: string; path: string }> = [];

      for (const file of attachments) {
        const result = await fileService.uploadBase64(file.name, file.data);
        uploadedPaths.push(result.path);
        uploadedFiles.push({ name: file.name, path: result.path });
      }

      useChatStore.setState({ isUploading: false });

      const addSessionFile = useChatStore.getState().addSessionFile;
      for (const f of uploadedFiles) {
        addSessionFile({
          path: f.path,
          name: f.name,
          content: '',
          type: inferFileType(f.path),
        });
      }

      let messageContent = trimmed;
      // 设置回复引用 ID，streamMessage 中会读取并写入消息的 replyToId
      if (replyMessage) {
        useChatStore.getState().setReplyMessage(null);
        // 将当前回复传递给 store 的 pendingReplyToId 字段
        useChatStore.setState({ pendingReplyToId: replyMessage.id });
        const replyContent =
          typeof replyMessage.content === "string"
            ? replyMessage.content.slice(0, 100) +
              (replyMessage.content.length > 100 ? "..." : "")
            : "[复杂内容]";
        messageContent = `回复：${replyContent}\n\n${messageContent}`;
      }
      if (uploadedPaths.length > 0) {
        const fileRefs = uploadedPaths
          .map((p, i) => `[${attachments[i].name}](${p})`)
          .join(", ");
        messageContent = messageContent
          ? `${messageContent}\n\n附件: ${fileRefs}`
          : `上传文件: ${fileRefs}`;
      }

      if (messageContent) {
        setInput("");
        setAttachments([]);
        setReplyMessage(null);
        useChatStore.getState().setEditTarget(null);
        clearDraft();
        await streamMessage(messageContent, sessionId);
      }

      setShowCommands(false);
      useChatStore.getState().setReplyMessage(null);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      alert(
        `文件上传失败: ${errorMsg}\n\n可能原因：\n• 系统安全策略限制了对用户目录的访问\n• 磁盘空间不足\n\n系统会自动尝试使用项目目录作为备选存储位置。`,
      );
      useChatStore.setState({ isUploading: false });
    }
  };

  /**
   * 键盘事件处理
   */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showCommands) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setCommandIndex((i) => (i + 1) % SLASH_COMMANDS.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setCommandIndex(
          (i) => (i - 1 + SLASH_COMMANDS.length) % SLASH_COMMANDS.length,
        );
        return;
      }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        setInput(SLASH_COMMANDS[commandIndex].key + " ");
        setCommandIndex(0);
        setShowCommands(false);
        return;
      }
    }

    if (e.key === "Escape") {
      setShowCommands(false);
      setShowEmojiPicker(false);
      return;
    }

    // 流式传输中 Enter：消息排队模式下允许发送
    if (isStreaming && (e.key === "Enter" && !e.shiftKey)) {
      if (!messageQueueEnabled) {
        e.preventDefault();
        return;
      }
    }

    if (
      (e.key === "Enter" && !e.shiftKey) ||
      (e.key === "Enter" && (e.ctrlKey || e.metaKey))
    ) {
      e.preventDefault();
      handleSubmit();
    }
  };

  /**
   * 输入框内容变化处理
   */
  const handleInputChange = (value: string) => {
    const willShowCommands = value.startsWith("/") && value.indexOf(" ") === -1;
    setInputWithDraft(value);
    setShowCommands(willShowCommands);

    if (!wasShowingCommandsRef.current && willShowCommands) {
      setCommandIndex(0);
    }
    wasShowingCommandsRef.current = willShowCommands;
  };

  return (
    <div
      className={`p-4 border-t bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 transition-colors flex-shrink-0`}
    >
      <div className="max-w-4xl mx-auto">
        {/* 文件附件栏 */}
        <FileAttachmentBar
          attachments={attachments}
          onAttachmentsChange={setAttachments}
          disabled={!currentSession || (!messageQueueEnabled && isSending) || isUploading}
        />

        {/* 输入框区域 */}
        <div className="relative">
          {/* 快捷命令菜单 */}
          <SlashCommandMenu
            input={input}
            show={showCommands}
            commandIndex={commandIndex}
            onSelect={(cmd) => {
              setInput(cmd.key + " ");
              setShowCommands(false);
            }}
            onHover={setCommandIndex}
          />

          {/* Emoji 选择器 */}
          {showEmojiPicker && (
            <Suspense fallback={<div className="h-64 w-72" />}>
              <EmojiPicker
                onSelect={handleEmojiSelect}
                onClose={() => setShowEmojiPicker(false)}
              />
            </Suspense>
          )}

          {/* 回复消息预览 */}
          {replyMessage && (
            <div className="mb-2 flex items-center gap-2 p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                {replyMessage.role === "user" ? "回复 你" : "回复 Liri"}:
              </span>
              <span className="text-xs text-gray-600 dark:text-gray-400 truncate max-w-xs">
                {typeof replyMessage.content === "string"
                  ? replyMessage.content.length > 50
                    ? replyMessage.content.slice(0, 50) + "..."
                    : replyMessage.content
                  : "[复杂内容]"}
              </span>
              <button
                onClick={() => {
                  setReplyMessage(null);
                  useChatStore.getState().setReplyMessage(null);
                }}
                className="ml-auto p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded transition-colors"
                title="取消回复"
              >
                ✕
              </button>
            </div>
          )}
          {/* 编辑消息预览 */}
          {editTarget && (
            <div className="mb-2 flex items-center gap-2 p-2 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
              <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                编辑消息:
              </span>
              <span className="text-xs text-gray-600 dark:text-gray-400 truncate max-w-xs">
                {typeof editTarget.content === "string"
                  ? editTarget.content.length > 50
                    ? editTarget.content.slice(0, 50) + "..."
                    : editTarget.content
                  : "[复杂内容]"}
              </span>
              <button
                onClick={() => {
                  setEditTarget(null);
                  useChatStore.getState().setEditTarget(null);
                  setInput("");
                }}
                className="ml-auto p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded transition-colors"
                title="取消编辑"
              >
                ✕
              </button>
            </div>
          )}
          {/* 输入框 + 发送按钮 */}
          <div className="flex items-end gap-3 bg-gray-100 dark:bg-gray-700 rounded-xl p-1.5">
            {/* 文本输入 */}
            <div className="flex-1 relative">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => handleInputChange(e.target.value)}
                onKeyDown={handleKeyDown}
                aria-label="消息输入框"
                placeholder={
                  currentSession
                    ? isStreaming && messageQueueEnabled
                      ? "AI 正在回复中，你可以继续输入消息..."
                      : "输入消息或 / 查看命令..."
                    : "请先选择或创建会话"
                }
                disabled={!currentSession}
                className="w-full px-3 py-2.5 bg-transparent resize-none focus:outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 disabled:cursor-not-allowed"
                rows={3}
                style={{ minHeight: "80px", maxHeight: "200px" }}
              />
            </div>

            {/* 右侧按钮 */}
            <div className="flex items-center gap-1">
              <VoiceInputButton isDark={config.theme === "dark"} />
              {isStreaming && !messageQueueEnabled ? (
                <button
                  onClick={() => stopMessage()}
                  aria-label="停止生成"
                  className="px-5 py-2.5 bg-gradient-to-r from-red-500 to-red-600 text-white rounded-lg hover:from-red-600 hover:to-red-700 transition-all font-medium shadow-md hover:shadow-lg flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <rect x="4" y="4" width="16" height="16" rx="2" />
                  </svg>
                  <span>停止</span>
                </button>
              ) : (
                <button
                  onClick={handleSubmit}
                  aria-label={isStreaming && messageQueueEnabled ? "排队发送消息" : "发送消息"}
                  disabled={
                    !currentSession ||
                    (!messageQueueEnabled && isSending) ||
                    isUploading ||
                    (!input.trim() && attachments.length === 0)
                  }
                  className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg hover:from-blue-600 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all font-medium shadow-md hover:shadow-lg flex items-center gap-2"
                >
                  {isUploading ? (
                    <>
                      <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      <span>上传中</span>
                    </>
                  ) : isSending ? (
                    <>
                      <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      <span>{messageQueueEnabled && messageQueue.length > 0 ? `发送中 (${messageQueue.length} 排队)` : "发送中"}</span>
                    </>
                  ) : messageQueueEnabled && messageQueue.length > 0 ? (
                    <>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                      </svg>
                      <span>发送 ({messageQueue.length + 1} 排队)</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                      </svg>
                      <span>发送</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ChatInput;
