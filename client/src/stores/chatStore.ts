import { create } from "zustand";
import { Message, MessageBlock, FilePreview } from "../types";
import type { ToolCall, TaskCardTask, ProgressData } from "../types";
import { chatService } from "../services/chatService";
import { httpLegacy as http } from "../services/httpClient";
import { resolveFilePath } from "../services/filePathResolver";
import { sessionCoordinator, registerChatOperations } from "./sessionChatCoordinator";
import { useFeatureFlagStore } from "./featureFlags";
import { playWarningSound, playCompletionSound } from "../services/SoundService";
import { createLogger } from "../utils/logger";

const logger = createLogger("chatStore");

/**
 * 从工具调用中提取文件路径
 * 扫描所有工具的 arguments，提取 file_path/path/filePath 参数
 * @returns 文件路径字符串，若无匹配参数则返回 null
 */
function extractFilePathFromToolCall(toolCall: ToolCall): string | null {
  const args = toolCall.arguments as Record<string, unknown> | undefined;
  if (!args) return null;

  const filePath =
    (args.file_path as string) ||
    (args.path as string) ||
    (args.filePath as string);
  if (filePath && typeof filePath === "string") return filePath;

  return null;
}

/**
 * 从工具调用结果中提取最精确的文件路径
 * 优先取 result 中的路径，fallback 到 arguments 中的路径
 */
function resolveFilePathFromResult(toolCall: ToolCall): string | null {
  const argPath = extractFilePathFromToolCall(toolCall);
  if (!argPath) return null;

  if (toolCall.result && typeof toolCall.result === "object") {
    const result = toolCall.result as Record<string, unknown>;
    const resultPath =
      (result.filePath as string) ||
      (result.path as string) ||
      (result.file_path as string);
    if (resultPath && typeof resultPath === "string") return resultPath;
  }
  return argPath;
}

/**
 * 从路径字符串中提取文件名
 */
function extractFileName(filePath: string): string {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
}

/** 扩展名 → 文件类型映射表 */
type FileType = "code" | "text" | "image" | "markdown" | "json" | "yaml" | "pdf" | "docx" | "pptx";

const EXT_TO_TYPE: Record<string, FileType> = {
  // 文档
  ".md": "markdown",
  ".markdown": "markdown",
  ".txt": "text",
  ".csv": "text",
  ".log": "text",
  // Office 文档（预览时需转换）
  ".pdf": "pdf",
  ".docx": "docx",
  ".pptx": "pptx",
  // 数据
  ".json": "json",
  ".jsonc": "json",
  ".json5": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "yaml",
  ".ini": "yaml",
  ".cfg": "yaml",
  ".xml": "code",
  // 前端
  ".ts": "code",
  ".tsx": "code",
  ".js": "code",
  ".jsx": "code",
  ".mjs": "code",
  ".cjs": "code",
  ".css": "code",
  ".scss": "code",
  ".less": "code",
  ".html": "code",
  ".htm": "code",
  // 后端
  ".py": "code",
  ".rs": "code",
  ".go": "code",
  ".java": "code",
  ".c": "code",
  ".cpp": "code",
  ".h": "code",
  ".hpp": "code",
  ".rb": "code",
  ".php": "code",
  ".swift": "code",
  ".kt": "code",
  ".scala": "code",
  ".sql": "code",
  ".sh": "code",
  ".bash": "code",
  ".ps1": "code",
  ".bat": "code",
  // 配置
  ".env": "text",
  ".gitignore": "text",
  ".dockerignore": "text",
  ".editorconfig": "text",
  // 矢量图形
  ".svg": "code",
  // 图片
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".gif": "image",
  ".webp": "image",
  ".ico": "image",
  ".bmp": "image",
  ".tiff": "image",
};

/**
 * 根据文件扩展名推断文件类型（S0-5/6）
 * 用于后端返回 type="text" 或前端手工创建文件时的类型补正
 */
export function inferFileType(filePath: string): FileType {
  const lower = filePath.toLowerCase();
  for (const [ext, type] of Object.entries(EXT_TO_TYPE)) {
    if (lower.endsWith(ext)) {
      return type;
    }
  }
  return "text";
}

/**
 * 扫描 blocks 中的工具调用，提取文件路径并添加到会话文件列表
 */
function addFilePathsFromBlocks(
  blocks: MessageBlock[],
  addFile: (file: FilePreview) => void,
): void {
  for (const block of blocks) {
    if (block.type === "tool_call" && block.toolCall) {
      const filePath = resolveFilePathFromResult(block.toolCall);
      if (filePath) {
        addFile({
          path: filePath,
          name: extractFileName(filePath),
          content: "",
          type: inferFileType(filePath),
        });

        // 异步解析为规范路径,避免 LLM 路径偏差
        resolveFilePath(filePath).then((resolvedPath) => {
          if (resolvedPath && resolvedPath !== filePath) {
            const store = useChatStore.getState();
            const currentFiles = store.sessionFiles;
            const idx = currentFiles.findIndex((f) => f.path === filePath);
            if (idx !== -1) {
              const updated = [...currentFiles];
              updated[idx] = {
                ...updated[idx],
                path: resolvedPath,
                name: extractFileName(resolvedPath),
              };
              useChatStore.setState({ sessionFiles: updated });
            }
          }
        }).catch(() => {
          // 解析失败则保留原始路径
        });
      }
    }
  }
}

interface ChatStore {
  messages: Message[];
  isSending: boolean;
  isInputBlocked: boolean;
  isStreaming: boolean;
  /** 流式响应实时状态文本，用于 ChatInput 状态栏显示 */
  streamingStatus: string;
  /** 是否有待用户回答的 question 块（用于控制完成提示音是否需要播放） */
  hasPendingQuestion: boolean;
  /** 执行阶段追踪数据，由后端 ExecutionPhaseTracker 通过流式事件推送 */
  executionPhase: {
    phase: "analyzing" | "designing" | "implementing" | "verifying" | "presenting" | null;
    progress: number;
    description: string;
  } | null;
  error: string | null;
  replyMessage: Message | null;
  /** 待设置的回复引用 ID（streamMessage 中创建用户消息时读取） */
  pendingReplyToId: string | null;
  /** 正在编辑的消息（用户消息） */
  editTarget: Message | null;
  /** 当前预览的文件 */
  previewFile: FilePreview | null;
  /** 当前会话中生成的文件列表 */
  sessionFiles: FilePreview[];
  /** 是否正在上传文件 */
  isUploading: boolean;
  /** 中止控制器：用于取消正在进行的流式请求 */
  abortController: AbortController | null;
  /** 消息队列：流式输出中用户发送的新消息（放开输入限制后使用） */
  messageQueue: Array<{ content: string; sessionId?: string }>;
  addMessage: (message: Message) => void;
  sendMessage: (content: string, sessionId?: string) => Promise<void>;
  /** 将消息加入队列（流式输出中不阻塞输入） */
  enqueueMessage: (content: string, sessionId?: string) => void;
  /** 消费队列中的下一条消息 */
  dequeueAndSend: (sessionId?: string) => Promise<void>;
  streamMessage: (content: string, sessionId?: string, workMode?: "plan" | "do") => Promise<void>;
  /** 重新生成上一条 AI 消息 */
  regenerateMessage: (sessionId?: string) => Promise<void>;
  /** 在出错后重试（传入出错的 assistant 消息 ID，内部找到前置用户消息重新发送） */
  retryFromError: (assistantMsgId: string, sessionId?: string) => Promise<void>;
  clearMessages: () => void;
  setMessages: (messages: Message[]) => void;
  setReplyMessage: (message: Message | null) => void;
  /** 设置待编辑消息 */
  setEditTarget: (message: Message | null) => void;
  /** 取消当前流式请求 */
  stopMessage: () => void;
  /** 设置预览文件 */
  setPreviewFile: (file: FilePreview | null) => void;
  /** 添加生成的文件到列表 */
  addSessionFile: (file: FilePreview) => void;
  /** 清除会话文件列表 */
  clearSessionFiles: () => void;
  /** 读取文件内容并添加到预览 */
  readFileToPreview: (filePath: string) => Promise<void>;
  flushPendingSaves: () => Promise<void>;
}

import { sessionService } from "../services/sessionService";

/**
 * 根据持久化的 titleAutoGenerated 标记判断是否需要自动重命名
 */
function shouldAutoRename(sessionId?: string): boolean {
  if (!sessionId) {
    return false;
  }

  const store = sessionCoordinator().getState();

  // 优先从 currentSession 查找
  if (store.currentSession?.id === sessionId) {
    return store.currentSession.titleAutoGenerated === false;
  }

  // 降级：从 sessions 列表中按 sessionId 查找
  const found = store.sessions.find((s) => s.id === sessionId);
  if (found) {
    return found.titleAutoGenerated === false;
  }

  // 会话未找到，不触发自动重命名
  return false;
}

/**
 * 自动生成会话标题，失败时用用户消息前30字符作为降级标题
 * 添加延迟 + 二次检查防御后端 autoGenerateTitle 的竞态条件
 */
async function doAutoRename(
  sessionId: string,
  userMessage: string,
  assistantResponse: string,
): Promise<void> {
  // 延迟 2 秒，给后端 fire-and-forget 的 autoGenerateTitle 时间先完成
  await new Promise((r) => setTimeout(r, 2000));

  // 二次检查：后端可能已通过 SSE 更新了标记
  if (!shouldAutoRename(sessionId)) {
    return;
  }

  try {
    const title = await sessionService.generateTitle(
      sessionId,
      userMessage,
      assistantResponse,
    );

    const finalTitle = title || userMessage.slice(0, 30) + (userMessage.length > 30 ? "…" : "");
    sessionCoordinator().renameSession(sessionId, finalTitle);
  } catch (_error) {
    // LLM 生成标题失败，用用户消息前30字符降级
    const fallbackTitle =
      userMessage.length > 30 ? userMessage.slice(0, 30) + "…" : userMessage;
    sessionCoordinator().renameSession(sessionId, fallbackTitle);
  }
}

function generateBlockId(): string {
  return "blk_" + crypto.randomUUID().slice(0, 8);
}

function generateGroupId(): string {
  return "grp_" + crypto.randomUUID().slice(0, 8);
}

/**
 * 时序块构建器
 * 按流顺序构建 MessageBlock[]，确保工具调用前后的文本正确分段。
 * 对标 Cline 的 assistantMessageContent[] 顺序管理。
 *
 * 设计原理：
 *   1. text/thinking chunk → 写入当前活跃块
 *   2. tool_call chunk → 冻结当前文本块，新建 tool_call 块
 *   3. status chunk → 追加，标记工具调用的开始/结束
 *   4. 工具调用后，新 text chunk → 新建 text 块
 */
class ChronologicalBlockBuilder {
  private blocks: MessageBlock[] = [];
  private activeTextBlock: MessageBlock | null = null;
  private activeThinkingBlock: MessageBlock | null = null;
  private hasToolCallSinceLastText = false;
  private currentToolCallId: string | null = null;
  private currentGroupId: string = generateGroupId();

  /** 追加文本块，工具调用后自动新建（同时分配新 groupId） */
  addText(content: string, isStreaming: boolean): void {
    if (this.hasToolCallSinceLastText || !this.activeTextBlock) {
      this.currentGroupId = generateGroupId();
      const newBlock: MessageBlock = {
        id: generateBlockId(),
        type: "text",
        content,
        isStreaming,
        groupId: this.currentGroupId,
      };
      this.blocks.push(newBlock);
      this.activeTextBlock = newBlock;
      this.hasToolCallSinceLastText = false;
    } else {
      this.activeTextBlock.content += content;
      this.activeTextBlock.isStreaming = isStreaming;
    }
  }

  /** 追加 thinking 块 */
  addThinking(content: string, isStreaming: boolean): void {
    if (!this.activeThinkingBlock) {
      const newBlock: MessageBlock = {
        id: generateBlockId(),
        type: "thinking",
        content,
        isStreaming,
        groupId: this.currentGroupId,
      };
      this.blocks.push(newBlock);
      this.activeThinkingBlock = newBlock;
    } else {
      this.activeThinkingBlock.content += content;
      this.activeThinkingBlock.isStreaming = isStreaming;
    }
  }

  /** 冻结 thinking 块（text 到来时调用） */
  freezeThinking(): void {
    if (this.activeThinkingBlock) {
      this.activeThinkingBlock.isStreaming = false;
      this.activeThinkingBlock = null;
    }
  }

  /** 添加状态块，自动过滤冗余/瞬态状态：
   *  1. "🔧 Running tool: xxx" 中间态 → 直接丢弃，不产生 block
   *  2. "📦 ✅ Tool xxx completed" 冗余完成态 → 丢弃（与 "✅ xxx completed" 重复）
   *  3. "AI is thinking..." / "AI is analyzing your request..." 瞬态加载态 → 丢弃
   *  4. 连续重复内容跳过
   */
  addStatus(status: string): void {
    // 丢弃中间态 "🔧 Running tool: xxx"
    if (status.includes("🔧") && status.includes("Running tool")) {
      return;
    }

    // 丢弃冗余完成态 "📦 ✅ Tool xxx completed"
    if (status.includes("📦") && status.includes("✅ Tool")) {
      return;
    }

    const lastBlock = this.blocks[this.blocks.length - 1];

    // 连续重复跳过
    if (lastBlock?.type === "status" && lastBlock.content === status) {
      return;
    }

    this.blocks.push({
      id: generateBlockId(),
      type: "status",
      content: status,
      isStreaming: true,
      toolCallId: this.currentToolCallId ?? undefined,
      groupId: this.currentGroupId,
    });
  }

  /** 添加工具调用块，冻结当前文本 */
  addToolCall(toolCall: ToolCall): void {
    this.currentToolCallId = toolCall.id;

    if (this.activeTextBlock) {
      this.activeTextBlock.isStreaming = false;
    }
    if (this.activeThinkingBlock) {
      this.activeThinkingBlock.isStreaming = false;
      this.activeThinkingBlock = null;
    }

    const existingIdx = this.blocks.findIndex(
      (b) => b.type === "tool_call" && b.toolCall?.id === toolCall.id,
    );

    if (existingIdx !== -1) {
      const existing = this.blocks[existingIdx];
      // 保留已存在的参数（'start' 阶段的完整参数），避免被 'end' 阶段的空参数覆盖
      const mergedArgs =
        toolCall.arguments &&
        Object.keys(toolCall.arguments as Record<string, unknown>).length > 0
          ? toolCall.arguments
          : existing.toolCall?.arguments || toolCall.arguments;
      existing.toolCall = {
        ...toolCall,
        arguments: mergedArgs,
        status: toolCall.status || ("completed" as const),
      };
      existing.isStreaming = toolCall.status === "running";
        if (toolCall.status !== "running") { for (const b of this.blocks) { if (b.type === "status" && b.toolCallId === toolCall.id) { b.isStreaming = false; } } }
    } else {
      this.blocks.push({
        id: generateBlockId(),
        type: "tool_call",
        content: "",
        toolCall,
        isStreaming: true,
        toolCallId: toolCall.id,
        groupId: this.currentGroupId,
      });
      this.hasToolCallSinceLastText = true;
    }
  }

  /** 更新已有工具调用的状态 */
  updateToolCallStatus(
    toolCallId: string,
    status: "running" | "completed" | "failed",
  ): void {
    const block = this.blocks.find(
      (b) => b.type === "tool_call" && b.toolCall?.id === toolCallId,
    );
    if (block && block.toolCall) {
      block.toolCall.status = status;
      block.isStreaming = status === "running";
    }
  }

  /** 添加问题块 */
  addQuestion(questionData: import("../services/chatService").QuestionData): void {
    this.blocks.push({
      id: generateBlockId(),
      type: "question",
      content: "",
      questionData: {
        questionId: questionData.questionId,
        question: questionData.question,
        header: questionData.header,
        options: questionData.options.map((opt: import("../services/chatService").QuestionOption) => ({
          label: opt.label,
          description: opt.description,
        })),
        multiSelect: questionData.multiSelect,
      },
      groupId: this.currentGroupId,
    });
    // 标记自上次文本后有新 block，使后续文本创建新 text block（排在 question 之后）
    this.hasToolCallSinceLastText = true;
  }

  /** 添加或更新 todo 块 */
  addTodo(todoData: import("../types/index").TaskCardData): void {
    // 归一化：后端可能发送 phase 而非 status（修复 BUG #11 R2）
    const raw = todoData as unknown as { phase?: string };
    const normalized: import("../types/index").TaskCardData = {
      ...todoData,
      status: (raw.phase || todoData.status || 'planning') as "done" | "planning" | "executing",
    };

    // 先按标题精确匹配
    let idx = this.blocks.findIndex(
      (b) => b.type === "todo" && b.content === todoData.title,
    );
    // 标题不匹配时，回退到第一个 todo 块（流式更新时标题可能不同）
    if (idx === -1) {
      idx = this.blocks.findIndex((b) => b.type === "todo");
    }
    if (idx !== -1) {
      this.blocks[idx].taskCard = normalized;
      return;
    }
    this.blocks.push({
      id: generateBlockId(),
      type: "todo",
      content: todoData.title,
      taskCard: normalized,
      isStreaming: false,
      groupId: this.currentGroupId,
    });
  }

  /**
   * 更新 todo 块中单个任务的状态
   * 用于流式传输中实时反映任务进度变化
   */
  updateTodoTask(taskId: string, updates: Partial<{ status: TaskCardTask["status"]; result: string; durationMs: number }>): void {
    const idx = this.blocks.findIndex(b =>
      b.type === "todo" && b.taskCard
    );
    if (idx !== -1 && this.blocks[idx].taskCard) {
      const tasks = this.blocks[idx].taskCard!.tasks.map(t =>
        String(t.id) === String(taskId) ? { ...t, ...updates } : t
      );
      this.blocks[idx].taskCard = { ...this.blocks[idx].taskCard!, tasks };
    }
  }

  /**
   * 添加或更新进度块
   * 流式传输中，同一次执行的进度块会被更新而非重复追加
   */
  addProgress(progressData: ProgressData): void {
    // 按 phase 查找已有的进度块（同一次执行中同一 phase 不会重复出现）
    const idx = this.blocks.findIndex(
      (b) => b.type === "progress" && b.progressData?.phase === progressData.phase,
    );
    if (idx !== -1) {
      this.blocks[idx].progressData = progressData;
      this.blocks[idx].content = progressData.description;
      return;
    }
    this.blocks.push({
      id: generateBlockId(),
      type: "progress",
      content: progressData.description,
      progressData,
      isStreaming: true,
      groupId: this.currentGroupId,
    });
  }

  /** 冻结所有块（流式结束或中断时调用） */
  freezeAll(): void {
    for (const block of this.blocks) {
      block.isStreaming = false;
      // R1: 对 todo 块最终化其整体状态（修复 BUG #11）
      if (block.type === 'todo' && block.taskCard) {
        block.taskCard.status = 'done';
      }
    }
    this.activeTextBlock = null;
    this.activeThinkingBlock = null;
  }

  /** 获取构建好的 blocks */
  getBlocks(): MessageBlock[] {
    return [...this.blocks];
  }

  /** 重置构建器 */
  reset(): void {
    this.blocks = [];
    this.activeTextBlock = null;
    this.activeThinkingBlock = null;
    this.hasToolCallSinceLastText = false;
    this.currentToolCallId = null;
    this.currentGroupId = generateGroupId();
  }
}

// 防抖保存 blocks：流式传输中实时持久化，避免用户切换会话时丢失
let _pendingSaveSessionId: string | null = null;
let _pendingSaveMessageId: string | null = null;
let _pendingSaveBlocks: MessageBlock[] | null = null;
let hasPendingSave = false;
let _saveIsFlushing = false;

// 会话切换锁：setMessages 期间挂起流式写入，避免 loadSessions 覆盖流式数据
let _sessionSwitchLock = false;
// 会话切换锁期间的暂存区
let _pendingSwitchChunks: Array<{ sessionId: string; assistantId: string; blocks: MessageBlock[] }> = [];

// 会话消息缓存：避免快速切换时重复 fetch
const _sessionMessageCache = new Map<string, Message[]>();
const MAX_CACHED_SESSIONS = 5;
const MAX_CACHED_MESSAGES_PER_SESSION = 100;

/** 导出供 sessionStore 使用：获取缓存的会话消息 */
export function _getCachedMessages(sessionId: string): Message[] | null {
  return _sessionMessageCache.get(sessionId) ?? null;
}

async function flushSaveBlocks(): Promise<void> {
  // 重入锁：防止高频触发导致并发写入冲突
  if (_saveIsFlushing) return;
  _saveIsFlushing = true;
  try {
    if (_pendingSaveSessionId && _pendingSaveMessageId && _pendingSaveBlocks) {
      const sid = _pendingSaveSessionId;
      const mid = _pendingSaveMessageId;
      const blk = _pendingSaveBlocks;
      _pendingSaveSessionId = null;
      _pendingSaveMessageId = null;
      _pendingSaveBlocks = null;
      try {
        await chatService.updateMessageBlocks(
          sid,
          mid,
          blk as unknown as Array<Record<string, unknown>>,
        );
      } catch (err) {
        logger.warn("保存 blocks 到后端失败", err);
      }
    }
  } finally {
    _saveIsFlushing = false;
    // 如果在 flush 期间有新的待保存数据，递归处理
    if (hasPendingSave) {
      await flushSaveBlocks();
    }
  }
}

/**
 * think 标签提取器：从 text 块中解析  thinking... response 标签内容并转换为 thinking 块。
 * 当后端未通过 __pyapp_type: 'thinking' 发送推理内容时作兜底。
 * 支持跨多个文本块的 think 标签（流式传输场景）。
 */
function createThinkExtractor() {
  let thinkBuffer = "";
  let inThink = false;

  return {
    extract: function* (
      chunk: import("../services/chatService").StreamChunk,
    ): Generator<import("../services/chatService").StreamChunk, void, unknown> {
      if (chunk.type !== "text" || !chunk.content) {
        yield chunk;
        return;
      }

      const content = chunk.content;
      let remaining = content;
      let output = "";

      while (remaining.length > 0) {
        if (!inThink) {
          const thinkStart = remaining.indexOf("<think>");

          if (thinkStart === -1) {
            output += remaining;
            break;
          }

          // 输出 think 前的文本
          output += remaining.slice(0, thinkStart);
          remaining = remaining.slice(thinkStart + 7);
          inThink = true;
          thinkBuffer = "";
        }

        if (inThink) {
          const thinkEnd = remaining.indexOf("</think>");
          if (thinkEnd === -1) {
            // think 标签未闭合，缓冲剩余内容
            thinkBuffer += remaining;
            break;
          }

          // think 标签闭合，输出缓冲内容
          thinkBuffer += remaining.slice(0, thinkEnd);
          if (thinkBuffer) {
            yield { type: "thinking" as const, content: thinkBuffer };
          }
          thinkBuffer = "";
          inThink = false;
          remaining = remaining.slice(thinkEnd + 8);

          // 继续检查闭合后是否还有更多 think 标签
          continue;
        }
      }

      if (output) {
        yield { type: "text" as const, content: output };
      }
    },
    flush: function* (): Generator<
      import("../services/chatService").StreamChunk,
      void,
      unknown
    > {
      if (inThink && thinkBuffer) {
        yield { type: "thinking" as const, content: thinkBuffer };
        inThink = false;
        thinkBuffer = "";
      }
    },
  };
}

export const useChatStore = create<ChatStore>((set, get) => ({
  messages: [],
  isSending: false,
  isInputBlocked: false,
  isStreaming: false,
  streamingStatus: "",
  executionPhase: null,
  error: null,
  replyMessage: null,
  pendingReplyToId: null,
  editTarget: null,
  previewFile: null,
  sessionFiles: [],
  isUploading: false,
  abortController: null,
  messageQueue: [],
  hasPendingQuestion: false,

  addMessage: (message: Message) => {
    set({ messages: [...get().messages, message] });
  },

  sendMessage: async (content: string, sessionId?: string) => {
    // 消息排队模式：流式输出中不阻塞，加入队列
    const messageQueueEnabled = useFeatureFlagStore.getState().flags.message_queue;
    if (messageQueueEnabled && get().isStreaming) {
      get().enqueueMessage(content, sessionId);
      return;
    }

    // 标记当前 session 缓存为 stale（发送新消息后缓存将过期）
    const state = get();
    const currentSid = sessionId ?? state.messages[0]?.session_id ?? '';
    if (currentSid) _sessionMessageCache.delete(currentSid);

    set({ isSending: true, isInputBlocked: !messageQueueEnabled, error: null });

    const pendingReplyId = get().pendingReplyToId;
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: Date.now(),
      session_id: sessionId || "default",
      replyToId: pendingReplyId || undefined,
    };
    // 使用后清除
    if (pendingReplyId) {
      set({ pendingReplyToId: null });
    }

    set({ messages: [...get().messages, userMessage] });

    try {
      const response = await chatService.sendMessage(content, sessionId);

      // 检测非流式路径的待处理交互
      if ((response as Message & { pendingInteraction?: unknown }).pendingInteraction) {
        const pi = (response as Message & { pendingInteraction: import("../services/chatService").QuestionData }).pendingInteraction;
        const builder = new ChronologicalBlockBuilder();
        builder.addQuestion(pi);
        const blocks = builder.getBlocks();
        const questionMessage: Message = {
          id: response.id,
          role: "assistant",
          content: "",
          timestamp: Date.now(),
          session_id: sessionId || "default",
          blocks,
        };
        set({
          messages: [...get().messages, questionMessage],
          isSending: false,
          isInputBlocked: false,
        });
        return;
      }

      const newMessages = [...get().messages, response];

      // 先重置 isSending/isInputBlocked，UI 立刻响应
      set({ messages: newMessages, isSending: false, isInputBlocked: false });

      // 再执行自动重命名（不阻塞 UI 状态）
      if (shouldAutoRename(sessionId)) {
        doAutoRename(sessionId!, content, (response as Message).content).catch(
          (e) => logger.warn("自动重命名失败", e),
        );
      }
    } catch (error) {
      set({ error: String(error), isSending: false, isInputBlocked: false });
    }
  },

  /**
   * 将消息加入队列，待当前流式任务完成后自动发送
   * 仅在 message_queue Feature Flag 开启时由 sendMessage 自动调用
   */
  enqueueMessage: (content: string, sessionId?: string) => {
    const currentQueue = get().messageQueue;
    set({
      messageQueue: [...currentQueue, { content, sessionId }],
      // 排队后仍保持 isSending 状态，不阻塞输入
    });
  },

  /**
   * 消费队列中的下一条消息，自动发送
   * 在流式输出结束后自动调用
   */
  dequeueAndSend: async (sessionId?: string) => {
    const queue = get().messageQueue;
    if (queue.length === 0) return;

    const next = queue[0];
    const remaining = queue.slice(1);
    set({ messageQueue: remaining });

    // 递归调用 sendMessage，如果队列中还有更多消息，sendMessage 会自动继续排队
    await get().sendMessage(next.content, next.sessionId || sessionId);
  },

  streamMessage: async (content: string, sessionId?: string, workMode?: "plan" | "do") => {
    // J1: 取消上一个未完成的流式请求
    const prevController = get().abortController;
    if (prevController) {
      prevController.abort();
    }

    const abortController = new AbortController();

    const messageQueueEnabled = useFeatureFlagStore.getState().flags.message_queue;

    set({ isSending: true, isInputBlocked: !messageQueueEnabled, isStreaming: true, error: null, abortController });

    // 编辑消息：如果存在 editTarget，截断其后的消息
    const editTarget = get().editTarget;
    if (editTarget) {
      const editIndex = get().messages.findIndex((m) => m.id === editTarget.id);
      if (editIndex >= 0) {
        // 截断 editTarget 及其之后的所有消息
        const truncated = get().messages.slice(0, editIndex);
        set({ messages: truncated, editTarget: null });
      } else {
        set({ editTarget: null });
      }
    }

    // 消息排队：流结束后自动消费队列
    const tryDequeue = () => {
      if (messageQueueEnabled && get().messageQueue.length > 0) {
        get().dequeueAndSend(sessionId).catch(
          (e) => logger.warn("消息队列消费失败", e),
        );
      }
    };

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: Date.now(),
      session_id: sessionId || "default",
    };

    const assistantId = crypto.randomUUID();
    const assistantMessage: Message = {
      id: assistantId,
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      session_id: sessionId || "default",
      blocks: [],
    };

    set({ messages: [...get().messages, userMessage, assistantMessage] });

    // J3: 将模块级竞态变量改为闭包内的局部变量
    let saveBlocksTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingSaveSessionId: string | null = null;
    let pendingSaveMessageId: string | null = null;
    let pendingSaveBlocks: MessageBlock[] | null = null;

    const flushSaveBlocksLocal = async (): Promise<void> => {
      if (pendingSaveSessionId && pendingSaveMessageId && pendingSaveBlocks) {
        const sid = pendingSaveSessionId;
        const mid = pendingSaveMessageId;
        const blk = pendingSaveBlocks;
        pendingSaveSessionId = null;
        pendingSaveMessageId = null;
        pendingSaveBlocks = null;
        try {
          await chatService.updateMessageBlocks(
            sid,
            mid,
            blk as unknown as Array<Record<string, unknown>>,
          );
        } catch (err) {
          logger.warn("防抖保存 blocks 到后端失败", err);
        }
      }
    };

    const debouncedSaveBlocksLocal = (
      sid: string,
      mid: string,
      blk: MessageBlock[],
      immediate: boolean = false,
    ): void => {
      pendingSaveSessionId = sid;
      pendingSaveMessageId = mid;
      pendingSaveBlocks = blk;
      if (immediate) {
        // 关键节点即时落盘：tool_call 完成 / finish_reason 到达 / 截断
        // 确保切走时不丢失，符合"先落盘再渲染"原则（方案 C）
        if (saveBlocksTimer) clearTimeout(saveBlocksTimer);
        saveBlocksTimer = null;
        flushSaveBlocksLocal();
        return;
      }
      if (saveBlocksTimer) {
        clearTimeout(saveBlocksTimer);
      }
      saveBlocksTimer = setTimeout(() => {
        flushSaveBlocksLocal();
      }, 200); // 200ms 防抖，比 800ms 更及时
    };

    // J4: 批量 set 更新——使用版本号机制，防止过期 rAF 覆盖最终状态
    let batchVersion = 0;
    let batchPending = false;
    let latestMessages: Message[] | null = null;

    const flushSet = (currentVersion: number): void => {
      // 版本号检查：过期版本直接丢弃（流结束后旧 rAF 回调不覆盖最终状态）
      if (currentVersion < batchVersion) {
        logger.debug("flushSet: 版本过期丢弃", { currentVersion, batchVersion });
        batchPending = false;
        return;
      }

      if (latestMessages) {
        const questionCount = latestMessages.reduce((cnt, m) => {
          return cnt + (m.blocks?.filter((b) => b.type === "question").length ?? 0);
        }, 0);
        logger.debug("flushSet: 更新 store", {
          version: currentVersion,
          batchVersion,
          msgCount: latestMessages.length,
          questionBlocks: questionCount,
        });
        set({ messages: latestMessages });
        latestMessages = null;
      }
      batchPending = false;
    };

    try {
      const generator = chatService.streamMessage(
        content,
        sessionId,
        abortController.signal,
        workMode ? { workMode } : undefined,
      );
      const blockBuilder = new ChronologicalBlockBuilder();
      const extractor = createThinkExtractor();

      for await (const rawChunk of generator) {
        // 检查是否已被中止
        if (abortController.signal.aborted) break;

        const chunks = Array.from(extractor.extract(rawChunk));
        for (const chunk of chunks) {
          await processChunk(chunk);
        }
      }

      // 处理未闭合的 think 标签
      if (!abortController.signal.aborted) {
        for (const chunk of extractor.flush()) {
          await processChunk(chunk);
        }
      }

      async function processChunk(chunk: import("../services/chatService").StreamChunk) {
        const current = get().messages;
        const msgIdx = current.findIndex((m) => m.id === assistantId);

        if (msgIdx === -1) {
          logger.warn("processChunk: 未找到对应的 assistant 消息（assistantId=%s），跳过 chunk", assistantId);
          return;
        }

        const msg = current[msgIdx];
        let updatedMsg: Message;

        if (chunk.type === "thinking") {
          blockBuilder.addThinking(chunk.content, true);
          updatedMsg = { ...msg, blocks: blockBuilder.getBlocks() };
        } else if (chunk.type === "text") {
          blockBuilder.freezeThinking();
          blockBuilder.addText(chunk.content, true);
          updatedMsg = {
            ...msg,
            content: msg.content + chunk.content,
            blocks: blockBuilder.getBlocks(),
          };
        } else if (chunk.type === "status") {
          blockBuilder.addStatus(chunk.content);
          set({ streamingStatus: chunk.content });
          updatedMsg = { ...msg, blocks: blockBuilder.getBlocks() };
        } else if (chunk.type === "context_state") {
          // 上下文状态事件（压缩/召回等），使用 status 块渲染
          blockBuilder.addStatus(chunk.content);
          set({ streamingStatus: chunk.content });
          updatedMsg = { ...msg, blocks: blockBuilder.getBlocks() };
        } else if (chunk.type === "execution_phase" && chunk.executionPhase) {
          // 执行阶段推送：更新 executionPhase 状态 + 生成进度块
          const ep = chunk.executionPhase;
          const progressData: ProgressData = {
            phase: (ep.phase as ProgressData["phase"]) || "analyzing",
            progress: ep.progress || 0,
            description: ep.description || "",
            steps: (ep.steps as ProgressData["steps"]) || [],
            currentStep: ep.currentStep || "",
          };
          set({
            executionPhase: {
              phase: progressData.phase,
              progress: progressData.progress,
              description: progressData.description,
            },
          });
          blockBuilder.addProgress(progressData);
          updatedMsg = { ...msg, blocks: blockBuilder.getBlocks() };
        } else if (chunk.type === "error") {
          // 将错误信息显示在聊天界面中
          blockBuilder.addStatus(`❌ ${chunk.content}`);
          updatedMsg = {
            ...msg,
            content: msg.content + chunk.content,
            blocks: blockBuilder.getBlocks(),
          };
          set({ error: chunk.content });
        } else if (chunk.type === "tool_call" && chunk.toolCall) {
          // 实时转换：todo_write 的 tool_call 直接转 todo block，不等流结束
          let skipDefault = false;
          if (chunk.toolCall.name === "todo_write") {
            const args = chunk.toolCall.arguments as Record<string, unknown> | undefined;
            if (args?.action === "write" && args?.todos) {
              const todos = (args.todos as Array<Record<string, unknown>>) || [];
              const tasks = todos.map((t, idx) => ({
                id: String(t.id || idx + 1),
                name: String(t.name || t.content || `步骤 ${idx + 1}`),
                status: (t.status as TaskCardTask["status"]) || "pending",
                dependsOn: (t.dependsOn as string[]) || [],
              }));
              const title = String(
                args?.title ||
                (typeof args?.description === "string" ? args.description : "") ||
                `任务 (${todos.length} 步)`,
              );
              blockBuilder.addTodo({ title, tasks, status: "planning" });
              skipDefault = true;
            } else if (args?.action === "update") {
              // 实时更新单个任务状态：从 tool_call 参数中提取变更并应用到 todo block
              const taskId = String(args.todoId ?? args.id ?? "");
              if (taskId) {
                const updates: Partial<{ status: TaskCardTask["status"]; result: string; durationMs: number }> = {};
                if (args.status) updates.status = args.status as TaskCardTask["status"];
                if (args.result) updates.result = args.result as string;
                if (args.durationMs) updates.durationMs = args.durationMs as number;
                blockBuilder.updateTodoTask(taskId, updates);
              }
              skipDefault = true;
            }
          }
          // ask_user_question 的 tool_call：跳过默认 tool_call 渲染块，
          // 稍后将由 question 类型 chunk 渲染 QuestionBlock
          if (chunk.toolCall.name === "ask_user_question") {
            skipDefault = true;
          }
          if (!skipDefault) {
            blockBuilder.addToolCall(chunk.toolCall);
          }

          // 文件路径收集已移至流结束后的 addFilePathsFromBlocks 统一处理
          // 避免流式传输中同步 setState 导致无限重渲染

          updatedMsg = { ...msg, blocks: blockBuilder.getBlocks() };

          // 关键节点即时落盘：tool_call 完成时立即持久化 blocks
          // 防止切换会话时该 tool_call 结果丢失（方案 C）
          if (chunk.toolCall.status === 'completed' || chunk.toolCall.status === 'failed') {
            if (sessionId) {
              debouncedSaveBlocksLocal(sessionId, assistantId, blockBuilder.getBlocks(), true);
            }
          }
        } else if (chunk.type === "question" && chunk.questionData) {
          logger.debug("收到 question chunk", {
            questionId: chunk.questionData.questionId,
            q: chunk.questionData.question?.slice(0, 40),
            optCnt: chunk.questionData.options?.length,
            blocksBefore: blockBuilder.getBlocks().length,
          });
          blockBuilder.addQuestion(chunk.questionData);
          const newBlocks = blockBuilder.getBlocks();
          logger.debug("addQuestion 后 block count: " + newBlocks.length, {
            questionBlocks: newBlocks.filter((b) => b.type === "question").length,
          });
          updatedMsg = { ...msg, blocks: newBlocks };
          // 标记有待用户回答的 question
          get().hasPendingQuestion || set({ hasPendingQuestion: true });
          // 需要用户关注时播放警示音
          playWarningSound();
        } else if (chunk.type === "todo" && chunk.todoData) {
          blockBuilder.addTodo(chunk.todoData);
          updatedMsg = { ...msg, blocks: blockBuilder.getBlocks() };
        } else if (chunk.type === "usage") {
          // L5: 检测截断信号 finishReason='length'（修复 BUG #10）
          if (chunk.finishReason === 'length') {
            const truncatedSuffix = '\n\n> ⚠️ **AI 输出已被截断**（max_tokens 限制），请考虑分步提问或增大 max_tokens 设置。';
            blockBuilder.addText(truncatedSuffix, false);
            // 关键节点即时落盘：截断时立即持久化，确保截断前的 blocks 不丢失（方案 C）
            if (sessionId) {
              debouncedSaveBlocksLocal(sessionId, assistantId, blockBuilder.getBlocks(), true);
            }
          }
          // 仅当 chunk.usage 非空时更新 usage，避免 standalone finish_reason 覆盖已有数据（BUG #10 L2）
          const usageUpdate = chunk.usage ? { usage: chunk.usage } : {};
          updatedMsg = { ...msg, ...usageUpdate, blocks: blockBuilder.getBlocks() };
        } else {
          updatedMsg = msg;
        }

        const newMessages = [...current];
        newMessages[msgIdx] = updatedMsg;
        latestMessages = newMessages;

        // J4：批量更新——仅在无挂起 flush 时调度微任务
        if (!batchPending) {
          batchPending = true;
          Promise.resolve().then(() => requestAnimationFrame(() => flushSet(++batchVersion)));
        }

        // J3：流式传输中实时防抖保存 blocks，使用闭包内局部变量避免竞态
        if (sessionId && updatedMsg.blocks && updatedMsg.blocks.length > 0) {
          // 会话切换锁：setMessages 期间暂存流式 chunk，避免覆盖
          if (_sessionSwitchLock) {
            _pendingSwitchChunks.push({ sessionId, assistantId, blocks: updatedMsg.blocks });
          } else {
            debouncedSaveBlocksLocal(sessionId, assistantId, updatedMsg.blocks);
          }
          // 标记有未保存数据，保证 flushPendingSaves 仍可工作
          _pendingSaveSessionId = sessionId;
          _pendingSaveMessageId = assistantId;
          _pendingSaveBlocks = updatedMsg.blocks;
          hasPendingSave = true;
        }
      }

      // J3：清除局部防抖定时器，确保最终 blocks 被保存
      if (saveBlocksTimer) {
        clearTimeout(saveBlocksTimer);
        saveBlocksTimer = null;
      }
      hasPendingSave = false;
      await flushSaveBlocksLocal();

      // 流结束，冻结所有块
      blockBuilder.freezeAll();
      const finalBlocks = blockBuilder.getBlocks();

      // 版本号递增：使 pending 的 rAF flushSet 全部失效，
      // 旧版本的回调被丢弃，不再覆盖最终状态
      batchVersion++;
      latestMessages = null;
      batchPending = false;

      // 检查最终 blocks 中是否有 question 块，更新 hasPendingQuestion
      const hasQuestion = finalBlocks.some((b) => b.type === "question");
      set({ hasPendingQuestion: hasQuestion });

      // 流完成提示音（仅当无待回答 question 时播放）
      if (!hasQuestion) {
        playCompletionSound();
      }

      // 立即重置流式状态，让 UI 立刻响应（ThinkingBlock 收缩、tool_call 停止旋转）
      // 不等待 updateMessageBlocks 和 doAutoRename 完成
      // 保留 executionPhase 用于 StatusFloatBar 渐隐动画，下轮流会在 execution_phase chunk 中覆盖
      set({ isSending: false, isInputBlocked: false, isStreaming: false, streamingStatus: "", abortController: null });

      // 构建最终消息并写入 store
      const finalMessages = get().messages;
      const finalMsgIdx = finalMessages.findIndex((m) => m.id === assistantId);
      if (finalMsgIdx !== -1) {
        const msg = { ...finalMessages[finalMsgIdx], blocks: finalBlocks };
        set({ messages: finalMessages.map((m) => (m.id === assistantId ? msg : m)) });

        addFilePathsFromBlocks(finalBlocks, (file) =>
          get().addSessionFile(file),
        );

        // 将 blocks 结构保存到后端
        if (sessionId && finalBlocks.length > 0) {
          try {
            await chatService.updateMessageBlocks(
              sessionId,
              assistantId,
              finalBlocks as unknown as Array<Record<string, unknown>>,
            );
          } catch (error) {
            logger.warn("Failed to update message blocks:", error);
          }
        }
      }

      // 再执行自动重命名（不阻塞 UI 状态）
      if (shouldAutoRename(sessionId)) {
        const finalMsgs = get().messages;
        const finalMI = finalMsgs.findIndex(
          (m) => m.id === assistantId,
        );
        const assistantResponse =
          finalMI !== -1 ? finalMsgs[finalMI].content : "";
        doAutoRename(sessionId!, content, assistantResponse).catch(
          (e) => logger.warn("流结束时自动重命名失败", e),
        );
      }

      // 消息排队：自动消费队列中的下一条消息
      tryDequeue();
    } catch (error) {
      if (!abortController.signal.aborted) {
        set({ error: String(error), isSending: false, isInputBlocked: false, isStreaming: false, streamingStatus: "", abortController: null });
      } else {
        set({ isSending: false, isInputBlocked: false, isStreaming: false, streamingStatus: "", abortController: null });
      }
      // 消息排队：即使出错也消费队列
      tryDequeue();
    }
  },

  clearMessages: () => {
    set({ messages: [], error: null });
  },

  /**
   * 重新生成上一条 AI 回复：
   * 找到 AI 消息之前的最后一条用户消息，重新发送
   */
  regenerateMessage: async (sessionId?: string) => {
    const { messages, isStreaming } = get();

    // 边界条件1：防止重复生成（流式输出中）
    if (isStreaming) {
      logger.warn("regenerateMessage: 流式输出中，忽略重新生成请求");
      return;
    }

    if (messages.length < 2) return;

    // 找到最后一条 user 消息
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        lastUserIdx = i;
        break;
      }
    }
    if (lastUserIdx === -1) return;

    const userMsg = messages[lastUserIdx];
    const content = typeof userMsg.content === "string" ? userMsg.content : "";

    // 边界条件2：空消息不重新生成
    if (!content.trim()) {
      logger.warn("regenerateMessage: 用户消息为空，跳过重新生成");
      return;
    }

    // 边界条件3：中止当前流式请求，防止冲突
    const prevController = get().abortController;
    if (prevController) {
      prevController.abort();
    }

    // 移除最后一条 assistant 及之后的所有消息（含可能的部分生成空消息），然后重新发送
    const truncated = messages.slice(0, lastUserIdx + 1);
    set({ messages: truncated, isStreaming: false, isSending: false, isInputBlocked: false, abortController: null });

    // 检测工作模式：若当前工作项活跃，传递 Plan/Do 模式到后端
    let workMode: "plan" | "do" | undefined;
    try {
      const { useWorkStore } = await import("./workStore");
      const workState = useWorkStore.getState();
      if (workState.activeWorkItem) {
        workMode = workState.mode;
      }
    } catch (err) {
      logger.warn("workStore 不可用", err);
    }

    try {
      await get().streamMessage(content, sessionId || userMsg.session_id, workMode);
    } catch (error) {
      logger.error("regenerateMessage: 重新生成失败", error);
      set({ error: String(error), isSending: false, isInputBlocked: false, isStreaming: false });
    }
  },

  /**
   * 重试出错的请求：传入出错的 assistant 消息 ID，找到前置用户消息重新发送
   */
  retryFromError: async (assistantMsgId: string, sessionId?: string) => {
    const { messages, isStreaming } = get();

    // 边界条件1：防止重复重试（流式输出中）
    if (isStreaming) {
      logger.warn("retryFromError: 流式输出中，忽略重试请求");
      return;
    }

    const aiIdx = messages.findIndex((m) => m.id === assistantMsgId);
    if (aiIdx === -1) return;

    // 向前找到最近的一条 user 消息
    let userMsgIdx = -1;
    for (let i = aiIdx - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        userMsgIdx = i;
        break;
      }
    }
    if (userMsgIdx === -1) return;

    const userMsg = messages[userMsgIdx];
    const content = typeof userMsg.content === "string" ? userMsg.content : "";

    // 边界条件2：空消息不重试
    if (!content.trim()) {
      logger.warn("retryFromError: 用户消息为空，跳过重试");
      return;
    }

    // 边界条件3：中止当前流式请求，防止冲突
    const prevController = get().abortController;
    if (prevController) {
      prevController.abort();
    }

    // 移除该用户消息及其之后的所有消息（含可能的部分生成空消息），然后重新发送
    const truncated = messages.slice(0, userMsgIdx + 1);
    set({ messages: truncated, isStreaming: false, isSending: false, isInputBlocked: false, abortController: null });

    try {
      await get().streamMessage(content, sessionId || userMsg.session_id);
    } catch (error) {
      logger.error("retryFromError: 重试失败", error);
      set({ error: String(error), isSending: false, isInputBlocked: false, isStreaming: false });
    }
  },

  /**
   * 取消当前流式请求（J1）
   */
  stopMessage: () => {
    const controller = get().abortController;
    if (controller) {
      controller.abort();
      set({ isStreaming: false, isSending: false, isInputBlocked: false, streamingStatus: "", abortController: null });
      // 消息排队：停止后也消费队列
      const messageQueueEnabled = useFeatureFlagStore.getState().flags.message_queue;
      if (messageQueueEnabled && get().messageQueue.length > 0) {
        get().dequeueAndSend().catch(
          (e) => logger.warn("停止后消息队列消费失败", e),
        );
      }
    }
  },

  setReplyMessage: (replyMessage: Message | null) => {
    set({ replyMessage });
  },

  /** 设置待编辑消息 */
  setEditTarget: (editTarget: Message | null) => {
    set({ editTarget });
  },

  setPreviewFile: (file) => {
    set({ previewFile: file });
  },

  addSessionFile: (file) => {
    const current = get().sessionFiles;
    const exists = current.some((f) => f.path === file.path);
    if (!exists) {
      logger.debug("addSessionFile: adding: " + file.path + " total after: " + (current.length + 1));
      set({ sessionFiles: [...current, file] });
    } else {
      logger.debug("addSessionFile: already exists:", file.path);
    }
  },

  clearSessionFiles: () => {
    set({ sessionFiles: [], previewFile: null });
  },

  readFileToPreview: async (filePath: string) => {
    try {
      const resolvedPath = await resolveFilePath(filePath);

      // 如果解析后的路径与传入路径不一致,自动更新 sessionFiles 中的记录
      if (resolvedPath !== filePath) {
        const currentFiles = get().sessionFiles;
        const idx = currentFiles.findIndex((f) => f.path === filePath);
        if (idx !== -1) {
          const updated = [...currentFiles];
          updated[idx] = {
            ...updated[idx],
            path: resolvedPath,
            name: extractFileName(resolvedPath),
          };
          set({ sessionFiles: updated });
        }
      }

      const existing = get().sessionFiles.find((f) => f.path === resolvedPath);
      if (existing && existing.content) {
        set({ previewFile: existing });
        return;
      }

      const ext = resolvedPath.toLowerCase().split('.').pop();
      const isOfficeFile = ext === 'pdf' || ext === 'docx' || ext === 'pptx';

      // Office 文件使用预览转换接口，其他文件使用普通读取接口
      const apiEndpoint = isOfficeFile ? '/api/file/preview' : '/api/file/read';
      const data = await http.get<{ content: string; type: string; language?: string; size?: number }>(apiEndpoint, { params: { path: resolvedPath } });
      const filePreview: FilePreview = {
        path: resolvedPath,
        name:
          resolvedPath.split("/").pop() ||
          resolvedPath.split("\\").pop() ||
          resolvedPath,
        content: data.content,
        type: (data.type && data.type !== "text" ? data.type : inferFileType(resolvedPath)) as FilePreview["type"],
        language: data.language,
        size: data.size,
      };
      // 如果 sessionFiles 中已有该文件（但 content 为空），替换其内容
      const currentFiles = get().sessionFiles;
      const existingIdx = currentFiles.findIndex((f) => f.path === resolvedPath);
      if (existingIdx !== -1) {
        const updated = [...currentFiles];
        updated[existingIdx] = filePreview;
        set({ sessionFiles: updated });
      } else {
        // 如果路径被后端纠正（resolvedPath !== filePath），尝试用原始路径查找并更新
        if (resolvedPath !== filePath) {
          const oldIdx = currentFiles.findIndex((f) => f.path === filePath);
          if (oldIdx !== -1) {
            const updated = [...currentFiles];
            updated[oldIdx] = filePreview;
            set({ sessionFiles: updated });
          } else {
            get().addSessionFile(filePreview);
          }
        } else {
          get().addSessionFile(filePreview);
        }
      }
      set({ previewFile: filePreview });
    } catch (err) {
      logger.error("读取文件失败:", err);
      set({
        previewFile: {
          path: filePath,
          name:
            filePath.split("/").pop() || filePath.split("\\").pop() || filePath,
          content: `错误: ${err instanceof Error ? err.message : String(err)}`,
          type: inferFileType(filePath),
        },
      });
    }
  },

  /**
   * 立即 flush 待保存的 blocks（用于切换会话前）
   * 避免防抖窗口内的 blocks 丢失导致下次进入历史时出现块割裂
   */
  flushPendingSaves: async (): Promise<void> => {
    if (hasPendingSave) {
      hasPendingSave = false;
      // 超时保护：最多等待 3 秒，防止 HTTP 挂起阻塞会话切换（方案 C）
      const timeout = new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('flushPendingSaves 超时')), 3000)
      );
      await Promise.race([flushSaveBlocks(), timeout]).catch((err) => {
        logger.warn('flushPendingSaves 超时或失败', { error: String(err) });
        // 超时后重置锁，让会话切换继续
        _saveIsFlushing = false;
      });
    }
  },

  /**
   * 加载历史消息时为 assistant 消息重建 blocks 结构
   * 确保 AssistantMessage 组件能正确分组渲染（text / tool_call 等）
   * 如果后端已保存 blocks，则直接使用，否则自动重建
   *
   * Fallback 重建策略（当后端未持久化 blocks 时）：
   *   1. 按 tool_calls 的顺序，在 content 字符串中查找对应的工具调用标记
   *   2. 工具调用前的文本 → 独立 text 块
   *   3. 每个 tool_call → tool_call 块
   *   4. 工具调用后到下一个 tool_call 之间的文本 → 独立 text 块
   *   5. 兜底：当无法定位边界时，按等分方式拆分
   */
  setMessages: (messages: Message[]) => {
    // 会话切换锁：挂起流式写入，防止 loadSessions 覆盖流式数据
    _sessionSwitchLock = true;

    // 缓存写入：仅当传入完整消息列表时（非空且非增量更新）
    // 使用第一条消息的 session_id 作为缓存 key
    if (messages.length > 0 && messages[0].session_id) {
      const cacheKey = messages[0].session_id;
      // LRU 淘汰：缓存超过上限时删除最旧的
      if (_sessionMessageCache.size >= MAX_CACHED_SESSIONS && !_sessionMessageCache.has(cacheKey)) {
        const oldest = _sessionMessageCache.keys().next().value;
        if (oldest) _sessionMessageCache.delete(oldest);
      }
      _sessionMessageCache.set(
        cacheKey,
        messages.slice(0, MAX_CACHED_MESSAGES_PER_SESSION),
      );
    }

    // Phase 1: 收集 tool 角色消息，建立 toolCallId → content 映射
    // 这些工具结果在后端作为独立消息持久化，前端需合并回 assistant 消息的 blocks 中
    const toolResultsByCallId = new Map<string, string>();
    const filteredMessages: Message[] = [];

    for (const msg of messages) {
      if (msg.role === "tool" && msg.toolCallId) {
        toolResultsByCallId.set(msg.toolCallId, msg.content);
      } else {
        filteredMessages.push(msg);
      }
    }

    // Phase 2: 合并连续的 assistant 消息
    // 多轮工具调用时，后端将每轮 LLM 回复存为独立 assistant 消息，
    // 导致加载历史后出现多个"🤖 Liri"气泡。此处合并为一条消息，与流式体验一致。
    const mergedMessages: Message[] = [];
    for (const msg of filteredMessages) {
      if (msg.role !== "assistant") {
        mergedMessages.push(msg);
        continue;
      }

      const lastIdx = mergedMessages.length - 1;
      const lastMsg = mergedMessages[lastIdx];
      if (lastMsg && lastMsg.role === "assistant") {
        mergedMessages[lastIdx] = {
          ...lastMsg,
          content: (lastMsg.content || "") + (msg.content || ""),
          timestamp: lastMsg.timestamp || msg.timestamp,
          blocks: [
            ...(lastMsg.blocks || []),
            ...(msg.blocks || []).map((b) => ({ ...b, isStreaming: false })),
          ],
          tool_calls: [
            ...(lastMsg.tool_calls || []),
            ...(msg.tool_calls || []),
          ],
        };
      } else {
        mergedMessages.push({ ...msg });
      }
    }

    // Phase 3: 处理合并后的消息，将工具结果合并到对应 assistant 消息的 tool_call 块中
    const enhancedMessages = mergedMessages.map((msg) => {
      if (msg.role !== "assistant") return msg;

      if (msg.blocks && msg.blocks.length > 0) {
        // 先处理已有 blocks：合并工具结果 + 迁移 groupId
        let hasMergedResult = false;
        const mergedBlocks = msg.blocks.map((b) => {
          const block = { ...b, isStreaming: false };
          if (
            block.type === "tool_call" &&
            block.toolCall?.id &&
            toolResultsByCallId.has(block.toolCall.id)
          ) {
            const resultContent = toolResultsByCallId.get(block.toolCall.id)!;
            hasMergedResult = true;
            block.toolCall = { ...block.toolCall, result: resultContent };
          }
          return block;
        });

        if (hasMergedResult) {
          return { ...msg, blocks: mergedBlocks };
        }

        // 无匹配工具结果时，执行 groupId 迁移（旧 blocks 兼容）
        const oldBlocksHaveGroupId = msg.blocks.some((b) => b.groupId);
        if (oldBlocksHaveGroupId) {
          return {
            ...msg,
            blocks: msg.blocks.map((b) => ({ ...b, isStreaming: false })),
          };
        }
        const lastToolCallId = findLastToolCallId(msg);
        const enhancedBlocks = msg.blocks.map((b) => {
          if (b.groupId) return { ...b, isStreaming: false };
          const id =
            b.toolCallId ||
            b.toolCall?.id ||
            lastToolCallId ||
            generateGroupId();
          return { ...b, isStreaming: false, groupId: "migrate_" + id };
        });
        return { ...msg, blocks: enhancedBlocks };
      }

      const newBlocks = rebuildBlocksFromContent(msg);
      return { ...msg, blocks: newBlocks };
    });

    // Phase 4: 从历史消息中的 tool_call 块 + AI 回复文本中提取文件路径
    const sessionFilesList: FilePreview[] = [];
    const addedPaths = new Set<string>();

    for (const msg of enhancedMessages) {
      if (msg.role === "assistant" && msg.blocks) {
        addFilePathsFromBlocks(msg.blocks, (file) => {
          if (!addedPaths.has(file.path)) {
            addedPaths.add(file.path);
            sessionFilesList.push(file);
          }
        });
      }
    }

    // 检测是否有待用户回答的 question 块
    const hasQuestion = enhancedMessages.some(
      (m) => m.blocks?.some((b) => b.type === "question"),
    );

    if (sessionFilesList.length > 0) {
      const currentFiles = get().sessionFiles;
      const merged = [...currentFiles];
      for (const file of sessionFilesList) {
        if (!merged.some((f) => f.path === file.path)) {
          merged.push(file);
        }
      }
      set({ messages: enhancedMessages, sessionFiles: merged, hasPendingQuestion: hasQuestion });
    } else {
      set({ messages: enhancedMessages, hasPendingQuestion: hasQuestion });
    }

    // 释放会话切换锁，并刷新暂存的流式 chunk
    _sessionSwitchLock = false;
    if (_pendingSwitchChunks.length > 0) {
      // 暂存 chunk 的 sessionId 可能与当前会话不一致（跨会话切换），只标记待保存
      const lastChunk = _pendingSwitchChunks[_pendingSwitchChunks.length - 1];
      _pendingSaveSessionId = lastChunk.sessionId;
      _pendingSaveMessageId = lastChunk.assistantId;
      _pendingSaveBlocks = lastChunk.blocks;
      hasPendingSave = true;
      _pendingSwitchChunks = [];
    }
  },
}));

// 注册 chat 端操作供 sessionStore 通过协调器访问
registerChatOperations({
  clearMessages: () => useChatStore.getState().clearMessages(),
  stopMessage: () => useChatStore.getState().stopMessage(),
  flushPendingSaves: () => useChatStore.getState().flushPendingSaves(),
  setMessages: (messages) => useChatStore.getState().setMessages(messages),
});

// 状态变更日志（仅开发环境）
import { withStoreLogging } from "../utils/storeLogger";
withStoreLogging(useChatStore, "chatStore", []);

/**
 * 查找消息中最后一个 tool_call 的 id
 */
function findLastToolCallId(msg: Message): string | undefined {
  if (msg.tool_calls && msg.tool_calls.length > 0) {
    return msg.tool_calls[msg.tool_calls.length - 1].id;
  }
  if (msg.blocks) {
    for (let i = msg.blocks.length - 1; i >= 0; i--) {
      const b = msg.blocks[i];
      if (b.toolCallId) return b.toolCallId;
      if (b.toolCall?.id) return b.toolCall.id;
    }
  }
  return undefined;
}

/**
 * 规范化 tool_call 格式：将 OpenAI 格式 {id, type: 'function', function: {name, arguments: string}}
 * 转换为前端 ToolCall 格式 {id, name, arguments: Record}
 */
function normalizeToolCall(tc: unknown): ToolCall {
  const obj = tc as Record<string, unknown>;
  if (obj && obj.type === "function" && obj.function && typeof obj.function === "object") {
    const fn = obj.function as Record<string, unknown>;
    const rawArgs = fn.arguments;
    let parsedArgs: Record<string, unknown> = {};
    try {
      parsedArgs = typeof rawArgs === "string" ? JSON.parse(rawArgs || "{}") : (rawArgs as Record<string, unknown>) || {};
    } catch (err) {
      logger.warn("tool_call 参数 JSON 解析失败", err);
      parsedArgs = { raw: rawArgs };
    }
    return {
      id: (obj.id as string) || "",
      name: (fn.name as string) || "",
      arguments: parsedArgs,
      status: (obj.status as "running" | "completed" | "failed") || undefined,
    };
  }
  return tc as ToolCall;
}

/**
 * 智能重建 blocks：基于 content + tool_calls 还原时序
 * 对标流式 ChronologicalBlockBuilder 的输出结构，分配 groupId 确保分组正确
 */
function rebuildBlocksFromContent(msg: Message): MessageBlock[] {
  // 守卫：如果消息已有 blocks，直接返回，不再重建
  if (msg.blocks && msg.blocks.length > 0) {
    return msg.blocks.map((b) => ({ ...b, isStreaming: false }));
  }

  const newBlocks: MessageBlock[] = [];
  const rawToolCalls = msg.tool_calls || [];
  // 统一规范化 tool_calls 格式
  const toolCalls = rawToolCalls.map(normalizeToolCall);
  const fullText = typeof msg.content === "string" ? msg.content : "";
  let remainingText = fullText;

  // 从 content 中提取 <think> 标签内容作为 thinking 块（切换会话后还原流式思考过程）
  const thinkMatch = remainingText.match(/<think>([\s\S]*?)<\/think>/);
  if (thinkMatch) {
    newBlocks.push({
      id: generateBlockId(),
      type: "thinking",
      content: thinkMatch[1].trim(),
      isStreaming: false,
      groupId: generateGroupId(),
    });
    // 移除已提取的 <think> 内容，剩余部分继续处理
    remainingText = remainingText.replace(thinkMatch[0], "").trim();
  }

  if (toolCalls.length === 0) {
    if (remainingText) {
      newBlocks.push({
        id: generateBlockId(),
        type: "text",
        content: fullText,
        isStreaming: false,
        groupId: generateGroupId(),
      });
    }
    return newBlocks;
  }

  const boundaries: Array<{ idx: number; pos: number; len: number } | null> = toolCalls.map((tc) => {
    const name = tc.name;
    if (!name) return null;
    const candidates = [
      `\`${name}\``,
      `「${name}」`,
      `${name} 工具`,
      `${name}工具`,
      name,
    ];
    for (const c of candidates) {
      const pos = fullText.indexOf(c);
      if (pos !== -1) return { idx: -1, pos, len: c.length };
    }
    return null;
  });

  // 填充 tool_call index
  let boundaryIdx = 0;
  for (const b of boundaries) {
    if (b) b.idx = boundaryIdx;
    boundaryIdx++;
  }

  const allUnknown = boundaries.every((b) => b === null);
  if (allUnknown) {
    // 当无法在文本中定位工具名边界时，放弃等分猜测（必然产生错乱块）。
    // 将所有文本作为一个 text block，tool_call 依次追加在后面。
    // 虽无法精确还原 text/tool_call 的交错顺序，但至少不会数据错乱。
    const gid = generateGroupId();
    if (fullText && fullText.trim()) {
      newBlocks.push({
        id: generateBlockId(),
        type: "text",
        content: fullText,
        isStreaming: false,
        groupId: gid,
      });
    }
    for (let i = 0; i < toolCalls.length; i++) {
      newBlocks.push({
        id: generateBlockId(),
        type: "tool_call",
        content: "",
        toolCall: toolCalls[i],
        isStreaming: false,
        toolCallId: toolCalls[i].id,
        groupId: gid,
      });
    }
    return newBlocks;
  }

  const indexedBoundaries = boundaries
    .filter((x): x is NonNullable<typeof x> => x !== null && x.pos !== -1)
    .sort((a, b) => a.pos - b.pos);

  let cursor = 0;
  for (const { pos, idx, len } of indexedBoundaries) {
    const gid = generateGroupId();
    const before = fullText.slice(cursor, pos);

    if (before && before.trim()) {
      newBlocks.push({
        id: generateBlockId(),
        type: "text",
        content: before,
        isStreaming: false,
        groupId: gid,
      });
    }
    newBlocks.push({
      id: generateBlockId(),
      type: "tool_call",
      content: "",
      toolCall: toolCalls[idx],
      isStreaming: false,
      toolCallId: toolCalls[idx].id,
      groupId: gid,
    });
    cursor = pos + len;
  }

  const tail = fullText.slice(cursor);
  if (tail && tail.trim()) {
    newBlocks.push({
      id: generateBlockId(),
      type: "text",
      content: tail,
      isStreaming: false,
      groupId: generateGroupId(),
    });
  }

  // 处理未能定位到边界的 tool_calls
  // 连续多个无法定位的 tool_call 使用相同 groupId 以便 ToolExecutionGroup 统一折叠
  let orphanGroupId = "";
  for (let i = 0; i < toolCalls.length; i++) {
    if (boundaries[i] === null) {
      // 每遇到一个新的 orphan 段，生成新 groupId
      if (!orphanGroupId) {
        orphanGroupId = generateGroupId();
      }
      newBlocks.push({
        id: generateBlockId(),
        type: "tool_call",
        content: "",
        toolCall: toolCalls[i],
        isStreaming: false,
        toolCallId: toolCalls[i].id,
        groupId: orphanGroupId,
      });
    } else {
      // 遇到有边界的 tool_call，重置 orphanGroupId（下一个 orphan 从新组开始）
      orphanGroupId = "";
    }
  }

  // 将 todo_write 的 tool_call 块替换为 todo 块（历史兼容）
  for (let i = 0; i < newBlocks.length; i++) {
    const block = newBlocks[i];
    if (block.type === "tool_call" && block.toolCall?.name === "todo_write") {
      const args = block.toolCall.arguments as Record<string, unknown> | undefined;
      if (args?.action === "write" && args?.todos) {
        const todos = args.todos as Array<{
          id?: string; name?: string; status?: string;
          dependsOn?: string[]; activeForm?: string; metadata?: Record<string, unknown>;
        }>;
        if (Array.isArray(todos) && todos.length > 0) {
          // 兼容 content 字段（TodoWriteTool 内部字段名）和 name 字段
          const taskName = (t: { name?: string; content?: string }, idx: number) =>
            t.name || t.content || `步骤 ${idx + 1}`;
          const tasks = todos.map((t, idx) => ({
            id: t.id || String(idx + 1),
            name: taskName(t, idx),
            status: (t.status as "pending" | "in_progress" | "completed") || "pending",
            dependsOn: t.dependsOn || [],
          }));
          const title =
            (args?.title as string) ||
            (typeof args?.description === "string" ? args.description : "") ||
            `任务 (${todos.length} 步)`;
          newBlocks[i] = {
            ...block,
            type: "todo",
            content: title,
            taskCard: { title, tasks, status: "planning" as const },
          };
        }
      }
    }
  }

  return newBlocks;
}
