/**
 * Chat Message Slice — 消息发送、流式响应、队列管理
 *
 * 核心 slice，包含流式聊天的主要逻辑。
 * 使用 Zustand StateCreator 模式。
 */
import type { StateCreator } from "zustand";
import { Message, MessageBlock, AttachedImage } from "@/types";
import type { FilePreview } from "@/types";
import type { FileSlice } from "./chat-file.slice";
import { chatService } from "@/services/chatService";
import { sessionService } from "@/services/sessionService";
import { useFeatureFlagStore } from "@/stores/featureFlags";
import { playWarningSound, playCompletionSound } from "@/services/SoundService";
import { createLogger } from "@/utils/logger";
import { useContextWatermarkStore } from "@/stores/contextWatermarkStore";
import { handleClientError } from "@/utils/handleError";
import {
  ChronologicalBlockBuilder,
  createThinkExtractor,
  generateGroupId,
  findLastToolCallId,
  rebuildBlocksFromContent,
  stripStructuralTags,
} from "./chat-toolcall.slice";
import { addFilePathsFromBlocks } from "./chat-file.slice";
import {
  doAutoRename,
  staleSessionCache,
  setSessionCache,
  flushSaveBlocks,
  getHasPendingSave,
  enqueueSaveBlocks,
  SaveQueue,
} from "./chat-history.slice";
import { chatCoordinator } from "./chatCoordinator";

const logger = createLogger("stores:chat:message");

// 会话切换锁：setMessages 期间挂起流式写入，避免 loadSessions 覆盖流式数据
let _sessionSwitchLock = false;
// 会话切换锁期间的暂存区
let _pendingSwitchChunks: Array<{
  sessionId: string;
  assistantId: string;
  blocks: MessageBlock[];
}> = [];

/**
 * 工具调用全量结果缓存。
 * 设计原则：block 中只存截断摘要（≤2000 字符），全量结果存此处。
 * 渲染时按需通过 toolCallId 获取，避免大内容（grep 全量匹配、file_read 整个文件）撑爆 DOM。
 */
const _toolResultFullCache = new Map<string, string>();
/** 全量结果缓存上限（LRU 淘汰，防止长对话内存无限增长） */
const MAX_TOOL_RESULT_CACHE = 500;

/** block 内联结果最大长度，超出部分截断 */
const MAX_INLINE_RESULT_LENGTH = 2000;

/** 截断工具结果字符串：保留前 N 字符 + 截断提示 */
function truncateResult(raw: string): string {
  if (raw.length <= MAX_INLINE_RESULT_LENGTH) return raw;
  const truncated = raw.slice(0, MAX_INLINE_RESULT_LENGTH);
  const lastNewline = truncated.lastIndexOf("\n");
  // 尽量在换行处截断，避免截断在行中间
  const cutPoint =
    lastNewline > MAX_INLINE_RESULT_LENGTH * 0.7
      ? lastNewline
      : MAX_INLINE_RESULT_LENGTH;
  return (
    raw.slice(0, cutPoint) +
    `\n...（共 ${raw.length.toLocaleString()} 字符，已截断，点击展开查看完整结果）`
  );
}

/** 获取工具调用的全量结果（用于渲染层按需展开） */
export function getToolResultFull(toolCallId: string): string | undefined {
  return _toolResultFullCache.get(toolCallId);
}

/** 清理全量工具结果缓存（setMessages 加载新会话前调用，防止内存泄漏） */
export function clearToolResultCache(): void {
  _toolResultFullCache.clear();
}

/** P2-2: 移除指定会话的流控制器，返回新对象（不可变更新） */
function removeStreamController(
  controllers: Record<string, AbortController>,
  sid: string,
): Record<string, AbortController> {
  const next = { ...controllers };
  delete next[sid];
  return next;
}

/** Message Slice 状态和操作 */
export interface MessageSlice {
  messages: Message[];
  isSending: boolean;
  isInputBlocked: boolean;
  isStreaming: boolean;
  /** 流式响应实时状态文本，用于 ChatInput 状态栏显示 */
  streamingStatus: string;
  /** 按会话记录是否有待回答的 question 块（P2-3：多会话并行互不串扰） */
  hasPendingQuestion: Record<string, boolean>;
  /** 执行阶段追踪数据，由后端 ExecutionPhaseTracker 通过流式事件推送 */
  executionPhase: {
    phase:
      | "analyzing"
      | "designing"
      | "implementing"
      | "verifying"
      | "presenting"
      | null;
    progress: number;
    description: string;
  } | null;
  error: string | null;
  /** 结构化错误码 — SSE 协议增强 (CS02)，替代 ChatArea 字符串匹配 */
  errorCode: string | null;
  replyMessage: Message | null;
  /** 待设置的回复引用 ID（streamMessage 中创建用户消息时读取） */
  pendingReplyToId: string | null;
  /** 正在编辑的消息（用户消息） */
  editTarget: Message | null;
  /**
   * 流控制器索引（P2-2 多会话并行）：sessionId → AbortController。
   * 取代原单一 abortController —— 不同会话的流互不中止，可并行流式。
   */
  streamControllers: Record<string, AbortController>;
  /** 消息队列：流式输出中用户发送的新消息（放开输入限制后使用） */
  messageQueue: Array<{ content: string; sessionId?: string }>;
  /** P2-6: 中止恢复提示 — 上次任务被中止，有可恢复的检查点 */
  recoverySessionId: string | null;

  addMessage: (message: Message) => void;
  sendMessage: (content: string, sessionId?: string) => Promise<void>;
  /** 将消息加入队列（流式输出中不阻塞输入） */
  enqueueMessage: (content: string, sessionId?: string) => void;
  /** 消费队列中的下一条消息 */
  dequeueAndSend: (sessionId?: string) => Promise<void>;
  streamMessage: (
    content: string,
    sessionId?: string,
    workMode?: "plan" | "do",
    attachedImages?: AttachedImage[],
  ) => Promise<void>;
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
  flushPendingSaves: () => Promise<void>;
  /** 删除单条消息（乐观更新） */
  deleteMessage: (messageId: string) => Promise<void>;
  /** 回退到指定消息之前 */
  rollbackToMessage: (messageId: string) => Promise<{
    messages: Array<Record<string, unknown>>;
    remainingRollbacks: number;
    undoResults?: Array<{ roundId: number; success: boolean; error?: string }>;
  }>;
  /** 回退前快照（用于撤销回退） */
  rollbackSnapshot: Message[] | null;
  /** 撤销最近一次回退（恢复快照中的消息） */
  restoreRollback: () => void;
  /** P2-6: 检查是否有可恢复的中止检查点 */
  checkAbortRecovery: (sessionId: string) => Promise<boolean>;
  /** P2-6: 关闭恢复提示并清理检查点 */
  dismissRecovery: () => void;
  /** P2-6: 用户确认恢复 — 关闭提示并继续之前被中止的会话 */
  resumeRecovery: (sessionId: string) => void;
}

/**
 * 创建 Message Slice（Zustand StateCreator 模式）
 */
export const createMessageSlice: StateCreator<
  MessageSlice & FileSlice,
  [],
  [],
  MessageSlice
> = (set, get) => ({
  messages: [],
  isSending: false,
  isInputBlocked: false,
  isStreaming: false,
  streamingStatus: "",
  executionPhase: null,
  error: null,
  errorCode: null,
  replyMessage: null,
  pendingReplyToId: null,
  editTarget: null,
  streamControllers: {},
  messageQueue: [],
  rollbackSnapshot: null,
  hasPendingQuestion: {},
  recoverySessionId: null,

  addMessage: (message: Message) => {
    set({ messages: [...get().messages, message] });
  },

  sendMessage: async (content: string, sessionId?: string) => {
    // P2-6: 检查是否有可恢复的中止检查点
    const state = get();
    const currentSid = sessionId ?? state.messages[0]?.session_id ?? "";
    if (currentSid) {
      const hasRecovery = await get().checkAbortRecovery(currentSid);
      if (hasRecovery) {
        return; // 等待用户确认恢复或拒绝
      }
    }

    // 消息排队模式：流式输出中不阻塞，加入队列
    const messageQueueEnabled =
      useFeatureFlagStore.getState().flags.message_queue;
    if (messageQueueEnabled && get().isStreaming) {
      get().enqueueMessage(content, sessionId);
      return;
    }

    // 标记当前 session 缓存为 stale（发送新消息后缓存将过期）
    if (currentSid) staleSessionCache(currentSid);

    set({
      isSending: true,
      isInputBlocked: !messageQueueEnabled,
      error: null,
      errorCode: null,
    });

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
      if (
        (response as Message & { pendingInteraction?: unknown })
          .pendingInteraction
      ) {
        const pi = (
          response as Message & {
            pendingInteraction: import("../../services/chatService").QuestionData;
          }
        ).pendingInteraction;
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

      // 非流式路径也持久化 blocks，避免下次全量加载时重建丢失结构
      const assistantMsg = response as Message;
      // P7: 非流式路径 blocks 重建 — 若后端返回 content 但无 blocks，构建 fallback text block
      if (
        assistantMsg.role === "assistant" &&
        !assistantMsg.blocks?.length &&
        assistantMsg.content
      ) {
        assistantMsg.blocks = [
          {
            id: `fallback-${assistantMsg.id}`,
            type: "text" as const,
            content: assistantMsg.content,
          },
        ];
      }
      if (assistantMsg.role === "assistant" && assistantMsg.blocks?.length) {
        chatService
          .updateMessageBlocks(
            sessionId || "default",
            assistantMsg.id,
            assistantMsg.blocks as unknown as Array<Record<string, unknown>>,
          )
          .catch((err) =>
            handleClientError(
              err,
              {
                module: "stores:chat:message",
                action: "sendMessage:saveBlocks",
              },
              "warn",
            ),
          );
      }

      // 再执行自动重命名（不阻塞 UI 状态）
      if (chatCoordinator.shouldAutoRename(sessionId)) {
        doAutoRename(sessionId!, content, (response as Message).content).catch(
          (e) =>
            handleClientError(
              e,
              {
                module: "stores:chat:message",
                action: "sendMessage:autoRename",
              },
              "warn",
            ),
        );
      }
    } catch (error) {
      handleClientError(
        error,
        { module: "stores:chat:message", action: "sendMessage" },
        "warn",
      );
      set({
        error: String(error),
        errorCode:
          error instanceof Error &&
          (error.message.includes("fetch") || error.message.includes("connect"))
            ? "BACKEND_UNREACHABLE"
            : "UNKNOWN",
        isSending: false,
        isInputBlocked: false,
      });
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

  streamMessage: async (
    content: string,
    sessionId?: string,
    workMode?: "plan" | "do",
    attachedImages?: AttachedImage[],
  ) => {
    // P2-2: 只取消同会话的旧流（多会话并行——不再互相中止）
    const sid = sessionId || "default";
    const prevController = get().streamControllers[sid];
    if (prevController) {
      prevController.abort();
    }

    const controller = new AbortController();

    const messageQueueEnabled =
      useFeatureFlagStore.getState().flags.message_queue;

    set({
      isSending: true,
      isInputBlocked: !messageQueueEnabled,
      isStreaming: true,
      error: null,
      errorCode: null,
      streamControllers: { ...get().streamControllers, [sid]: controller },
    });

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
        get()
          .dequeueAndSend(sessionId)
          .catch((e) =>
            handleClientError(
              e,
              {
                module: "stores:chat:message",
                action: "streamMessage:dequeue",
              },
              "warn",
            ),
          );
      }
    };

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: Date.now(),
      session_id: sessionId || "default",
      attachedImages:
        attachedImages && attachedImages.length > 0
          ? attachedImages
          : undefined,
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

    // J3: 用 SaveQueue 管理防抖持久化
    const saveQueue = new SaveQueue();

    // J4: 批量 set 更新——使用版本号机制，防止过期 rAF 覆盖最终状态
    let batchVersion = 0;
    let batchPending = false;
    let latestMessages: Message[] | null = null;

    const flushSet = (currentVersion: number): void => {
      // 版本号检查：过期版本直接丢弃（流结束后旧 rAF 回调不覆盖最终状态）
      if (currentVersion < batchVersion) {
        logger.debug("flushSet: 版本过期丢弃", {
          currentVersion,
          batchVersion,
        });
        batchPending = false;
        return;
      }

      if (latestMessages) {
        const questionCount = latestMessages.reduce((cnt, m) => {
          return (
            cnt + (m.blocks?.filter((b) => b.type === "question").length ?? 0)
          );
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

    // P8: ghostCheckTimer 提升到 try 外，确保 catch 块中可清除
    let ghostCheckTimer: ReturnType<typeof setInterval> | undefined;
    // 流诊断变量（提升到 try 外，catch 块中可读，用于异常路径埋点）
    let streamStartTime = 0;
    let chunkCount = 0;

    // P2-2: 有 sessionId 时使用带自动重连的流式发送
    try {
      const generator = sessionId
        ? chatService.streamMessageWithReconnect(
            content,
            sessionId,
            controller.signal,
            { workMode, images: attachedImages },
          )
        : chatService.streamMessage(content, sessionId, controller.signal, {
            workMode,
            images: attachedImages,
          });
      const blockBuilder = new ChronologicalBlockBuilder();
      const extractor = createThinkExtractor();
      // 流诊断埋点：记录流起始时间与 chunk 总数，供流结束/异常时定位"无回复/卡死"问题
      streamStartTime = Date.now();
      chunkCount = 0;

      // P1-5: 幽灵块检测 — 超过 30s 无 chunk 时 ping 后端确认任务是否仍在执行
      let lastChunkTime = Date.now();
      ghostCheckTimer = setInterval(async () => {
        if (controller.signal.aborted) {
          clearInterval(ghostCheckTimer);
          return;
        }
        if (Date.now() - lastChunkTime < 30000) return;

        // 30s 无 chunk：ping 后端确认会话状态
        try {
          const base = await import("../../services/backendUrl").then((m) =>
            m.getBackendBaseUrl(),
          );
          const resp = await fetch(
            `${base}/v1/sessions/${sessionId || "default"}/streaming`,
          );
          if (resp.ok) {
            const status = await resp.json();
            if (!status.streaming) {
              logger.warn(
                "幽灵块检测：后端报告会话流已结束，但前端仍在等待 chunk",
                { sessionId },
              );
              clearInterval(ghostCheckTimer);
              controller.abort();
            }
          }
        } catch {
          // ping 失败静默处理，不干扰主流程
        }
      }, 10000);

      for await (const rawChunk of generator) {
        // 检查是否已被中止
        if (controller.signal.aborted) break;

        const chunks = Array.from(extractor.extract(rawChunk));
        for (const chunk of chunks) {
          chunkCount++;
          await processChunk(chunk);
        }
      }

      // 处理未闭合的 think 标签
      if (!controller.signal.aborted) {
        for (const chunk of extractor.flush()) {
          await processChunk(chunk);
        }
      }

      async function processChunk(
        chunk: import("../../services/chatService").StreamChunk,
      ) {
        // P1-5: 每次收到 chunk 时更新时间戳
        lastChunkTime = Date.now();
        const current = get().messages;
        const msgIdx = current.findIndex((m) => m.id === assistantId);

        if (msgIdx === -1) {
          logger.warn(
            "processChunk: 未找到对应的 assistant 消息（assistantId=%s），跳过 chunk",
            assistantId,
          );
          return;
        }

        const msg = current[msgIdx];
        let updatedMsg: Message;

        if (chunk.type === "thinking") {
          blockBuilder.addThinking(chunk.content, true);
          updatedMsg = { ...msg, blocks: blockBuilder.getBlocks() };
        } else if (chunk.type === "text") {
          blockBuilder.freezeThinking();
          // 先剥离结构化标签再进 blocks/content，确保任何泄漏的 <response>/<think>/<invoke>
          // 片段都不会显示给用户（blocks 渲染与 msg.content 保持一致）
          const cleanContent = stripStructuralTags(chunk.content);
          blockBuilder.addText(cleanContent, true);
          updatedMsg = {
            ...msg,
            content: msg.content + cleanContent,
            blocks: blockBuilder.getBlocks(),
          };
        } else if (chunk.type === "status") {
          blockBuilder.addStatus(chunk.content, chunk.statusType);
          set({ streamingStatus: chunk.content });
          updatedMsg = { ...msg, blocks: blockBuilder.getBlocks() };
        } else if (chunk.type === "reconnect_status") {
          // P2-2: 重连状态提示
          blockBuilder.addStatus(`🔄 ${chunk.content}`);
          set({ streamingStatus: chunk.content });
          updatedMsg = { ...msg, blocks: blockBuilder.getBlocks() };
        } else if (chunk.type === "context_state") {
          // 上下文状态事件：水位监控信息只更新进度条，不渲染进消息内容
          // （修复：原实现把每 1.5s 的高频水位也 addStatus，导致"上下文水位: xx%"污染消息块）
          const watermarkStore = useContextWatermarkStore.getState();
          // 1) 结构化水位（后端首选通道）→ 更新进度条
          if (chunk.watermarkState) {
            watermarkStore.updateWatermark(chunk.watermarkState);
            if (chunk.watermarkState.severity !== "normal") {
              // 异常水位渲染为一次性提示块
              blockBuilder.addStatus(chunk.content);
              set({ streamingStatus: chunk.content });
              updatedMsg = { ...msg, blocks: blockBuilder.getBlocks() };
            } else {
              // normal 水位每 1.5s 高频，仅更新进度条，消息内容不变
              updatedMsg = msg;
            }
          } else {
            // 2) 兼容旧格式: "上下文水位: 85% (170K/200K) | severity:compact | ratio:0.852 | tokens:170000/200000"
            const structured = chunk.content.match(
              /上下文水位:\s*(\d+)%\s*\(?(\d+K?)\/(\d+K?)\)?\s*\|\s*severity:(compact|warn)\s*\|\s*ratio:([\d.]+)\s*\|\s*tokens:(\d+)\/(\d+)/,
            );
            if (structured) {
              watermarkStore.updateWatermark({
                currentTokens: parseInt(structured[6], 10),
                contextLimit: parseInt(structured[7], 10),
                ratio: parseFloat(structured[5]),
                severity: structured[4] as "compact" | "warn",
              });
              updatedMsg = msg;
            } else {
              // 兼容旧格式: "上下文水位: 85%"
              const legacy = chunk.content.match(/上下文水位:\s*(\d+)%/);
              if (legacy) {
                const pct = parseInt(legacy[1], 10);
                const isCompact =
                  chunk.content.includes("压缩") ||
                  chunk.content.includes("临界");
                watermarkStore.updateWatermark({
                  currentTokens: 0,
                  contextLimit: 0,
                  ratio: pct / 100,
                  severity: isCompact ? "compact" : "warn",
                });
                updatedMsg = msg;
              } else {
                // 3) 非水位提示（上下文压缩/召回/降级事件）→ status 块
                blockBuilder.addStatus(chunk.content);
                set({ streamingStatus: chunk.content });
                updatedMsg = { ...msg, blocks: blockBuilder.getBlocks() };
              }
            }
          }
        } else if (chunk.type === "tool_completed") {
          // 工具完成事件：携带结构化 result data 更新对应 toolCall.result
          const tcId = chunk.tool_call_id;
          const resultData = chunk.result_data;
          logger.debug("tool_completed chunk", {
            tcId,
            hasResultData: !!resultData,
            resultDataKeys: resultData ? Object.keys(resultData) : "N/A",
          });
          if (tcId && resultData) {
            blockBuilder.updateToolCallResult(tcId, resultData);
            logger.debug("after updateToolCallResult", {
              blocks: blockBuilder
                .getBlocks()
                .filter((b) => b.type === "tool_call")
                .map((b) => ({
                  id: b.toolCall?.id,
                  name: b.toolCall?.name,
                  hasResult: !!b.toolCall?.result,
                })),
            });
          }
          updatedMsg = { ...msg, blocks: blockBuilder.getBlocks() };
        } else if (chunk.type === "execution_phase" && chunk.executionPhase) {
          // 执行阶段推送：更新 executionPhase 状态 + 生成进度块
          const ep = chunk.executionPhase;
          const progressData: import("../../types").ProgressData = {
            phase:
              (ep.phase as import("../../types").ProgressData["phase"]) ||
              "analyzing",
            progress: ep.progress || 0,
            description: ep.description || "",
            steps:
              (ep.steps as import("../../types").ProgressData["steps"]) || [],
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
            content: msg.content + stripStructuralTags(chunk.content),
            blocks: blockBuilder.getBlocks(),
          };
          set({
            error: chunk.content,
            errorCode: chunk.errorCode || "UNKNOWN",
          });
        } else if (chunk.type === "tool_call" && chunk.toolCall) {
          // 实时转换：todo_write 的 tool_call 直接转 todo block，不等流结束
          let skipDefault = false;
          if (chunk.toolCall.name === "todo_write") {
            const args = chunk.toolCall.arguments as
              Record<string, unknown> | undefined;
            if (args?.action === "write" && args?.todos) {
              const todos = Array.isArray(args.todos)
                ? (args.todos as Array<Record<string, unknown>>)
                : [];
              const tasks = todos.map((t, idx) => ({
                id: String(t.id || idx + 1),
                name: String(t.name || t.content || `步骤 ${idx + 1}`),
                status:
                  (t.status as import("../../types").TaskCardTask["status"]) ||
                  "pending",
                dependsOn: (t.dependsOn as string[]) || [],
              }));
              const title = String(
                args?.title ||
                  (typeof args?.description === "string"
                    ? args.description
                    : "") ||
                  `任务 (${todos.length} 步)`,
              );
              blockBuilder.addTodo({ title, tasks, status: "planning" });
              skipDefault = true;
            } else if (args?.action === "update") {
              // 实时更新单个任务状态：从 tool_call 参数中提取变更并应用到 todo block
              const taskId = String(args.todoId ?? args.id ?? "");
              if (taskId) {
                const updates: Partial<{
                  status: import("../../types").TaskCardTask["status"];
                  result: string;
                  durationMs: number;
                }> = {};
                if (args.status)
                  updates.status =
                    args.status as import("../../types").TaskCardTask["status"];
                if (args.result) updates.result = args.result as string;
                if (args.durationMs)
                  updates.durationMs = args.durationMs as number;
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
          if (
            chunk.toolCall.status === "completed" ||
            chunk.toolCall.status === "failed"
          ) {
            if (sessionId) {
              saveQueue.enqueue(
                sessionId,
                assistantId,
                blockBuilder.getBlocks(),
                true,
              );
            }
          }

          // _meta 导航建议：create_project 完成后触发前端提示
          if (chunk._meta?.action === "suggest_navigate") {
            window.dispatchEvent(
              new CustomEvent("pyapp:navigate-suggest", {
                detail: chunk._meta,
              }),
            );
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
            questionBlocks: newBlocks.filter((b) => b.type === "question")
              .length,
          });
          updatedMsg = { ...msg, blocks: newBlocks };
          // P2-3: 按会话记录 pending question，多会话并行互不覆盖
          if (!get().hasPendingQuestion[sid]) {
            set({
              hasPendingQuestion: {
                ...get().hasPendingQuestion,
                [sid]: true,
              },
            });
          }
          // 需要用户关注时播放警示音
          playWarningSound();
        } else if (chunk.type === "todo" && chunk.todoData) {
          blockBuilder.addTodo(chunk.todoData);
          updatedMsg = { ...msg, blocks: blockBuilder.getBlocks() };
        } else if (chunk.type === "usage") {
          // L5: 检测截断信号 finishReason='length'（修复 BUG #10）
          if (chunk.finishReason === "length") {
            const truncatedSuffix =
              "\n\n> ⚠️ **AI 输出已被截断**（max_tokens 限制），请考虑分步提问或增大 max_tokens 设置。";
            blockBuilder.addText(truncatedSuffix, false);
            // 关键节点即时落盘：截断时立即持久化，确保截断前的 blocks 不丢失（方案 C）
            if (sessionId) {
              saveQueue.enqueue(
                sessionId,
                assistantId,
                blockBuilder.getBlocks(),
                true,
              );
            }
          }
          // 仅当 chunk.usage 非空时更新 usage，避免 standalone finish_reason 覆盖已有数据（BUG #10 L2）
          const usageUpdate = chunk.usage ? { usage: chunk.usage } : {};
          updatedMsg = {
            ...msg,
            ...usageUpdate,
            blocks: blockBuilder.getBlocks(),
          };

          // P0 增强：自动建项目后触发前端导航提示（_meta 在 usage 块中）
          if (chunk._meta?.action === "suggest_navigate") {
            window.dispatchEvent(
              new CustomEvent("pyapp:navigate-suggest", {
                detail: chunk._meta,
              }),
            );
          }
        } else {
          updatedMsg = msg;
        }

        const newMessages = [...current];
        newMessages[msgIdx] = updatedMsg;
        latestMessages = newMessages;

        // J4：批量更新——仅在无挂起 flush 时调度微任务
        if (!batchPending) {
          batchPending = true;
          Promise.resolve()
            .then(() => requestAnimationFrame(() => flushSet(++batchVersion)))
            .catch(() => {
              /* flushSet 异常不阻塞后续更新 */
            });
        }

        // J3：流式传输中实时防抖保存 blocks，使用闭包内局部变量避免竞态
        if (sessionId && updatedMsg.blocks && updatedMsg.blocks.length > 0) {
          // 会话切换锁：setMessages 期间暂存流式 chunk，避免覆盖
          if (_sessionSwitchLock) {
            _pendingSwitchChunks.push({
              sessionId,
              assistantId,
              blocks: updatedMsg.blocks,
            });
          } else {
            saveQueue.enqueue(sessionId, assistantId, updatedMsg.blocks);
          }
        }
      }

      // 清除防抖定时器已在 SaveQueue.flush() 内部处理
      // P1-5: 清除幽灵块检测定时器
      clearInterval(ghostCheckTimer);
      await saveQueue.flush();

      // P3-2: 无内容兜底 — 流正常结束（非用户取消）但未生成任何用户可见成果时处理。
      // 核心：模型可能只输出了 <think> 未生成 <response>（think-only 场景），
      // 此时把思考内容转为用户可见 text，避免"思考中无回复"的卡死观感；
      // 完全无内容的才提示重试。
      let noVisibleResultTriggered = false;
      if (!controller.signal.aborted) {
        const preFreezeBlocks = blockBuilder.getBlocks();
        const hasVisibleResult = preFreezeBlocks.some(
          (b) =>
            b.type === "text" ||
            b.type === "tool_call" ||
            b.type === "question" ||
            b.type === "todo",
        );
        if (!hasVisibleResult) {
          noVisibleResultTriggered = true;
          // 1) 模型把内容写进了思考标签（think-only）→ 转为 text，保证沟通闭环
          const thinkingText = preFreezeBlocks
            .filter((b) => b.type === "thinking")
            .map((b) => b.content)
            .join("");
          if (thinkingText.trim()) {
            // 转 text：重建 blocks 仅保留 text 块。
            // 修复：此前 addText 追加导致 thinking 块 + text 块并存，思考内容渲染两遍。
            blockBuilder.reset();
            blockBuilder.addText(stripStructuralTags(thinkingText), false);
            logger.warn("streamMessage:think-only 转 text 兜底", {
              sessionId: sid,
              thinkingLen: thinkingText.length,
              // 完整模型原始输出（清洗前），用于判断是否为工具调用失败 / 标签解析异常
              thinkingText,
              blockTypes: preFreezeBlocks.map((b) => b.type),
            });
          } else {
            // 2) 完全无内容 → 提示重试
            blockBuilder.addStatus(
              "⚠️ 本次回复未生成内容，请重试或检查模型/网络状态。",
            );
            logger.warn("streamMessage:无内容兜底触发", {
              sessionId: sid,
              blockCount: preFreezeBlocks.length,
              blockTypes: preFreezeBlocks.map((b) => b.type),
            });
          }
        }
      }

      // ── 流结束诊断埋点：记录结束原因 / 触发条件 / 耗时 / 块统计，供排查"无回复/卡死"类问题 ──
      {
        const blockStats: Record<string, number> = {};
        for (const b of blockBuilder.getBlocks()) {
          blockStats[b.type] = (blockStats[b.type] ?? 0) + 1;
        }
        logger.info("streamMessage:流结束", {
          sessionId: sid,
          endReason: controller.signal.aborted
            ? "user_abort"
            : "generator_complete",
          durationMs: Date.now() - streamStartTime,
          chunkCount,
          blockStats,
          noVisibleResultTriggered,
          streamingStatus: get().streamingStatus || undefined,
        });
      }

      // 流结束，冻结所有块
      blockBuilder.freezeAll();

      // P3-1: 流完整性检查 — 检测未完成的 tool_call 块，标记中断状态
      const unfrozenBlocks = blockBuilder.getBlocks();
      const incompleteToolCalls = unfrozenBlocks.filter(
        (b) => b.type === "tool_call" && b.toolCall?.status === "running",
      );
      if (incompleteToolCalls.length > 0) {
        const names = incompleteToolCalls
          .map((b) => b.toolCall?.name)
          .filter(Boolean)
          .join("、");
        blockBuilder.addStatus(
          `⚠️ 任务中断：以下工具未完成 — ${names || `${incompleteToolCalls.length} 个工具`}`,
        );
        logger.warn("流完整性检查：发现未完成的 tool_call", {
          count: incompleteToolCalls.length,
          names,
        });
      }

      const finalBlocks = blockBuilder.getBlocks();

      // 版本号递增：使 pending 的 rAF flushSet 全部失效，
      // 旧版本的回调被丢弃，不再覆盖最终状态
      batchVersion++;
      latestMessages = null;
      batchPending = false;

      // 检查最终 blocks 中是否有 question 块，更新 hasPendingQuestion
      const hasQuestion = finalBlocks.some((b) => b.type === "question");
      // P2-3: 仅更新本会话的 question 状态，不影响其他会话
      set({
        hasPendingQuestion: {
          ...get().hasPendingQuestion,
          [sid]: hasQuestion,
        },
      });

      // 流完成提示音（仅当无待回答 question 时播放）
      if (!hasQuestion) {
        playCompletionSound();
      }

      // 立即重置流式状态，让 UI 立刻响应（ThinkingBlock 收缩、tool_call 停止旋转）
      // 不等待 updateMessageBlocks 和 doAutoRename 完成
      // P2-2: 仅清理本会话控制器，其他会话流不受影响
      const nextControllers = removeStreamController(
        get().streamControllers,
        sid,
      );
      set({
        isSending: false,
        isInputBlocked: false,
        isStreaming: Object.keys(nextControllers).length > 0,
        streamingStatus: "",
        streamControllers: nextControllers,
        executionPhase: null,
      });

      // 构建最终消息并写入 store
      const finalMessages = get().messages;
      const finalMsgIdx = finalMessages.findIndex((m) => m.id === assistantId);
      if (finalMsgIdx !== -1) {
        const msg = { ...finalMessages[finalMsgIdx], blocks: finalBlocks };
        set({
          messages: finalMessages.map((m) => (m.id === assistantId ? msg : m)),
        });

        addFilePathsFromBlocks(
          finalBlocks,
          (file) => get().addSessionFile(file),
          () => get().sessionFiles,
          (files) => set({ sessionFiles: files }),
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
            handleClientError(
              error,
              {
                module: "stores:chat:message",
                action: "streamMessage:finalSaveBlocks",
              },
              "warn",
            );
          }
        }
      }

      // 再执行自动重命名（不阻塞 UI 状态）
      if (chatCoordinator.shouldAutoRename(sessionId)) {
        const finalMsgs = get().messages;
        const finalMI = finalMsgs.findIndex((m) => m.id === assistantId);
        const assistantResponse =
          finalMI !== -1 ? finalMsgs[finalMI].content : "";
        doAutoRename(sessionId!, content, assistantResponse).catch((e) =>
          handleClientError(
            e,
            {
              module: "stores:chat:message",
              action: "streamMessage:autoRename",
            },
            "warn",
          ),
        );
      }

      // 消息排队：自动消费队列中的下一条消息
      tryDequeue();
    } catch (error) {
      // P8: 清除幽灵检测定时器，防止网络断开后旧定时器泄露到新流式
      if (ghostCheckTimer) clearInterval(ghostCheckTimer);
      // 流异常结束诊断埋点（与正常结束日志字段对齐，便于对照时间线）
      logger.warn("streamMessage:流异常结束", {
        sessionId: sid,
        durationMs: Date.now() - streamStartTime,
        chunkCount,
        aborted: controller.signal.aborted,
        error: error instanceof Error ? error.message : String(error),
      });
      handleClientError(
        error,
        { module: "stores:chat:message", action: "streamMessage" },
        "warn",
      );
      // P2-2: 断线重连 — 非用户取消的中断尝试从检查点恢复消息
      if (!controller.signal.aborted && sessionId) {
        try {
          const base = await import("../../services/backendUrl").then((m) =>
            m.getBackendBaseUrl(),
          );
          const resp = await fetch(
            `${base}/v1/sessions/${sessionId}/checkpoints/latest`,
          );
          if (resp.ok) {
            const data = await resp.json();
            if (data.checkpointAvailable && data.messages?.length > 0) {
              logger.info("从检查点恢复消息", {
                sessionId,
                messageCount: data.messages.length,
              });
              set({ messages: data.messages });
            }
          }
        } catch {
          // 检查点恢复失败静默处理
        }
      }
      // P2-2: 错误/中止统一清理本会话控制器，其他会话流不受影响
      const nextControllers = removeStreamController(
        get().streamControllers,
        sid,
      );
      set({
        error: !controller.signal.aborted ? String(error) : null,
        isSending: false,
        isInputBlocked: false,
        isStreaming: Object.keys(nextControllers).length > 0,
        streamingStatus: "",
        streamControllers: nextControllers,
        executionPhase: null,
      });
      // 消息排队：即使出错也消费队列
      tryDequeue();
    }
  },

  clearMessages: () => {
    set({ messages: [], error: null, errorCode: null });
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

    // 边界条件3：中止本会话的旧流（P2-2: 只影响本会话）
    const sid = sessionId || messages[0]?.session_id || "default";
    const prevController = get().streamControllers[sid];
    if (prevController) {
      prevController.abort();
    }

    // 移除最后一条 assistant 及之后的所有消息（含可能的部分生成空消息），然后重新发送
    const truncated = messages.slice(0, lastUserIdx + 1);
    const nextControllers = removeStreamController(
      get().streamControllers,
      sid,
    );
    set({
      messages: truncated,
      isStreaming: Object.keys(nextControllers).length > 0,
      isSending: false,
      isInputBlocked: false,
      streamControllers: nextControllers,
    });

    // 检测工作模式：若当前工作项活跃，传递 Plan/Do 模式到后端
    let workMode: "plan" | "do" | undefined;
    try {
      const { useWorkStore } = await import("../workStore");
      const workState = useWorkStore.getState();
      if (workState.activeWorkItem) {
        workMode = workState.mode;
      }
    } catch (err) {
      handleClientError(
        err,
        {
          module: "stores:chat:message",
          action: "regenerateMessage:getWorkMode",
        },
        "warn",
      );
    }

    try {
      await get().streamMessage(
        content,
        sessionId || userMsg.session_id,
        workMode,
      );
    } catch (error) {
      handleClientError(
        error,
        { module: "stores:chat:message", action: "regenerateMessage" },
        "warn",
      );
      set({
        error: String(error),
        isSending: false,
        isInputBlocked: false,
        isStreaming: Object.keys(get().streamControllers).length > 0,
      });
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

    // 边界条件3：中止本会话的旧流（P2-2: 只影响本会话）
    const sid = sessionId || messages[0]?.session_id || "default";
    const prevController = get().streamControllers[sid];
    if (prevController) {
      prevController.abort();
    }

    // 移除该用户消息及其之后的所有消息（含可能的部分生成空消息），然后重新发送
    const truncated = messages.slice(0, userMsgIdx + 1);
    const nextControllers = removeStreamController(
      get().streamControllers,
      sid,
    );
    set({
      messages: truncated,
      isStreaming: Object.keys(nextControllers).length > 0,
      isSending: false,
      isInputBlocked: false,
      streamControllers: nextControllers,
    });

    try {
      // 修复 BUG F3: 检测工作模式，传递给 streamMessage
      let workMode: "plan" | "do" | undefined;
      try {
        const { useWorkStore } = await import("../workStore");
        const workState = useWorkStore.getState();
        if (workState.activeWorkItem) {
          workMode = workState.mode;
        }
      } catch (_) {
        // @ignore-catch — workStore 未加载，不阻塞重试
      }
      await get().streamMessage(
        content,
        sessionId || userMsg.session_id,
        workMode,
      );
    } catch (error) {
      handleClientError(
        error,
        { module: "stores:chat:message", action: "retryFromError" },
        "warn",
      );
      set({
        error: String(error),
        isSending: false,
        isInputBlocked: false,
        isStreaming: Object.keys(get().streamControllers).length > 0,
      });
    }
  },

  /**
   * 取消当前流式请求（J1）
   */
  stopMessage: () => {
    // P2-2: 仅中止当前 UI 会话的流，其他会话流不受影响
    const state = get();
    const sessionId = state.messages[0]?.session_id ?? "";
    const controller = sessionId
      ? state.streamControllers[sessionId]
      : undefined;
    if (controller) {
      // P2-6: 保存中止恢复点（fire-and-forget，不阻塞 UI）
      if (sessionId) {
        const assistantMsg = [...state.messages]
          .reverse()
          .find((m) => m.role === "assistant");
        if (assistantMsg) {
          import("../../services/backendUrl")
            .then(({ getBackendBaseUrl }) => {
              fetch(
                `${getBackendBaseUrl()}/v1/sessions/${sessionId}/checkpoints/latest`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    label: `abort_${Date.now()}`,
                    autoCreated: true,
                    metadata: { abortRecovery: true },
                  }),
                },
              ).catch((err) => {
                handleClientError(
                  err,
                  {
                    module: "stores:chat:message",
                    action: "stopMessage:saveCheckpoint",
                  },
                  "warn",
                );
              });
            })
            .catch(() => {
              /* backendUrl 动态加载失败，静默忽略 */
            });
        }
      }

      controller.abort();
      const nextControllers = removeStreamController(
        get().streamControllers,
        sessionId,
      );
      set({
        isStreaming: Object.keys(nextControllers).length > 0,
        isSending: false,
        isInputBlocked: false,
        streamingStatus: "",
        streamControllers: nextControllers,
      });
      // 消息排队：停止后也消费队列
      const messageQueueEnabled =
        useFeatureFlagStore.getState().flags.message_queue;
      if (messageQueueEnabled && get().messageQueue.length > 0) {
        get()
          .dequeueAndSend()
          .catch((e) =>
            handleClientError(
              e,
              { module: "stores:chat:message", action: "stopMessage:dequeue" },
              "warn",
            ),
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

  /**
   * 立即 flush 待保存的 blocks（用于切换会话前）
   * 避免防抖窗口内的 blocks 丢失导致下次进入历史时出现块割裂
   */
  flushPendingSaves: async (): Promise<void> => {
    if (getHasPendingSave()) {
      // 超时保护：最多等待 3 秒，防止 HTTP 挂起阻塞会话切换（方案 C）
      const timeout = new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error("flushPendingSaves 超时")), 3000),
      );
      await Promise.race([flushSaveBlocks(), timeout]).catch((err) => {
        handleClientError(
          err,
          { module: "stores:chat:message", action: "flushPendingSaves" },
          "warn",
        );
      });
    }
  },

  /**
   * 删除单条消息（乐观更新 + 失败回滚）
   */
  deleteMessage: async (messageId: string): Promise<void> => {
    const { messages, isStreaming } = get();

    if (isStreaming) {
      logger.warn("deleteMessage: 流式输出中，忽略删除请求");
      return;
    }

    const targetMsg = messages.find((m) => m.id === messageId);
    if (!targetMsg || targetMsg.role !== "user") {
      logger.warn("deleteMessage: 目标消息不存在或非用户消息");
      return;
    }

    const sessionId = targetMsg.session_id;
    if (!sessionId) {
      logger.warn("deleteMessage: 消息缺少 session_id");
      return;
    }

    // 快照用于失败回滚
    const prev = [...messages];
    set({ messages: messages.filter((m) => m.id !== messageId) });

    try {
      await sessionService.deleteMessage(sessionId, messageId);
    } catch (err) {
      handleClientError(
        err,
        { module: "stores:chat:message", action: "deleteMessage" },
        "warn",
      );
      // 回滚 UI
      set({ messages: prev });
      throw err;
    }
  },

  /**
   * 回退到指定消息之前（截断此处及之后所有消息）
   */
  rollbackToMessage: async (messageId: string) => {
    const { messages, isStreaming } = get();

    if (isStreaming) {
      logger.warn("rollbackToMessage: 流式输出中，忽略回退请求");
      return { messages: [], remainingRollbacks: -1 };
    }

    const index = messages.findIndex((m) => m.id === messageId);
    if (index === -1 || messages[index].role !== "user") {
      logger.warn("rollbackToMessage: 目标消息不存在或非用户消息");
      return { messages: [], remainingRollbacks: -1 };
    }

    const sessionId = messages[index].session_id;
    if (!sessionId) {
      logger.warn("rollbackToMessage: 消息缺少 session_id");
      return { messages: [], remainingRollbacks: -1 };
    }

    // 快照用于失败回滚 + 撤销
    const prev = [...messages];
    set({ messages: messages.slice(0, index), rollbackSnapshot: prev });

    try {
      const res = await sessionService.truncateMessages(sessionId, messageId);
      return {
        messages: res.messages,
        remainingRollbacks: res.remainingRollbacks,
        undoResults: res.undoResults,
      };
    } catch (err) {
      handleClientError(
        err,
        { module: "stores:chat:message", action: "rollbackToMessage" },
        "warn",
      );
      // 回滚 UI
      set({ messages: prev, rollbackSnapshot: null });
      throw err;
    }
  },

  /**
   * 撤销最近一次回退（恢复快照中的消息）
   */
  restoreRollback: () => {
    const snapshot = get().rollbackSnapshot;
    if (!snapshot) return;
    set({ messages: snapshot, rollbackSnapshot: null });
  },

  /**
   * P2-6: 检查是否有可恢复的中止检查点
   * 如果存在 abortRecovery 检查点，设置 recoverySessionId 以触发 UI 提示
   * @returns true 如果有待恢复的检查点（调用方应停止发送并等待用户确认）
   */
  checkAbortRecovery: async (sessionId: string): Promise<boolean> => {
    try {
      const base = await import("../../services/backendUrl").then((m) =>
        m.getBackendBaseUrl(),
      );
      const resp = await fetch(
        `${base}/v1/sessions/${sessionId}/checkpoints/latest`,
      );
      if (!resp.ok) return false;
      const data = await resp.json();
      if (data?.metadata?.abortRecovery) {
        set({ recoverySessionId: sessionId });
        return true;
      }
    } catch {
      // 检查点查询失败静默处理
    }
    return false;
  },

  /** P2-6: 关闭恢复提示并清理 abortRecovery 标记 */
  dismissRecovery: () => {
    const sid = get().recoverySessionId;
    set({ recoverySessionId: null });
    if (sid) {
      import("../../services/backendUrl")
        .then(({ getBackendBaseUrl }) => {
          fetch(
            `${getBackendBaseUrl()}/v1/sessions/${sid}/checkpoints/latest`,
            {
              method: "DELETE",
            },
          ).catch(() => {});
        })
        .catch(() => {
          /* backendUrl 动态加载失败，静默忽略 */
        });
    }
  },

  /** P2-6: 用户确认恢复 — 关闭提示，允许下一条消息通过 */
  resumeRecovery: (_sessionId: string) => {
    set({ recoverySessionId: null });
    // 不清除后端检查点 — resume 端点需要它来恢复生成器状态
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
    // BUG F2 修复: 每次加载新消息时清理旧缓存，防止内存无限增长
    _toolResultFullCache.clear();

    // 会话切换锁：挂起流式写入，防止 loadSessions 覆盖流式数据
    _sessionSwitchLock = true;

    try {
      // 缓存写入：仅当传入完整消息列表时（非空且非增量更新）
      // 使用第一条消息的 session_id 作为缓存 key
      if (messages.length > 0 && messages[0].session_id) {
        const cacheKey = messages[0].session_id;
        setSessionCache(cacheKey, messages);
      }

      // Phase 1: 收集 tool 角色消息，建立 toolCallId → content 映射
      // 这些工具结果在后端作为独立消息持久化，前端需合并回 assistant 消息的 blocks 中
      // 同时缓存全量结果到 _toolResultFullCache，block 中只存截断摘要
      const toolResultsByCallId = new Map<string, string>();
      const filteredMessages: Message[] = [];

      for (const msg of messages) {
        if (msg.role === "tool" && msg.toolCallId) {
          const rawContent = typeof msg.content === "string" ? msg.content : "";
          toolResultsByCallId.set(msg.toolCallId, rawContent);
          // 全量结果存入独立缓存（LRU 淘汰），不在 block 中内联
          if (_toolResultFullCache.size >= MAX_TOOL_RESULT_CACHE) {
            const oldest = _toolResultFullCache.keys().next().value;
            if (oldest) _toolResultFullCache.delete(oldest);
          }
          _toolResultFullCache.set(msg.toolCallId, rawContent);
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
              ...(Array.isArray(msg.blocks) ? msg.blocks : []).map((b) => ({
                ...b,
                isStreaming: false,
              })),
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

        if (Array.isArray(msg.blocks) && msg.blocks.length > 0) {
          // 先处理已有 blocks：合并工具结果 + 迁移 groupId
          let hasMergedResult = false;
          const mergedBlocks = msg.blocks.map((b) => {
            const block = { ...b, isStreaming: false };
            if (
              block.type === "tool_call" &&
              block.toolCall?.id &&
              toolResultsByCallId.has(block.toolCall.id)
            ) {
              const fullResult = toolResultsByCallId.get(block.toolCall.id)!;
              hasMergedResult = true;
              // 只注入截断摘要到 block，全量结果通过 getToolResultFull() 按需获取
              block.toolCall = {
                ...block.toolCall,
                result: truncateResult(fullResult),
                _hasFullResult:
                  fullResult.length > MAX_INLINE_RESULT_LENGTH || undefined,
              };
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
            return { ...b, isStreaming: false, groupId: "migrate_" + id }; // "migrate_" 前缀标记历史数据，与流式 "grp_" 区分
          });
          return { ...msg, blocks: enhancedBlocks };
        }

        const newBlocks = rebuildBlocksFromContent(msg);
        return { ...msg, blocks: newBlocks, tool_calls: undefined };
      });

      // Phase 4: 从历史消息中的 tool_call 块中提取文件路径（仅同步收集，不做异步路径解析）
      const sessionFilesList: FilePreview[] = [];
      const addedPaths = new Set<string>();

      for (const msg of enhancedMessages) {
        if (msg.role === "assistant" && msg.blocks) {
          addFilePathsFromBlocks(
            msg.blocks,
            (file) => {
              if (!addedPaths.has(file.path)) {
                addedPaths.add(file.path);
                sessionFilesList.push(file);
              }
            },
            () => get().sessionFiles,
            // 不触发异步 setState：文件路径解析留到预览时按需执行
            () => {},
          );
        }
      }

      // 检测是否有待用户回答的 question 块
      const hasQuestion = enhancedMessages.some((m) =>
        m.blocks?.some((b) => b.type === "question"),
      );
      // P2-3: 按会话记录 pending question（setMessages 作用于当前会话）
      const questionSessionId = messages[0]?.session_id ?? "default";
      const pendingQuestion = {
        ...get().hasPendingQuestion,
        [questionSessionId]: hasQuestion,
      };

      if (sessionFilesList.length > 0) {
        const currentFiles = get().sessionFiles;
        const merged = [...currentFiles];
        for (const file of sessionFilesList) {
          if (!merged.some((f) => f.path === file.path)) {
            merged.push(file);
          }
        }
        set({
          messages: enhancedMessages,
          sessionFiles: merged,
          hasPendingQuestion: pendingQuestion,
          streamingStatus: "",
          executionPhase: null,
        });
      } else {
        set({
          messages: enhancedMessages,
          hasPendingQuestion: pendingQuestion,
          streamingStatus: "",
          executionPhase: null,
        });
      }

      // 释放会话切换锁后刷新暂存的流式 chunk
      _sessionSwitchLock = false;
      if (_pendingSwitchChunks.length > 0) {
        // 暂存 chunk 的 sessionId 可能与当前会话不一致（跨会话切换），入队到全局 SaveQueue
        const lastChunk = _pendingSwitchChunks[_pendingSwitchChunks.length - 1];
        enqueueSaveBlocks(
          lastChunk.sessionId,
          lastChunk.assistantId,
          lastChunk.blocks,
          true, // immediate 保存
        );
        _pendingSwitchChunks = [];
      }
    } catch (e) {
      // 确保会话切换锁一定释放，防止锁泄漏导致后续流式输出永久阻塞
      _sessionSwitchLock = false;
      _pendingSwitchChunks = [];
      handleClientError(
        e,
        { module: "stores:chat:message", action: "setMessages" },
        "error",
      );
      // 设置空消息列表作为降级，避免界面卡在旧数据上
      set({ messages: [], streamingStatus: "", executionPhase: null });
    }
  },
});
