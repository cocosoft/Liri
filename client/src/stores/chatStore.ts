import { create } from "zustand";
import { Message, MessageBlock, FilePreview } from "../types";
import type { ToolCall } from "../types";
import { chatService } from "../services/chatService";
import { getBackendBaseUrl } from "../services/backendUrl";
import { resolveFilePath } from "../services/filePathResolver";
import { useSessionStore } from "./sessionStore";

/**
 * 已知的文件写入/编辑类工具名称集合
 * 这些工具的 arguments 中包含 file_path/path 字段
 */
const FILE_WRITING_TOOLS = new Set([
  "file_write",
  "file_edit",
  "file_create",
  "write",
  "create_file",
  "edit_file",
]);

/**
 * 从工具调用中提取文件路径
 * @returns 文件路径字符串，若当前工具非文件写入类则返回 null
 */
function extractFilePathFromToolCall(toolCall: ToolCall): string | null {
  if (!FILE_WRITING_TOOLS.has(toolCall.name)) return null;

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
          type: "text",
        });
      }
    }
  }
}

interface ChatStore {
  messages: Message[];
  isLoading: boolean;
  isStreaming: boolean;
  error: string | null;
  replyMessage: Message | null;
  /** 当前预览的文件 */
  previewFile: FilePreview | null;
  /** 当前会话中生成的文件列表 */
  sessionFiles: FilePreview[];
  addMessage: (message: Message) => void;
  sendMessage: (content: string, sessionId?: string) => Promise<void>;
  streamMessage: (content: string, sessionId?: string) => Promise<void>;
  clearMessages: () => void;
  setMessages: (messages: Message[]) => void;
  setReplyMessage: (message: Message | null) => void;
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
 * 判断是否需要自动重命名会话
 * 优先从 currentSession 查找，若 sessionId 不匹配则降级到 sessions 列表中查找
 */
function shouldAutoRename(sessionId?: string): boolean {
  if (!sessionId) {
    console.log("[shouldAutoRename] sessionId is undefined");
    return false;
  }

  const store = useSessionStore.getState();

  // 优先从 currentSession 查找
  if (store.currentSession?.id === sessionId) {
    const title = store.currentSession.title || "";
    const shouldRename =
      title.startsWith("新会话") || title.startsWith("New Session");
    console.log(
      "[shouldAutoRename] title:",
      title,
      "shouldRename:",
      shouldRename,
    );
    return shouldRename;
  }

  // 降级：从 sessions 列表中按 sessionId 查找
  const found = store.sessions.find((s) => s.id === sessionId);
  if (found) {
    const title = found.title || "";
    const shouldRename =
      title.startsWith("新会话") || title.startsWith("New Session");
    console.log(
      "[shouldAutoRename] fallback found, title:",
      title,
      "shouldRename:",
      shouldRename,
    );
    return shouldRename;
  }

  console.log("[shouldAutoRename] session not found for id:", sessionId);
  return false;
}

async function doAutoRename(
  sessionId: string,
  userMessage: string,
  assistantResponse: string,
): Promise<void> {
  console.log("[doAutoRename] Starting auto-rename for session:", sessionId);
  console.log("[doAutoRename] User message:", userMessage.slice(0, 50), "...");

  try {
    const title = await sessionService.generateTitle(
      sessionId,
      userMessage,
      assistantResponse,
    );
    console.log("[doAutoRename] Backend returned title:", title);

    if (title) {
      console.log("[doAutoRename] Renaming session to:", title);
      useSessionStore.getState().renameSession(sessionId, title);
    } else {
      console.log("[doAutoRename] Backend returned null, using fallback");
      const fallbackTitle =
        userMessage.length > 30 ? userMessage.slice(0, 30) + "…" : userMessage;
      useSessionStore.getState().renameSession(sessionId, fallbackTitle);
    }
  } catch (error) {
    console.warn(
      "[doAutoRename] Failed to generate title from backend, using fallback",
      error,
    );
    const fallbackTitle =
      userMessage.length > 30 ? userMessage.slice(0, 30) + "…" : userMessage;
    useSessionStore.getState().renameSession(sessionId, fallbackTitle);
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

  /** 添加状态块，连续重复时去重 */
  addStatus(status: string): void {
    const lastBlock = this.blocks[this.blocks.length - 1];
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
      existing.toolCall = {
        ...toolCall,
        status: toolCall.status || ("completed" as const),
      };
      existing.isStreaming = toolCall.status === "running";
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

  /** 冻结所有块 */
  freezeAll(): void {
    for (const block of this.blocks) {
      block.isStreaming = false;
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
let _saveBlocksTimer: ReturnType<typeof setTimeout> | null = null;
let _pendingSaveSessionId: string | null = null;
let _pendingSaveMessageId: string | null = null;
let _pendingSaveBlocks: MessageBlock[] | null = null;

async function flushSaveBlocks(): Promise<void> {
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
    } catch {
      // 保存失败不影响主流程
    }
  }
}

function debouncedSaveBlocks(
  sessionId: string,
  messageId: string,
  blocks: MessageBlock[],
): void {
  _pendingSaveSessionId = sessionId;
  _pendingSaveMessageId = messageId;
  _pendingSaveBlocks = blocks;
  if (_saveBlocksTimer) {
    clearTimeout(_saveBlocksTimer);
  }
  _saveBlocksTimer = setTimeout(() => {
    flushSaveBlocks();
  }, 800);
}

export const useChatStore = create<ChatStore>((set, get) => ({
  messages: [],
  isLoading: false,
  isStreaming: false,
  error: null,
  replyMessage: null,
  previewFile: null,
  sessionFiles: [],

  addMessage: (message: Message) => {
    set({ messages: [...get().messages, message] });
  },

  sendMessage: async (content: string, sessionId?: string) => {
    set({ isLoading: true, error: null });

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: Date.now(),
      session_id: sessionId || "default",
    };

    set({ messages: [...get().messages, userMessage] });

    try {
      const response = await chatService.sendMessage(content, sessionId);
      set({
        messages: [...get().messages, response],
        isLoading: false,
      });
      if (shouldAutoRename(sessionId)) {
        await doAutoRename(sessionId!, content, response.content);
      }
    } catch (error) {
      set({ error: String(error), isLoading: false });
    }
  },

  streamMessage: async (content: string, sessionId?: string) => {
    set({ isLoading: true, isStreaming: true, error: null });

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

    try {
      const generator = chatService.streamMessage(content, sessionId);
      const blockBuilder = new ChronologicalBlockBuilder();

      for await (const chunk of generator) {
        const current = get().messages;
        const msgIdx = current.findIndex((m) => m.id === assistantId);

        if (msgIdx === -1) continue;

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
          updatedMsg = { ...msg, blocks: blockBuilder.getBlocks() };
        } else if (chunk.type === "tool_call" && chunk.toolCall) {
          blockBuilder.addToolCall(chunk.toolCall);

          const filePath = extractFilePathFromToolCall(chunk.toolCall);
          if (filePath) {
            const name = extractFileName(filePath);
            get().addSessionFile({
              path: filePath,
              name,
              content: "",
              type: "text",
            });
          }

          updatedMsg = { ...msg, blocks: blockBuilder.getBlocks() };
        } else if (chunk.type === "usage" && chunk.usage) {
          updatedMsg = { ...msg, usage: chunk.usage };
        } else {
          updatedMsg = msg;
        }

        const newMessages = [...current];
        newMessages[msgIdx] = updatedMsg;
        set({ messages: newMessages });

        // 流式传输中实时防抖保存 blocks，避免用户提前切换会话时丢失
        if (sessionId && updatedMsg.blocks && updatedMsg.blocks.length > 0) {
          debouncedSaveBlocks(sessionId, assistantId, updatedMsg.blocks);
        }
      }

      // 清除防抖定时器，确保最终 blocks 被保存
      if (_saveBlocksTimer) {
        clearTimeout(_saveBlocksTimer);
        _saveBlocksTimer = null;
      }
      await flushSaveBlocks();

      // 流结束，冻结所有块
      blockBuilder.freezeAll();
      const finalBlocks = blockBuilder.getBlocks();

      const finalMessages = get().messages;
      const finalMsgIdx = finalMessages.findIndex((m) => m.id === assistantId);
      if (finalMsgIdx !== -1) {
        const newMessages = [...finalMessages];
        newMessages[finalMsgIdx] = {
          ...finalMessages[finalMsgIdx],
          blocks: finalBlocks,
        };
        set({ messages: newMessages });

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
            console.warn("[chatStore] Failed to update message blocks:", error);
          }
        }
      }

      set({ isLoading: false, isStreaming: false });

      if (shouldAutoRename(sessionId)) {
        const finalMessages = get().messages;
        const finalMsgIdx = finalMessages.findIndex(
          (m) => m.id === assistantId,
        );
        const assistantResponse =
          finalMsgIdx !== -1 ? finalMessages[finalMsgIdx].content : "";
        await doAutoRename(sessionId!, content, assistantResponse);
      }
    } catch (error) {
      set({ error: String(error), isLoading: false, isStreaming: false });
    }
  },

  clearMessages: () => {
    set({ messages: [], error: null });
  },

  setReplyMessage: (replyMessage: Message | null) => {
    set({ replyMessage });
  },

  setPreviewFile: (file) => {
    set({ previewFile: file });
  },

  addSessionFile: (file) => {
    const current = get().sessionFiles;
    const exists = current.some((f) => f.path === file.path);
    if (!exists) {
      console.log(
        "[addSessionFile] adding:",
        file.path,
        "total after:",
        current.length + 1,
      );
      set({ sessionFiles: [...current, file] });
    } else {
      console.log("[addSessionFile] already exists:", file.path);
    }
  },

  clearSessionFiles: () => {
    set({ sessionFiles: [], previewFile: null });
  },

  readFileToPreview: async (filePath: string) => {
    try {
      const resolvedPath = await resolveFilePath(filePath);

      const existing = get().sessionFiles.find((f) => f.path === resolvedPath);
      if (existing && existing.content) {
        set({ previewFile: existing });
        return;
      }

      const baseUrl = getBackendBaseUrl();
      const encodedPath = encodeURIComponent(resolvedPath);
      const res = await fetch(`${baseUrl}/api/file/read?path=${encodedPath}`);
      if (!res.ok) throw new Error(`读取文件失败: ${res.statusText}`);
      const data = await res.json();
      const filePreview: FilePreview = {
        path: resolvedPath,
        name:
          resolvedPath.split("/").pop() ||
          resolvedPath.split("\\").pop() ||
          resolvedPath,
        content: data.content,
        type: data.type || "text",
        language: data.language,
        size: data.size,
      };
      get().addSessionFile(filePreview);
      set({ previewFile: filePreview });
    } catch (err) {
      console.error("读取文件失败:", err);
      set({
        previewFile: {
          path: filePath,
          name:
            filePath.split("/").pop() || filePath.split("\\").pop() || filePath,
          content: `错误: ${err instanceof Error ? err.message : String(err)}`,
          type: "text",
        },
      });
    }
  },

  /**
   * 立即 flush 待保存的 blocks（用于切换会话前）
   * 避免防抖窗口内的 blocks 丢失导致下次进入历史时出现块割裂
   */
  flushPendingSaves: async (): Promise<void> => {
    if (_saveBlocksTimer) {
      clearTimeout(_saveBlocksTimer);
      _saveBlocksTimer = null;
      await flushSaveBlocks();
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

    if (sessionFilesList.length > 0) {
      const currentFiles = get().sessionFiles;
      const merged = [...currentFiles];
      for (const file of sessionFilesList) {
        if (!merged.some((f) => f.path === file.path)) {
          merged.push(file);
        }
      }
      set({ messages: enhancedMessages, sessionFiles: merged });
    } else {
      set({ messages: enhancedMessages });
    }
  },
}));

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
 * 智能重建 blocks：基于 content + tool_calls 还原时序
 * 对标流式 ChronologicalBlockBuilder 的输出结构，分配 groupId 确保分组正确
 */
function rebuildBlocksFromContent(msg: Message): MessageBlock[] {
  const newBlocks: MessageBlock[] = [];
  const toolCalls = msg.tool_calls || [];
  const fullText = typeof msg.content === "string" ? msg.content : "";

  if (toolCalls.length === 0) {
    if (fullText) {
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

  const boundaries: number[] = toolCalls.map((tc) => {
    const name = tc.name;
    if (!name) return -1;
    const candidates = [
      name,
      `\`${name}\``,
      `「${name}」`,
      `${name} 工具`,
      `${name}工具`,
    ];
    for (const c of candidates) {
      const idx = fullText.indexOf(c);
      if (idx !== -1) return idx;
    }
    return -1;
  });

  const allUnknown = boundaries.every((b) => b === -1);
  if (allUnknown) {
    const segment = Math.floor(fullText.length / (toolCalls.length + 1));
    let cursor = 0;
    for (let i = 0; i < toolCalls.length; i++) {
      const gid = generateGroupId();
      const slice = fullText.slice(cursor, cursor + segment);

      if (slice && slice.trim()) {
        newBlocks.push({
          id: generateBlockId(),
          type: "text",
          content: slice,
          isStreaming: false,
          groupId: gid,
        });
      }
      newBlocks.push({
        id: generateBlockId(),
        type: "tool_call",
        content: "",
        toolCall: toolCalls[i],
        isStreaming: false,
        toolCallId: toolCalls[i].id,
        groupId: gid,
      });
      cursor += segment;
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
    return newBlocks;
  }

  const indexedBoundaries = boundaries
    .map((b, idx) => ({ b, idx }))
    .filter((x) => x.b !== -1)
    .sort((a, b) => a.b - b.b);

  let cursor = 0;
  for (const { b, idx } of indexedBoundaries) {
    const gid = generateGroupId();
    const before = fullText.slice(cursor, b);

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
    const nameLen = toolCalls[idx].name?.length || 0;
    cursor = b + nameLen;
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

  for (let i = 0; i < toolCalls.length; i++) {
    if (boundaries[i] === -1) {
      newBlocks.push({
        id: generateBlockId(),
        type: "tool_call",
        content: "",
        toolCall: toolCalls[i],
        isStreaming: false,
        toolCallId: toolCalls[i].id,
        groupId: generateGroupId(),
      });
    }
  }

  return newBlocks;
}
