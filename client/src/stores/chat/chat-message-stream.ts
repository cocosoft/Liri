/**
 * Chat Message Slice — streamMessage 实现
 *
 * 从 chat-message.slice.ts 拆出（R04-001 文件行数限制治理）。
 * streamMessage：流式发送主流程（写前持久化 + SSE 消费 + 批量更新 +
 * 无内容兜底 + 检查点恢复），chunk 处理委托 chat-stream-chunk.ts。
 */
import type { Message, AttachedImage } from "@/types";
import {
  chatService,
  enqueueOutbox,
  clearOutboxForSession,
} from "@/services/chatService";
import { useFeatureFlagStore } from "@/stores/featureFlags";
import { playCompletionSound } from "@/services/SoundService";
import { createLogger } from "@/utils/logger";
import {
  ChronologicalBlockBuilder,
  createThinkExtractor,
  stripStructuralTags,
} from "./chat-toolcall.slice";
import { addFilePathsFromBlocks } from "./chat-file.slice";
import { doAutoRename, SaveQueue } from "./chat-history.slice";
import { chatCoordinator } from "./chatCoordinator";
import { handleClientError } from "@/utils/handleError";
import { removeStreamController } from "./chat-message-shared";
import {
  processChunk,
  type ProcessChunkContext,
  type StreamBatchState,
} from "./chat-stream-chunk";
import type { MessageSet, MessageGet } from "./chat-message.types";

const logger = createLogger("stores:chat:message");

/**
 * streamMessage：流式发送（带自动重连 / 检查点恢复 / 无内容兜底）。
 * 内部状态通过 batch 对象（J4 版本号机制）与 lastChunkTimeRef 显式传递，
 * chunk 处理委托 processChunk（见 chat-stream-chunk.ts）。
 */
export async function streamMessageImpl(
  set: MessageSet,
  get: MessageGet,
  content: string,
  sessionId?: string,
  workMode?: "plan" | "do",
  attachedImages?: AttachedImage[],
): Promise<void> {
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
      attachedImages && attachedImages.length > 0 ? attachedImages : undefined,
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

  // 根因 B：写前持久化 — 发送前先落盘用户消息（防断网丢失）
  // 成功 → 后端按 messageId 幂等去重；失败 → 进 outbox，网络恢复后自动补发
  let writeAheadOk = false;
  let outboxed = false;
  try {
    await chatService.addMessage(userMessage.session_id, userMessage);
    writeAheadOk = true;
  } catch {
    // 落盘失败（断网/后端不可达）→ 暂存 outbox，不阻塞发送流程
    outboxed = true;
    enqueueOutbox(userMessage, userMessage.session_id);
  }

  // J3: 用 SaveQueue 管理防抖持久化
  const saveQueue = new SaveQueue();

  // J4: 批量 set 更新——使用版本号机制，防止过期 rAF 覆盖最终状态
  const batch: StreamBatchState = {
    version: 0,
    pending: false,
    latestMessages: null,
  };

  const flushSet = (currentVersion: number): void => {
    // 版本号检查：过期版本直接丢弃（流结束后旧 rAF 回调不覆盖最终状态）
    if (currentVersion < batch.version) {
      logger.debug("flushSet: 版本过期丢弃", {
        currentVersion,
        batchVersion: batch.version,
      });
      batch.pending = false;
      return;
    }

    if (batch.latestMessages) {
      const latest = batch.latestMessages;
      const questionCount = latest.reduce((cnt, m) => {
        return (
          cnt + (m.blocks?.filter((b) => b.type === "question").length ?? 0)
        );
      }, 0);
      logger.debug("flushSet: 更新 store", {
        version: currentVersion,
        batchVersion: batch.version,
        msgCount: latest.length,
        questionBlocks: questionCount,
      });
      set({ messages: latest });
      batch.latestMessages = null;
    }
    batch.pending = false;
  };

  // P8: ghostCheckTimer 提升到 try 外，确保 catch 块中可清除
  let ghostCheckTimer: ReturnType<typeof setInterval> | undefined;
  // 流诊断变量（提升到 try 外，catch 块中可读，用于异常路径埋点）
  let streamStartTime = 0;
  let chunkCount = 0;
  // P1-5: 幽灵块检测时间戳（processChunk 通过 ref 更新）
  const lastChunkTimeRef = { current: Date.now() };

  // P2-2: 有 sessionId 时使用带自动重连的流式发送
  try {
    const generator = sessionId
      ? chatService.streamMessageWithReconnect(
          content,
          sessionId,
          controller.signal,
          {
            workMode,
            images: attachedImages,
            messageId: writeAheadOk ? userMessage.id : undefined,
          },
        )
      : chatService.streamMessage(content, sessionId, controller.signal, {
          workMode,
          images: attachedImages,
          messageId: writeAheadOk ? userMessage.id : undefined,
        });
    const blockBuilder = new ChronologicalBlockBuilder();
    const extractor = createThinkExtractor();
    // 流诊断埋点：记录流起始时间与 chunk 总数，供流结束/异常时定位"无回复/卡死"问题
    streamStartTime = Date.now();
    chunkCount = 0;

    // P1-5: 幽灵块检测 — 超过 30s 无 chunk 时 ping 后端确认任务是否仍在执行
    ghostCheckTimer = setInterval(async () => {
      if (controller.signal.aborted) {
        clearInterval(ghostCheckTimer);
        return;
      }
      if (Date.now() - lastChunkTimeRef.current < 30000) return;

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

    // processChunk 运行上下文（显式注入替代原闭包捕获）
    const chunkCtx: ProcessChunkContext = {
      sid,
      sessionId,
      assistantId,
      controller,
      blockBuilder,
      saveQueue,
      lastChunkTimeRef,
      batch,
      flushSet,
      set,
      get,
    };

    for await (const rawChunk of generator) {
      // 检查是否已被中止
      if (controller.signal.aborted) break;

      const chunks = Array.from(extractor.extract(rawChunk));
      for (const chunk of chunks) {
        chunkCount++;
        await processChunk(chunkCtx, chunk);
      }
    }

    // 处理未闭合的 think 标签
    if (!controller.signal.aborted) {
      for (const chunk of extractor.flush()) {
        await processChunk(chunkCtx, chunk);
      }
    }

    // 根因 B：流式发送正常结束 → 后端已持久化该轮用户消息，清除该会话待补发消息（避免重复补发）
    if (outboxed && !controller.signal.aborted) {
      clearOutboxForSession(userMessage.session_id);
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
    batch.version++;
    batch.latestMessages = null;
    batch.pending = false;

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
      {
        module: "stores:chat:message",
        action: "streamMessage",
        // 根因 D：记录本次请求 payload 的 key 集合（只记键名不记值，便于定位请求结构）
        payloadKeys: ["content", "sessionId", "workMode", "attachedImages"],
      },
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
}
