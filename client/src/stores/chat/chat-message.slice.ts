/**
 * Chat Message Slice — 消息发送、流式响应、队列管理
 *
 * 核心 slice，包含流式聊天的主要逻辑。
 * 使用 Zustand StateCreator 模式。
 */
import type { StateCreator } from "zustand";
import { Message, MessageBlock, AttachedImage } from "../../types";
import type { FilePreview } from "../../types";
import type { FileSlice } from "./chat-file.slice";
import { chatService } from "../../services/chatService";
import { useFeatureFlagStore } from "../featureFlags";
import { playWarningSound, playCompletionSound } from "../../services/SoundService";
import { createLogger } from "../../utils/logger";
import { handleClientError } from "@/utils/handleError";
import {
  ChronologicalBlockBuilder,
  createThinkExtractor,
  generateGroupId,
  findLastToolCallId,
  rebuildBlocksFromContent,
} from "./chat-toolcall.slice";
import {
  addFilePathsFromBlocks,
} from "./chat-file.slice";
import {
  shouldAutoRename,
  doAutoRename,
  staleSessionCache,
  setSessionCache,
  flushSaveBlocks,
  setPendingSave,
  setHasPendingSave,
  getHasPendingSave,
  setIsFlushing,
} from "./chat-history.slice";

const logger = createLogger("stores:chat:message");

// 会话切换锁：setMessages 期间挂起流式写入，避免 loadSessions 覆盖流式数据
let _sessionSwitchLock = false;
// 会话切换锁期间的暂存区
let _pendingSwitchChunks: Array<{ sessionId: string; assistantId: string; blocks: MessageBlock[] }> = [];

/** Message Slice 状态和操作 */
export interface MessageSlice {
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
  streamMessage: (content: string, sessionId?: string, workMode?: "plan" | "do", attachedImages?: AttachedImage[]) => Promise<void>;
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
}

/**
 * 创建 Message Slice（Zustand StateCreator 模式）
 */
export const createMessageSlice: StateCreator<MessageSlice & FileSlice, [], [], MessageSlice> = (set, get) => ({
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
    if (currentSid) staleSessionCache(currentSid);

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
        const pi = (response as Message & { pendingInteraction: import("../../services/chatService").QuestionData }).pendingInteraction;
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
          (e) => handleClientError(e, { module: 'stores:chat:message', action: 'sendMessage:autoRename' }, 'warn'),
        );
      }
    } catch (error) {
      handleClientError(error, { module: 'stores:chat:message', action: 'sendMessage' }, 'warn');
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

  streamMessage: async (content: string, sessionId?: string, workMode?: "plan" | "do", attachedImages?: AttachedImage[]) => {
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
          (e) => handleClientError(e, { module: 'stores:chat:message', action: 'streamMessage:dequeue' }, 'warn'),
        );
      }
    };

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: Date.now(),
      session_id: sessionId || "default",
      attachedImages: attachedImages && attachedImages.length > 0 ? attachedImages : undefined,
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
          handleClientError(err, { module: 'stores:chat:message', action: 'streamMessage:saveBlocks' }, 'warn');
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
        { workMode, images: attachedImages },
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

      async function processChunk(chunk: import("../../services/chatService").StreamChunk) {
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
        } else if (chunk.type === "tool_completed") {
          // 工具完成事件：携带结构化 result data 更新对应 toolCall.result
          const tcId = chunk.tool_call_id;
          const resultData = chunk.result_data;
          console.log("[chatStore] tool_completed chunk:", { tcId, hasResultData: !!resultData, resultDataKeys: resultData ? Object.keys(resultData) : "N/A" });
          if (tcId && resultData) {
            blockBuilder.updateToolCallResult(tcId, resultData);
            console.log("[chatStore] after updateToolCallResult, blocks:", blockBuilder.getBlocks().filter(b => b.type === "tool_call").map(b => ({ id: b.toolCall?.id, name: b.toolCall?.name, hasResult: !!b.toolCall?.result })));
          }
          updatedMsg = { ...msg, blocks: blockBuilder.getBlocks() };
        } else if (chunk.type === "execution_phase" && chunk.executionPhase) {
          // 执行阶段推送：更新 executionPhase 状态 + 生成进度块
          const ep = chunk.executionPhase;
          const progressData: import("../../types").ProgressData = {
            phase: (ep.phase as import("../../types").ProgressData["phase"]) || "analyzing",
            progress: ep.progress || 0,
            description: ep.description || "",
            steps: (ep.steps as import("../../types").ProgressData["steps"]) || [],
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
                status: (t.status as import("../../types").TaskCardTask["status"]) || "pending",
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
                const updates: Partial<{ status: import("../../types").TaskCardTask["status"]; result: string; durationMs: number }> = {};
                if (args.status) updates.status = args.status as import("../../types").TaskCardTask["status"];
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
          setPendingSave(sessionId, assistantId, updatedMsg.blocks);
          setHasPendingSave(true);
        }
      }

      // J3：清除局部防抖定时器，确保最终 blocks 被保存
      if (saveBlocksTimer) {
        clearTimeout(saveBlocksTimer);
        saveBlocksTimer = null;
      }
      setHasPendingSave(false);
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
            handleClientError(error, { module: 'stores:chat:message', action: 'streamMessage:finalSaveBlocks' }, 'warn');
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
          (e) => handleClientError(e, { module: 'stores:chat:message', action: 'streamMessage:autoRename' }, 'warn'),
        );
      }

      // 消息排队：自动消费队列中的下一条消息
      tryDequeue();
    } catch (error) {
      handleClientError(error, { module: 'stores:chat:message', action: 'streamMessage' }, 'warn');
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
      const { useWorkStore } = await import("../workStore");
      const workState = useWorkStore.getState();
      if (workState.activeWorkItem) {
        workMode = workState.mode;
      }
    } catch (err) {
      handleClientError(err, { module: 'stores:chat:message', action: 'regenerateMessage:getWorkMode' }, 'warn');
    }

    try {
      await get().streamMessage(content, sessionId || userMsg.session_id, workMode);
    } catch (error) {
      handleClientError(error, { module: 'stores:chat:message', action: 'regenerateMessage' }, 'warn');
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
      handleClientError(error, { module: 'stores:chat:message', action: 'retryFromError' }, 'warn');
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
          (e) => handleClientError(e, { module: 'stores:chat:message', action: 'stopMessage:dequeue' }, 'warn'),
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
      setHasPendingSave(false);
      // 超时保护：最多等待 3 秒，防止 HTTP 挂起阻塞会话切换（方案 C）
      const timeout = new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('flushPendingSaves 超时')), 3000)
      );
      await Promise.race([flushSaveBlocks(), timeout]).catch((err) => {
        handleClientError(err, { module: 'stores:chat:message', action: 'flushPendingSaves' }, 'warn');
        // 超时后重置锁，让会话切换继续
        setIsFlushing(false);
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
      setSessionCache(cacheKey, messages);
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
        }, () => get().sessionFiles, (files) => set({ sessionFiles: files }));
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
      set({ messages: enhancedMessages, sessionFiles: merged, hasPendingQuestion: hasQuestion, streamingStatus: "", executionPhase: null });
    } else {
      set({ messages: enhancedMessages, hasPendingQuestion: hasQuestion, streamingStatus: "", executionPhase: null });
    }

    // 释放会话切换锁，并刷新暂存的流式 chunk
    _sessionSwitchLock = false;
    if (_pendingSwitchChunks.length > 0) {
      // 暂存 chunk 的 sessionId 可能与当前会话不一致（跨会话切换），只标记待保存
      const lastChunk = _pendingSwitchChunks[_pendingSwitchChunks.length - 1];
      setPendingSave(lastChunk.sessionId, lastChunk.assistantId, lastChunk.blocks);
      setHasPendingSave(true);
      _pendingSwitchChunks = [];
    }
  },
});
