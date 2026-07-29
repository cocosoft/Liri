import React, {
  useState,
  useRef,
  useEffect,
  Suspense,
  useCallback,
} from "react";
import { useTranslation } from "react-i18next";
import { useChatStore, inferFileType } from "../../stores/chat";
import { useShallow } from "zustand/shallow";
import { useSessionStore } from "../../stores/sessionStore";
import { useConfigStore } from "../../stores/configStore";
import { useNavigationStore } from "../../stores/navigationStore";
import { useVoiceStore } from "../../stores/voiceStore";
import { useFeatureFlagStore } from "../../stores/featureFlags";
import { fileService } from "../../services/fileService";
import { imageService } from "../../services/imageService";
import { chatService } from "../../services/chatService";
import VoiceInputButton, { type VoiceInputHandle } from "../VoiceInputButton";
import FileAttachmentBar from "./FileAttachmentBar";
import type { FileAttachmentBarHandle } from "./FileAttachmentBar";
import SlashCommandMenu, { SLASH_COMMANDS } from "./SlashCommandMenu";
import MentionMenu, { type MentionItem } from "./MentionMenu";
import { useChatDraft } from "./useChatDraft";
import { readFileAsBase64 } from "../../utils/fileUtils";
import { handleClientError } from "../../utils/handleError";
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

/** 聊天模式选项 */
const CHAT_MODES = [
  { key: "auto", icon: "🤖", labelKey: "chat.modeAuto" },
  { key: "deep", icon: "🧠", labelKey: "chat.modeDeep" },
  { key: "code", icon: "💻", labelKey: "chat.modeCode" },
  { key: "creative", icon: "🎨", labelKey: "chat.modeCreative" },
] as const;

type ChatMode = (typeof CHAT_MODES)[number]["key"];

function ChatInput() {
  const { t } = useTranslation();
  const [showCommands, setShowCommands] = useState(false);
  const [commandIndex, setCommandIndex] = useState(0);
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [imageItems, setImageItems] = useState<ImageItem[]>([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showUploadMenu, setShowUploadMenu] = useState(false);
  const [showModeMenu, setShowModeMenu] = useState(false);
  const [chatMode, setChatMode] = useState<ChatMode>("auto");
  /** @ 引用自动补全状态 */
  const [showMentions, setShowMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionStartPos, setMentionStartPos] = useState(0);
  const [isImageDragOver, setIsImageDragOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileBarRef = useRef<FileAttachmentBarHandle>(null);
  const uploadMenuRef = useRef<HTMLDivElement>(null);
  const wasShowingCommandsRef = useRef(false);
  const voiceBtnRef = useRef<VoiceInputHandle>(null);
  /** CG3: Steering — 任务执行中注入指导 */
  const [showSteering, setShowSteering] = useState(false);
  const [steeringText, setSteeringText] = useState("");
  const steeringInputRef = useRef<HTMLInputElement>(null);

  /** textarea 自动扩展高度 */
  const autoGrow = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "44px";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, []);

  const {
    streamMessage,
    isSending,
    isStreaming,
    isUploading,
    clearMessages,
    messageQueue,
    stopMessage,
  } = useChatStore();
  const sessionFiles = useChatStore(useShallow((s) => s.sessionFiles));
  const { currentSession, createSession } = useSessionStore();
  const { config } = useConfigStore();
  const setActivePage = useNavigationStore((s) => s.setActivePage);
  const messageQueueEnabled = useFeatureFlagStore((s) => s.flags.message_queue);
  const voiceIsRecording = useVoiceStore((s) => s.isRecording);

  // 草稿持久化
  const { input, setInput, setInputWithDraft, clearDraft } = useChatDraft(
    currentSession?.id,
  );

  useEffect(() => {
    autoGrow();
  }, [input, autoGrow]);

  // 回复/编辑状态同步
  const [replyMessage, setReplyMessage] = useState<Message | null>(null);
  const [editTarget, setEditTarget] = useState<Message | null>(null);
  /** 编辑模式下是否"另存为分支"发送 */
  const [branchOnEdit, setBranchOnEdit] = useState(false);

  // 每次进入编辑模式时重置 branchOnEdit
  useEffect(() => {
    if (editTarget?.id) {
      setBranchOnEdit(false);
    }
  }, [editTarget?.id]);

  /** 点击外部区域关闭上传菜单 */
  useEffect(() => {
    if (!showUploadMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (
        uploadMenuRef.current &&
        !uploadMenuRef.current.contains(e.target as Node)
      ) {
        setShowUploadMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showUploadMenu]);

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
          const c =
            typeof state.editTarget.content === "string"
              ? state.editTarget.content
              : "";
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
  const handleImageFiles = useCallback(
    (files: FileList | File[]) => {
      const imageFiles = Array.from(files).filter(isImageFile);
      if (imageFiles.length === 0) return;

      const oversized = imageFiles.find((f) => f.size > MAX_IMAGE_SIZE);
      if (oversized) {
        alert(t("chat.imageTooLarge", { name: oversized.name, max: "10MB" }));
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
    },
    [t],
  );

  /** 移除单张图片 */
  const handleRemoveImage = useCallback((index: number) => {
    setImageItems((prev) => {
      const item = prev[index];
      if (item) URL.revokeObjectURL(item.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  /**
   * 处理非图片文件：读取为 base64 后加入附件列表
   */
  const handleFileAttachments = useCallback(
    async (files: File[]) => {
      const MAX_FILE_SIZE = 20 * 1024 * 1024;
      const newAttachments: FileAttachment[] = [];

      for (const file of files) {
        if (file.size > MAX_FILE_SIZE) {
          alert(t("chat.fileTooLarge", { name: file.name, max: "20MB" }));
          continue;
        }
        try {
          const data = await readFileAsBase64(file);
          newAttachments.push({ name: file.name, size: file.size, data });
        } catch (e) {
          handleClientError(e, {
            module: "components:chat:ChatInput",
            action: "handleFileAttachments",
          });
          alert(t("chat.fileReadFailed", { name: file.name }));
        }
      }

      if (newAttachments.length > 0) {
        setAttachments((prev) => [...prev, ...newAttachments]);
      }
    },
    [t],
  );

  /** 粘贴图片+文件处理 */
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const imageFiles: File[] = [];
      const otherFiles: File[] = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind !== "file") continue;

        try {
          const file = item.getAsFile();
          if (!file) continue;

          if (isImageFile(file)) {
            imageFiles.push(file);
          } else {
            otherFiles.push(file);
          }
        } catch (e) {
          handleClientError(e, {
            module: "components:chat:ChatInput",
            action: "handlePaste",
          });
          // NotAllowedError: 非 HTTPS 环境剪贴板权限不足，弹出文件选择作为回退
          (e as Event).preventDefault();
          fileBarRef.current?.triggerFileInput();
          return;
        }
      }

      if (imageFiles.length > 0) {
        e.preventDefault();
        handleImageFiles(imageFiles);
      }
      if (otherFiles.length > 0) {
        e.preventDefault();
        handleFileAttachments(otherFiles);
      }
    },
    [handleImageFiles, handleFileAttachments],
  );

  /** 拖入文件（图片+文件）统一处理 */
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

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsImageDragOver(false);
      if (e.dataTransfer?.files) {
        const allFiles = Array.from(e.dataTransfer.files);
        const imgFiles = allFiles.filter(isImageFile);
        const otherFiles = allFiles.filter((f) => !isImageFile(f));

        if (imgFiles.length > 0) handleImageFiles(imgFiles);
        if (otherFiles.length > 0) handleFileAttachments(otherFiles);
      }
    },
    [handleImageFiles, handleFileAttachments],
  );

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
              p.file === item.file
                ? { ...p, status: "uploading" as const, progress: 0 }
                : p,
            ),
          );
          try {
            const result = await imageService.upload(item.file, (pct) => {
              setImageItems((prev) =>
                prev.map((p) =>
                  p.file === item.file ? { ...p, progress: pct } : p,
                ),
              );
            });
            setImageItems((prev) =>
              prev.map((p) =>
                p.file === item.file
                  ? {
                      ...p,
                      status: "done" as const,
                      progress: 100,
                      result: {
                        ...result,
                        filename: item.file.name,
                        size: item.file.size,
                      },
                    }
                  : p,
              ),
            );
            return {
              ...result,
              filename: item.file.name,
              size: item.file.size,
            };
          } catch (e) {
            handleClientError(e, {
              module: "components:chat:ChatInput",
              action: "uploadImages",
            });
            setImageItems((prev) =>
              prev.map((p) =>
                p.file === item.file ? { ...p, status: "error" as const } : p,
              ),
            );
            return null;
          }
        }),
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
   * CG3: 发送 Steering 指令到正在运行的任务
   */
  const handleSteering = async () => {
    const trimmed = steeringText.trim();
    if (!trimmed || !currentSession?.id) return;
    try {
      await chatService.steerSession(currentSession.id, trimmed);
      setSteeringText("");
      setShowSteering(false);
    } catch (err) {
      handleClientError(err, {
        module: "components:chatInput",
        action: "steerSession",
      });
    }
  };

  /**
   * 发送消息，先上传附件
   */
  const handleSubmit = async () => {
    const trimmed = input.trim();

    // 流式传输中：消息排队模式下不阻塞，旧模式下阻止
    if (isStreaming && !messageQueueEnabled) return;

    // 编辑重发：内容未变守卫
    if (editTarget && typeof editTarget.content === "string") {
      if (trimmed === editTarget.content.trim()) {
        alert(t("chat.contentUnchanged"));
        return;
      }
    }

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

      // 编辑重发 + 另存为分支：创建新分支会话
      if (editTarget && branchOnEdit) {
        const branchTitle = currentSession
          ? `${t("chat.branchPrefix")}${currentSession.title}`
          : t("chat.newBranchSession");
        const branchSession = await createSession(branchTitle);
        await useSessionStore.getState().switchSession(branchSession.id);
        sessionId = branchSession.id;
      }

      if (!sessionId) {
        const newSession = await createSession(t("chat.newSession"));
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
          content: "",
          type: inferFileType(f.path),
        });
      }
      for (const img of uploadedImages) {
        addSessionFile({
          path: img.path,
          name: img.filename,
          content: "",
          type: "image",
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
            : t("chat.complexContent");
        messageContent = `${t("chat.replyPrefix")}${replyContent}\n\n${messageContent}`;
      }
      if (uploadedPaths.length > 0) {
        const fileRefs = uploadedPaths
          .map((p, i) => `[${attachments[i].name}](${p})`)
          .join(", ");
        messageContent = messageContent
          ? `${messageContent}\n\n${t("chat.attachments")}: ${fileRefs}`
          : `${t("chat.uploadFile")}: ${fileRefs}`;
      }

      if (messageContent) {
        setInput("");
        setAttachments([]);
        setImageItems([]);
        setReplyMessage(null);
        useChatStore.getState().setEditTarget(null);
        clearDraft();
        await streamMessage(
          messageContent,
          sessionId,
          undefined,
          uploadedImages.length > 0 ? uploadedImages : undefined,
        );
      }

      setShowCommands(false);
      useChatStore.getState().setReplyMessage(null);
    } catch (err) {
      handleClientError(err, {
        module: "components:chat:ChatInput",
        action: "handleSubmit",
      });
      const errorMsg = err instanceof Error ? err.message : String(err);
      alert(t("chat.fileUploadFailed", { errorMsg }));
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
      const newSession = await createSession(t("chat.newSession"));
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
    /** @ 引用菜单键盘导航 */
    if (showMentions) {
      // 计算过滤后的条目数（与 MentionMenu 内逻辑一致）
      const q = mentionQuery.toLowerCase();
      const filtered = sessionFiles.filter((f) =>
        f.name.toLowerCase().includes(q),
      );

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % (filtered.length || 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex(
          (i) => (i - 1 + (filtered.length || 1)) % (filtered.length || 1),
        );
        return;
      }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        if (filtered.length > 0) {
          const item: MentionItem = {
            id: filtered[mentionIndex].path,
            label: filtered[mentionIndex].name,
            type: "file",
            path: filtered[mentionIndex].path,
          };
          handleMentionSelect(item);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowMentions(false);
        return;
      }
    }

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
    if (isStreaming && e.key === "Enter" && !e.shiftKey) {
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
   * 同时检测 / 命令和 @ 引用触发
   */
  const handleInputChange = (value: string) => {
    const willShowCommands = value.startsWith("/") && value.indexOf(" ") === -1;
    setInputWithDraft(value);
    setShowCommands(willShowCommands);

    if (!wasShowingCommandsRef.current && willShowCommands) {
      setCommandIndex(0);
    }
    wasShowingCommandsRef.current = willShowCommands;

    /** 检测 @ 引用触发：找到光标前最近的合法 @ 位置 */
    const textarea = textareaRef.current;
    const cursorPos = textarea?.selectionStart ?? value.length;

    let atPos = -1;
    for (let i = cursorPos - 1; i >= 0; i--) {
      if (value[i] === "@" && (i === 0 || /\s/.test(value[i - 1]))) {
        atPos = i;
        break;
      }
      if (/\s/.test(value[i])) break;
    }

    if (atPos >= 0 && sessionFiles.length > 0) {
      const query = value.slice(atPos + 1, cursorPos);
      if (!query.includes(" ")) {
        setShowMentions(true);
        setMentionQuery(query);
        setMentionStartPos(atPos);
        setMentionIndex(0);
        return;
      }
    }
    setShowMentions(false);
  };

  /** @ 引用选中回调：替换 @query 为 Markdown 链接 */
  const handleMentionSelect = useCallback(
    (item: MentionItem) => {
      const before = input.slice(0, mentionStartPos);
      const after = input.slice(mentionStartPos + 1 + mentionQuery.length);
      const reference = `[${item.label}](file://${item.path})`;
      const newValue = before + reference + after;
      setInput(newValue);
      setShowMentions(false);
      // 将光标移到插入文本之后
      setTimeout(() => {
        const textarea = textareaRef.current;
        if (textarea) {
          const newPos = mentionStartPos + reference.length;
          textarea.focus();
          textarea.setSelectionRange(newPos, newPos);
        }
      }, 0);
    },
    [input, mentionStartPos, mentionQuery, setInput],
  );

  return (
    <div
      className={`px-3 py-2 bg-transparent transition-colors`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="max-w-3xl mx-auto">
        <div className="rounded-2xl bg-white dark:bg-gray-800 border border-gray-200/50 dark:border-gray-700/50 shadow-lg p-2">
          {/* 图片缩略图预览条 */}
          {imageItems.length > 0 && (
            <div className="mb-2 flex items-center gap-2 flex-wrap">
              {imageItems.slice(0, MAX_VISIBLE_THUMBNAILS).map((item, idx) => (
                <div
                  key={idx}
                  className="relative group w-16 h-16 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600 flex-shrink-0"
                >
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
                    title={t("chat.removeImage")}
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
              {t("chat.dropImageHere")}
            </div>
          )}

          {/* 文件附件栏 */}
          <FileAttachmentBar
            ref={fileBarRef}
            attachments={attachments}
            onAttachmentsChange={setAttachments}
            disabled={
              !currentSession ||
              (!messageQueueEnabled && isSending) ||
              isUploading
            }
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

            {/* @ 引用自动补全菜单 */}
            <MentionMenu
              query={mentionQuery}
              show={showMentions}
              selectedIndex={mentionIndex}
              sessionFiles={sessionFiles}
              onSelect={handleMentionSelect}
              onHover={setMentionIndex}
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
                  {replyMessage.role === "user"
                    ? `${t("chat.replyTo")}${t("chat.user")}`
                    : `${t("chat.replyTo")}${t("chat.assistant")}`}
                  :
                </span>
                <span className="text-xs text-gray-600 dark:text-gray-400 truncate max-w-xs">
                  {typeof replyMessage.content === "string"
                    ? replyMessage.content.length > 50
                      ? replyMessage.content.slice(0, 50) + "..."
                      : replyMessage.content
                    : t("chat.complexContent")}
                </span>
                <button
                  onClick={() => {
                    setReplyMessage(null);
                    useChatStore.getState().setReplyMessage(null);
                  }}
                  className="ml-auto p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded transition-colors"
                  title={t("chat.cancelReply")}
                >
                  ✕
                </button>
              </div>
            )}
            {/* 编辑消息预览 */}
            {editTarget && (
              <div className="mb-2 p-2 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                    {t("chat.editMessage")}:
                  </span>
                  <span className="text-xs text-gray-600 dark:text-gray-400 truncate max-w-xs">
                    {typeof editTarget.content === "string"
                      ? editTarget.content.length > 50
                        ? editTarget.content.slice(0, 50) + "..."
                        : editTarget.content
                      : t("chat.complexContent")}
                  </span>
                  <button
                    onClick={() => {
                      setEditTarget(null);
                      useChatStore.getState().setEditTarget(null);
                      setInput("");
                    }}
                    className="ml-auto p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded transition-colors"
                    title={t("chat.cancelEdit")}
                  >
                    ✕
                  </button>
                </div>
                {/* 另存为分支勾选框 */}
                <label className="flex items-center gap-2 mt-1.5 text-xs text-gray-500 dark:text-gray-400 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    id="branch-on-edit"
                    checked={branchOnEdit}
                    onChange={(e) => setBranchOnEdit(e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600 text-amber-500 focus:ring-amber-500"
                  />
                  {"另存为分支"}
                </label>
              </div>
            )}
            {/* 模式选择器 + 上传/表情 — 输入框上方 */}
            <div className="flex items-center gap-1 mb-0.5">
              <div className="relative">
                <button
                  onClick={() => setShowModeMenu(!showModeMenu)}
                  disabled={!currentSession}
                  className="flex items-center gap-1 px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-full hover:border-blue-300 dark:hover:border-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title={t("chat.selectMode")}
                >
                  <span>
                    {CHAT_MODES.find((m) => m.key === chatMode)?.icon}
                  </span>
                  <span className="text-gray-500 dark:text-gray-400">
                    {t(
                      CHAT_MODES.find((m) => m.key === chatMode)?.labelKey ??
                        "chat.selectMode",
                    )}
                  </span>
                  <svg
                    className="w-3 h-3 text-gray-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </button>
                {showModeMenu && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setShowModeMenu(false)}
                    />
                    <div className="absolute top-full left-0 mt-1 w-40 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 z-20">
                      {CHAT_MODES.map((mode) => (
                        <button
                          key={mode.key}
                          onClick={() => {
                            setChatMode(mode.key);
                            setShowModeMenu(false);
                          }}
                          className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
                            chatMode === mode.key
                              ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                              : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                          }`}
                        >
                          <span>{mode.icon}</span>
                          <span>{t(mode.labelKey)}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              {/* 上传 + 表情按钮 */}
              <div className="flex items-center gap-0.5">
                <input
                  ref={imageInputRef}
                  id="image-upload-input"
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) handleImageFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
                <div className="relative" ref={uploadMenuRef}>
                  <button
                    onClick={() => setShowUploadMenu(!showUploadMenu)}
                    aria-label={t("chat.uploadFile")}
                    disabled={!currentSession || isUploading}
                    className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title={t("chat.uploadFile")}
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 4v16m8-8H4"
                      />
                    </svg>
                  </button>
                  {showUploadMenu && (
                    <div className="absolute bottom-full left-0 mb-1 w-36 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 z-20">
                      <button
                        onClick={() => {
                          imageInputRef.current?.click();
                          setShowUploadMenu(false);
                        }}
                        className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 transition-colors"
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                          />
                        </svg>
                        {t("chat.uploadImage")}
                      </button>
                      <button
                        onClick={() => {
                          fileBarRef.current?.triggerFileInput();
                          setShowUploadMenu(false);
                        }}
                        className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 transition-colors"
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
                          />
                        </svg>
                        {t("chat.uploadFile")}
                      </button>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                  aria-label={t("chat.emoji")}
                  disabled={!currentSession}
                  className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title={t("chat.emoji")}
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </button>
              </div>
            </div>
            {/* 输入框 + 按钮 — textarea 独占整行，按钮在下方右对齐 */}
            <div className="flex flex-col gap-1 bg-gray-100 dark:bg-gray-700 rounded-2xl p-1 ring-1 ring-transparent focus-within:ring-blue-500/40 dark:focus-within:ring-blue-400/30 focus-within:shadow-md transition-all duration-200">
              {/* 文本输入 */}
              <div className="flex-1 relative">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => handleInputChange(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onKeyUp={handleKeyUp}
                  onPaste={handlePaste}
                  aria-label={t("chat.messageInput")}
                  placeholder={
                    currentSession
                      ? isStreaming && messageQueueEnabled
                        ? t("chat.streamingInputHint")
                        : t("chat.inputPlaceholder")
                      : t("chat.selectSessionHint")
                  }
                  disabled={!currentSession}
                  className="w-full px-3 py-2.5 bg-transparent resize-none focus:outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 disabled:cursor-not-allowed"
                  rows={1}
                  style={{ minHeight: "44px", maxHeight: "200px" }}
                />
              </div>

              {/* 底部按钮 — 语音 + 发送，右对齐 */}
              <div className="flex items-center gap-1 self-end">
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
                {/* CG3: Steering 注入 — 流式执行中可发送指令 */}
                {isStreaming && currentSession && (
                  <div className="flex items-center gap-1">
                    {showSteering ? (
                      <div className="flex items-center gap-1">
                        <input
                          ref={steeringInputRef}
                          type="text"
                          value={steeringText}
                          onChange={(e) => setSteeringText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSteering();
                            if (e.key === "Escape") {
                              setShowSteering(false);
                              setSteeringText("");
                            }
                          }}
                          placeholder={t("chat.steeringPlaceholder")}
                          className="w-36 px-2 py-1.5 text-xs bg-amber-50 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 rounded-lg text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
                          autoFocus
                        />
                        <button
                          onClick={handleSteering}
                          disabled={!steeringText.trim()}
                          className="px-2 py-1.5 text-xs bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 transition-colors"
                        >
                          {t("chat.steeringSend")}
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setShowSteering(true);
                          setTimeout(
                            () => steeringInputRef.current?.focus(),
                            50,
                          );
                        }}
                        className="p-1.5 text-amber-500 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded-lg transition-colors"
                        title={t("chat.steeringTitle")}
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122"
                          />
                        </svg>
                      </button>
                    )}
                  </div>
                )}
                {isStreaming && !messageQueueEnabled ? (
                  <button
                    onClick={() => stopMessage()}
                    aria-label={t("chat.stopGeneration")}
                    className="px-4 py-2 bg-gradient-to-r from-red-500 to-red-600 text-white rounded-lg hover:from-red-600 hover:to-red-700 transition-all font-medium shadow-md hover:shadow-lg flex items-center gap-2"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <rect x="4" y="4" width="16" height="16" rx="2" />
                    </svg>
                    <span>{t("chat.stopGeneration")}</span>
                  </button>
                ) : (
                  <button
                    onClick={handleSubmit}
                    aria-label={
                      isStreaming && messageQueueEnabled
                        ? t("chat.queueSend")
                        : t("chat.send")
                    }
                    disabled={
                      !currentSession ||
                      (!messageQueueEnabled && isSending) ||
                      isUploading ||
                      (!input.trim() && attachments.length === 0)
                    }
                    className="px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg hover:from-blue-600 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all font-medium shadow-md hover:shadow-lg flex items-center gap-2"
                  >
                    {isUploading ? (
                      <>
                        <svg
                          className="animate-spin h-4 w-4"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                          />
                        </svg>
                        <span>{t("chat.uploading")}</span>
                      </>
                    ) : isSending ? (
                      <>
                        <svg
                          className="animate-spin h-4 w-4"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                          />
                        </svg>
                        <span>
                          {messageQueueEnabled && messageQueue.length > 0
                            ? `${t("chat.sending")} (${messageQueue.length} ${t("chat.queued")})`
                            : t("chat.sending")}
                        </span>
                      </>
                    ) : messageQueueEnabled && messageQueue.length > 0 ? (
                      <>
                        <svg
                          className="w-5 h-5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                          />
                        </svg>
                        <span>
                          {t("chat.send")} ({messageQueue.length + 1}{" "}
                          {t("chat.queued")})
                        </span>
                      </>
                    ) : (
                      <>
                        <svg
                          className="w-5 h-5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                          />
                        </svg>
                        <span>{t("chat.send")}</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ChatInput;
