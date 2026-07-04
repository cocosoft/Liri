import React, { useState, useRef, useEffect, Suspense, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useChatStore, inferFileType } from "../../stores/chatStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useConfigStore } from "../../stores/configStore";
import { useAppStore } from "../../stores/appStore";
import { useFeatureFlagStore } from "../../stores/featureFlags";
import { fileService } from "../../services/fileService";
import { imageService } from "../../services/imageService";
import VoiceInputButton, { type VoiceInputHandle } from "../VoiceInputButton";
import FileAttachmentBar from "./FileAttachmentBar";
import SlashCommandMenu, { SLASH_COMMANDS } from "./SlashCommandMenu";
import { useChatDraft } from "./useChatDraft";
import type { Message, AttachedImage } from "../../types";

const EmojiPicker = React.lazy(() => import("./EmojiPicker"));

interface FileAttachment {
  name: string;
  size: number;
  data: string;
}

/** 图片上传状态 */
interface ImageItem {
  /** 本地 File 对象 */
  file: File;
  /** 本地 blob URL（缩略图） */
  previewUrl: string;
  /** 上传状态 */
  status: "pending" | "uploading" | "done" | "error";
  /** 上传进度 0-100 */
  progress: number;
  /** 上传完成后的结果 */
  result?: AttachedImage;
}

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_IMAGES_PER_MESSAGE = 20;
const MAX_CONCURRENT_UPLOADS = 3;
const MAX_VISIBLE_THUMBNAILS = 5;

/** 判断是否为图片文件 */
function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

function ChatInput() {
  const { t } = useTranslation();
  const [showCommands, setShowCommands] = useState(false);
  const [commandIndex, setCommandIndex] = useState(0);
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [imageItems, setImageItems] = useState<ImageItem[]>([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isImageDragOver, setIsImageDragOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const wasShowingCommandsRef = useRef(false);
  const voiceBtnRef = useRef<VoiceInputHandle>(null);

  const { streamMessage, isSending, isStreaming, isUploading, clearMessages, messageQueue, stopMessage } = useChatStore();
  const { currentSession, createSession } = useSessionStore();
  const { config } = useConfigStore();
  const setActivePage = useAppStore((s) => s.setActivePage);
  const messageQueueEnabled = useFeatureFlagStore((s) => s.flags.message_queue);
  const voiceIsRecording = useAppStore((s) => s.voiceIsRecording);

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
   * 处理图片文件选择：过滤非图片文件，检查大小和数量限制
   */
  const handleImageFiles = useCallback((files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter(isImageFile);
    if (imageFiles.length === 0) return;

    const oversized = imageFiles.find((f) => f.size > MAX_IMAGE_SIZE);
    if (oversized) {
      alert(t('chat.imageTooLarge', { name: oversized.name, max: '10MB' }));
      return;
    }

    setImageItems((prev) => {
      const available = MAX_IMAGES_PER_MESSAGE - prev.length;
      if (available <= 0) return prev;

      const toAdd = imageFiles.slice(0, available);
      return [
        ...prev,
        ...toAdd.map((file) => ({
          file,
          previewUrl: URL.createObjectURL(file),
          status: "pending" as const,
          progress: 0,
        })),
      ];
    });
  }, [t]);

  /** 移除单张图片 */
  const handleRemoveImage = useCallback((index: number) => {
    setImageItems((prev) => {
      const item = prev[index];
      if (item) URL.revokeObjectURL(item.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  /** 粘贴图片处理 */
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        const file = items[i].getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      handleImageFiles(files);
    }
  }, [handleImageFiles]);

  /** 拖入图片处理 */
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsImageDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsImageDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsImageDragOver(false);
    if (e.dataTransfer?.files) {
      handleImageFiles(e.dataTransfer.files);
    }
  }, [handleImageFiles]);

  /** 并发上传所有待上传图片，返回 AttachedImage[] */
  const uploadImages = useCallback(async (): Promise<AttachedImage[]> => {
    const pending = imageItems.filter((item) => item.status === "pending");
    if (pending.length === 0) return [];

    const uploaded: AttachedImage[] = [];
    const total = pending.length;

    for (let i = 0; i < total; i += MAX_CONCURRENT_UPLOADS) {
      const batch = pending.slice(i, i + MAX_CONCURRENT_UPLOADS);
      const results = await Promise.allSettled(
        batch.map(async (item) => {
          setImageItems((prev) =>
            prev.map((p) =>
              p.file === item.file ? { ...p, status: "uploading" as const, progress: 0 } : p
            )
          );
          try {
            const result = await imageService.upload(item.file, (pct) => {
              setImageItems((prev) =>
                prev.map((p) =>
                  p.file === item.file ? { ...p, progress: pct } : p
                )
              );
            });
            setImageItems((prev) =>
                prev.map((p) =>
                  p.file === item.file ? { ...p, status: "done" as const, progress: 100, result: { ...result, filename: item.file.name, size: item.file.size } } : p
                )
              );
            return { ...result, filename: item.file.name, size: item.file.size };
          } catch {
            setImageItems((prev) =>
              prev.map((p) =>
                p.file === item.file ? { ...p, status: "error" as const } : p
              )
            );
            return null;
          }
        })
      );
      for (const r of results) {
        if (r.status === "fulfilled" && r.value) {
          uploaded.push(r.value);
        }
      }
    }
    return uploaded;
  }, [imageItems]);

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

    if (!trimmed && attachments.length === 0 && imageItems.length === 0) return;

    useChatStore.setState({ isUploading: true });

    try {
      let sessionId = currentSession?.id;

      if (!sessionId) {
        const newSession = await createSession(t('chat.newSession'));
        sessionId = newSession.id;
      }

      // 上传图片
      const uploadedImages = await uploadImages();

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
      for (const img of uploadedImages) {
        addSessionFile({
          path: img.path,
          name: img.filename,
          content: '',
          type: 'image',
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
            : t('chat.complexContent');
        messageContent = `${t('chat.replyPrefix')}${replyContent}\n\n${messageContent}`;
      }
      if (uploadedPaths.length > 0) {
        const fileRefs = uploadedPaths
          .map((p, i) => `[${attachments[i].name}](${p})`)
          .join(", ");
        messageContent = messageContent
          ? `${messageContent}\n\n${t('chat.attachments')}: ${fileRefs}`
          : `${t('chat.uploadFile')}: ${fileRefs}`;
      }

      if (messageContent) {
        setInput("");
        setAttachments([]);
        setImageItems([]);
        setReplyMessage(null);
        useChatStore.getState().setEditTarget(null);
        clearDraft();
        await streamMessage(messageContent, sessionId, undefined, uploadedImages.length > 0 ? uploadedImages : undefined);
      }

      setShowCommands(false);
      useChatStore.getState().setReplyMessage(null);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      alert(
        t('chat.fileUploadFailed', { errorMsg }),
      );
      useChatStore.setState({ isUploading: false });
    }
  };

  /**
   * 语音转录后自动发送消息
   */
  const handleVoiceSubmit = async (text: string) => {
    if (!text.trim()) return;

    let sessionId = currentSession?.id;
    if (!sessionId) {
      const newSession = await createSession(t('chat.newSession'));
      sessionId = newSession.id;
    }

    setInput("");
    clearDraft();
    await streamMessage(text.trim(), sessionId);
  };

  /**
   * 键盘松开事件处理 — 检测 PTT 松手停止录音
   */
  const handleKeyUp = (e: React.KeyboardEvent) => {
    // PTT 松手：Ctrl+Space 松开时停止录音
    if (e.key === " " || e.key === "Control") {
      if (voiceBtnRef.current && voiceIsRecording) {
        voiceBtnRef.current.stop();
      }
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

    // PTT 快捷键：按住 Ctrl+Space 说话，松手停止（仅输入框为空时生效）
    if (e.key === " " && e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      if (!e.repeat && voiceBtnRef.current && !voiceIsRecording) {
        voiceBtnRef.current.start();
      }
      return;
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
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="max-w-4xl mx-auto">
        {/* 图片缩略图预览条 */}
        {imageItems.length > 0 && (
          <div className="mb-2 flex items-center gap-2 flex-wrap">
            {imageItems.slice(0, MAX_VISIBLE_THUMBNAILS).map((item, idx) => (
              <div key={idx} className="relative group w-16 h-16 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600 flex-shrink-0">
                <img
                  src={item.previewUrl}
                  alt={item.file.name}
                  className="w-full h-full object-cover"
                />
                {item.status === "uploading" && (
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                    <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
                {item.status === "error" && (
                  <div className="absolute inset-0 bg-red-500/40 flex items-center justify-center text-white text-xs">
                    !
                  </div>
                )}
                <button
                  onClick={() => handleRemoveImage(idx)}
                  className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/60 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-xs hover:bg-black/80"
                  title={t('chat.removeImage')}
                >
                  ×
                </button>
              </div>
            ))}
            {imageItems.length > MAX_VISIBLE_THUMBNAILS && (
              <div className="w-16 h-16 rounded-lg border border-gray-200 dark:border-gray-600 flex items-center justify-center text-sm text-gray-500 dark:text-gray-400 flex-shrink-0">
                +{imageItems.length - MAX_VISIBLE_THUMBNAILS}
              </div>
            )}
          </div>
        )}

        {/* 拖入覆盖层 */}
        {isImageDragOver && (
          <div className="mb-2 p-4 border-2 border-dashed border-blue-400 dark:border-blue-500 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-center text-sm text-blue-600 dark:text-blue-400">
            {t('chat.dropImageHere')}
          </div>
        )}

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
                {replyMessage.role === "user" ? `${t('chat.replyTo')}${t('chat.user')}` : `${t('chat.replyTo')}${t('chat.assistant')}`}:
              </span>
              <span className="text-xs text-gray-600 dark:text-gray-400 truncate max-w-xs">
                {typeof replyMessage.content === "string"
                  ? replyMessage.content.length > 50
                    ? replyMessage.content.slice(0, 50) + "..."
                    : replyMessage.content
                  : t('chat.complexContent')}
              </span>
              <button
                onClick={() => {
                  setReplyMessage(null);
                  useChatStore.getState().setReplyMessage(null);
                }}
                className="ml-auto p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded transition-colors"
                title={t('chat.cancelReply')}
              >
                ✕
              </button>
            </div>
          )}
          {/* 编辑消息预览 */}
          {editTarget && (
            <div className="mb-2 flex items-center gap-2 p-2 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
              <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                {t('chat.editMessage')}:
              </span>
              <span className="text-xs text-gray-600 dark:text-gray-400 truncate max-w-xs">
                {typeof editTarget.content === "string"
                  ? editTarget.content.length > 50
                    ? editTarget.content.slice(0, 50) + "..."
                    : editTarget.content
                  : t('chat.complexContent')}
              </span>
              <button
                onClick={() => {
                  setEditTarget(null);
                  useChatStore.getState().setEditTarget(null);
                  setInput("");
                }}
                className="ml-auto p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded transition-colors"
                title={t('chat.cancelEdit')}
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
                onKeyUp={handleKeyUp}
                onPaste={handlePaste}
                aria-label={t('chat.messageInput')}
                placeholder={
                  currentSession
                    ? isStreaming && messageQueueEnabled
                      ? t('chat.streamingInputHint')
                      : t('chat.inputPlaceholder')
                    : t('chat.selectSessionHint')
                }
                disabled={!currentSession}
                className="w-full px-3 py-2.5 bg-transparent resize-none focus:outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 disabled:cursor-not-allowed"
                rows={3}
                style={{ minHeight: "80px", maxHeight: "200px" }}
              />
            </div>

            {/* 右侧按钮 */}
            <div className="flex items-center gap-1">
              {/* 隐藏的图片选择输入 */}
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) handleImageFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              {/* 图片上传按钮 */}
              <button
                onClick={() => imageInputRef.current?.click()}
                aria-label={t('chat.uploadImage')}
                disabled={!currentSession || isUploading}
                className="p-2.5 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={t('chat.uploadImage')}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </button>
              <VoiceInputButton
                ref={voiceBtnRef}
                isDark={config.theme === "dark"}
                autoSubmit
                onShouldSubmit={handleVoiceSubmit}
                onTranscribed={(text) => {
                  setInputWithDraft(text);
                  // 填入文字后自动聚焦到输入框
                  textareaRef.current?.focus();
                }}
              />
              {isStreaming && !messageQueueEnabled ? (
                <button
                  onClick={() => stopMessage()}
                  aria-label={t('chat.stopGeneration')}
                  className="px-5 py-2.5 bg-gradient-to-r from-red-500 to-red-600 text-white rounded-lg hover:from-red-600 hover:to-red-700 transition-all font-medium shadow-md hover:shadow-lg flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <rect x="4" y="4" width="16" height="16" rx="2" />
                  </svg>
                  <span>{t('chat.stopGeneration')}</span>
                </button>
              ) : (
                <button
                  onClick={handleSubmit}
                  aria-label={isStreaming && messageQueueEnabled ? t('chat.queueSend') : t('chat.send')}
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
                      <span>{t('chat.uploading')}</span>
                    </>
                  ) : isSending ? (
                    <>
                      <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      <span>{messageQueueEnabled && messageQueue.length > 0 ? `${t('chat.sending')} (${messageQueue.length} ${t('chat.queued')})` : t('chat.sending')}</span>
                    </>
                  ) : messageQueueEnabled && messageQueue.length > 0 ? (
                    <>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                      </svg>
                      <span>{t('chat.send')} ({messageQueue.length + 1} {t('chat.queued')})</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                      </svg>
                      <span>{t('chat.send')}</span>
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
