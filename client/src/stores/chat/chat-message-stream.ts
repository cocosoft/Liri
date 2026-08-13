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
  truncateMessages,
} from "@/services/chatService";
import { useFeatureFlagStore } from "@/stores/featureFlags";
import { playCompletionSound } from "@/services/SoundService";
import { createLogger } from "@/utils/logger";
import {
  ChronologicalBlockBuilder,
  createThinkExtractor,
  stripStructuralTags,
  reorderExplorationBlocks,
} from "./chat-toolcall.slice";
import { addFilePathsFromBlocks } from "./chat-file.slice";
import {
  doAutoRename,
  SaveQueue,
  staleSessionCache,
} from "./chat-history.slice";
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
  existingUserMessageId?: string,
): Promise<void> {
  // P2-2: 只取消同会话的旧流（多会话并行——不再互相中止）
  const sid = sessionId || "default";
  const prevController = get().streamControllers[sid];
  if (prevController) {
    prevController.abort();
  }

  // P1-1 修复：流式发送使会话缓存失效（staleSessionCache）。
  // 原实现缓存只在加载时写入、非流式路径失效，流式对话后 _sessionMessageCache
  // 仍是加载时快照，切走再切回命中旧快照导致"最后一段对话消失"。
  staleSessionCache(sid);

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
      // M12 修复：编辑重发 id 悬空 —— 截断后重建的 userMessage 是全新 UUID：
      // ① 继承被编辑消息的 replyToId，回复链不因换新 id 而断裂（被回复标记/引用保留）
      // ② 若 pendingReplyToId 指向被截断的消息（含 editTarget 本身），改用继承值避免悬空
      const pendingReplyId = get().pendingReplyToId;
      const pendingSurvives = pendingReplyId
        ? truncated.some((m) => m.id === pendingReplyId)
        : false;
      // 悬空时不能回退到 pendingReplyId 本身（它可能正指向被截断的 editTarget），
      // 只继承被编辑消息的回复关系
      const nextReplyToId = pendingSurvives
        ? pendingReplyId
        : (editTarget.replyToId ?? null);
      // 竞态排查：编辑截断决策点——记录截断前消息数/截断后消息数/回复继承结果，
      // 若 pendingReplyId 被意外清空或 replyToId 悬空，可从此日志定位时序
      logger.info("streamMessage:editTruncate", {
        sessionId: sid,
        editTargetId: editTarget.id,
        editIndex,
        beforeCount: get().messages.length,
        afterCount: truncated.length,
        editTargetReplyToId: editTarget.replyToId ?? null,
        pendingReplyId,
        pendingSurvives,
        nextReplyToId,
      });
      set({
        messages: truncated,
        editTarget: null,
        pendingReplyToId: nextReplyToId,
      });
      // AB-13 修复：同步截断后端持久化消息，防止切会话/重载后旧消息回显。
      // 编辑场景先等后端截断完成再发流（写前持久化语义），失败不阻断发送。
      if (sessionId) {
        await truncateMessages(sessionId, editTarget.id).catch((e) =>
          handleClientError(
            e,
            {
              module: "stores:chat:message",
              action: "editTruncate",
            },
            "warn",
          ),
        );
      }
    } else {
      // 竞态排查：editTarget 在消息列表中已不存在（可能已被其它流/清空操作移除），
      // 仅清空 editTarget 不截断——若预期截断未发生，检查此日志
      logger.warn("streamMessage:editTruncateMiss", {
        sessionId: sid,
        editTargetId: editTarget.id,
        messageCount: get().messages.length,
      });
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

  // AB-4 修复：regenerate/retry 复用原用户消息 id（existingUserMessageId）时，
  // 不重复创建/追加/落盘用户消息——否则前端显示两条相同用户消息、后端双写。
  let userMessage: Message | null = null;
  if (existingUserMessageId) {
    userMessage =
      get().messages.find((m) => m.id === existingUserMessageId) ?? null;
  }
  const needCreateUserMessage = !userMessage;

  const assistantId = crypto.randomUUID();
  const assistantMessage: Message = {
    id: assistantId,
    role: "assistant",
    content: "",
    timestamp: Date.now(),
    session_id: sessionId || "default",
    blocks: [],
  };

  if (needCreateUserMessage) {
    // #1 修复：流式路径消费 pendingReplyToId——原实现只有非流式 sendMessageImpl
    // 读取它，回复功能（replyToId/被回复标记/引用跳转）在默认流式路径整体失效。
    const pendingReplyId = get().pendingReplyToId;
    userMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: Date.now(),
      session_id: sessionId || "default",
      replyToId: pendingReplyId || undefined,
      attachedImages:
        attachedImages && attachedImages.length > 0
          ? attachedImages
          : undefined,
    };
    // 使用后清除（与 sendMessageImpl 一致）
    if (pendingReplyId) {
      set({ pendingReplyToId: null });
    }
    set({ messages: [...get().messages, userMessage, assistantMessage] });
  } else {
    // 复用场景：用户消息已存在（截断后保留），仅追加 assistant 消息
    set({ messages: [...get().messages, assistantMessage] });
  }

  // 根因 B：写前持久化 — 发送前先落盘用户消息（防断网丢失）
  // 成功 → 后端按 messageId 幂等去重；失败 → 进 outbox，网络恢复后自动补发
  let outboxed = false;
  if (needCreateUserMessage && userMessage) {
    try {
      await chatService.addMessage(userMessage.session_id, userMessage);
    } catch {
      // 落盘失败（断网/后端不可达）→ 暂存 outbox，不阻塞发送流程
      outboxed = true;
      enqueueOutbox(userMessage, userMessage.session_id);
    }
  }
  // 复用场景：用户消息已落盘，无需写前

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

    // AB-8 修复：会话切换守卫 — setMessages 重建消息列表后，
    // 本流 assistant 消息已不在 store（用户已切到其他会话），
    // 若用旧会话快照全量替换会覆盖新会话内容 → 直接丢弃本流快照。
    if (!get().messages.some((m) => m.id === assistantId)) {
      logger.debug("flushSet: 会话已切换，丢弃本流快照", {
        currentVersion,
        assistantId,
        sid,
      });
      batch.pending = false;
      batch.latestMessages = null;
      return;
    }

    if (batch.latestMessages) {
      const latest = batch.latestMessages;
      const latestMsg = latest.find((m) => m.id === assistantId);
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
      // AB-8 修复：定向更新本流 assistant 消息，而非全量替换 store——
      // 多会话并行流式下全量替换会删除其他会话（含并行流）的消息
      if (latestMsg) {
        set({
          messages: get().messages.map((m) =>
            m.id === assistantId ? latestMsg : m,
          ),
        });
      }
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
            // AB-14 修复：写前落盘失败（outbox）也传前端消息 id，
            // 后端创建用户消息时沿用该 id（ChatManager 兜底），保证前后端 id 一致
            messageId: userMessage ? userMessage.id : undefined,
          },
        )
      : chatService.streamMessage(content, sessionId, controller.signal, {
          workMode,
          images: attachedImages,
          // AB-14 修复：写前落盘失败（outbox）也传前端消息 id
          messageId: userMessage ? userMessage.id : undefined,
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
    if (outboxed && userMessage && !controller.signal.aborted) {
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

    // 流结束，冻结所有块（用户取消/异常中断时 todo 不置 done——中止≠全部完成）
    blockBuilder.freezeAll(!controller.signal.aborted);

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

    // P0 修复：抽离"裸探索段"（模型未走 thinking 通道泄漏进正文的工具过程叙述）
    // 为 thinking 块 + 干净正文，保证落盘 blocks 与后端剥离后的 content 一致
    const finalBlocks = reorderExplorationBlocks(blockBuilder.getBlocks());

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

    // 流完成提示音（仅当无待回答 question 且无错误时播放）
    // P1 修复（AB-3）：出错时禁止播放"完成"音，避免失败流被误判为成功
    // AB-15 修复：abort（用户停止/幽灵块检测中断）也禁止播放，中断非成功
    if (!controller.signal.aborted && !hasQuestion && !get().error) {
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

      // R1 修复：流式结束追加 sessionFile 需会话守卫——会话 A 的流在用户
      // 切到会话 B 之后才结束时会污染 B 的 knownFilePaths（BUG-4 只修了
      // setMessages 加载替换路径，流式追加路径未加守卫，FileLink 偶发漂移）。
      // 当前活跃会话以加载时 setMessages 写入的 messages[0].session_id 为准。
      const activeSessionId = get().messages[0]?.session_id ?? "default";
      if (sid === activeSessionId) {
        addFilePathsFromBlocks(
          finalBlocks,
          (file) => get().addSessionFile(file),
          () => get().sessionFiles,
          (files) => set({ sessionFiles: files }),
        );
      }

      // 将 blocks 结构保存到后端
      // AB-15 修复：abort（用户停止/幽灵块检测中断）时不覆盖——
      // 前端中断时的 finalBlocks 可能不完整（ghostCheck 场景后端内容更全），
      // 覆盖会导致数据回退；后端在 abort 时已持久化权威内容，重载即恢复。
      if (sessionId && finalBlocks.length > 0 && !controller.signal.aborted) {
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
        const { getBackendBaseUrl, getApiSecret } =
          await import("../../services/backendUrl");
        // P2: 裸 fetch 需注入 X-API-Key，配置 LIRI_API_SECRET 后缺头会 401
        const headers: Record<string, string> = {};
        const secret = getApiSecret();
        if (secret) headers["X-API-Key"] = secret;
        const resp = await fetch(
          `${getBackendBaseUrl()}/v1/sessions/${sessionId}/checkpoints/latest`,
          { headers },
        );
        if (resp.ok) {
          const data = await resp.json();
          if (data.checkpointAvailable && data.messages?.length > 0) {
            logger.info("从检查点恢复消息", {
              sessionId,
              messageCount: data.messages.length,
            });
            // AB-18 修复：合并去重而非整表替换——前端已渲染消息保留（id 不变 → React
            // DOM 复用，滚动位置/折叠态不丢失），仅补充后端有而前端缺失的消息。
            const backendMsgs = data.messages as Message[];
            const current = get().messages;
            const currentIds = new Set(current.map((m) => m.id));
            const missing = backendMsgs.filter(
              (m) => m?.id && !currentIds.has(m.id),
            );
            if (missing.length > 0) {
              set({ messages: [...current, ...missing] });
            }
          }
        }
      } catch {
        // 检查点恢复失败静默处理
      }
    }
    // P1 修复（1.4/1.9）：异常路径兜底——流异常结束且无可见内容时：
    //  - 仅有 thinking 块（模型只输出思考即中断）→ 转 text 让用户看到思考内容，避免"无回复"观感
    //  - 完全无内容 → 添加可见提示块
    // 注：blockBuilder 声明在内层作用域，此处直接操作 store 中 assistant 消息的 blocks。
    {
      const msgsNow = get().messages;
      const aidxNow = msgsNow.findIndex((m) => m.id === assistantId);
      if (aidxNow !== -1 && !get().error) {
        const curMsg = msgsNow[aidxNow];
        const blocksNow = curMsg.blocks ?? [];
        const hasVisible = blocksNow.some(
          (b) =>
            b.type === "text" ||
            b.type === "tool_call" ||
            b.type === "question" ||
            b.type === "todo",
        );
        if (!hasVisible) {
          const nowStamp = Date.now();
          // 1.9：纯 thinking 无正文 → 转 text（与正常路径 think-only 兜底行为一致）
          const thinkingText = blocksNow
            .filter((b) => b.type === "thinking")
            .map((b) => b.content)
            .join("");
          if (thinkingText.trim()) {
            const textBlock = {
              id: `blk_thinkfallback_${nowStamp}`,
              type: "text" as const,
              content: stripStructuralTags(thinkingText),
              isStreaming: false,
              groupId: `grp_thinkfallback_${nowStamp}`,
            };
            set({
              messages: msgsNow.map((m) =>
                m.id === assistantId ? { ...m, blocks: [textBlock] } : m,
              ),
            });
            logger.warn("streamMessage:异常路径 think-only 转 text 兜底", {
              sessionId: sid,
              thinkingLen: thinkingText.length,
              error: error instanceof Error ? error.message : String(error),
            });
          } else {
            // 完全无内容 → 可见提示块
            const fallbackBlock = {
              id: `blk_fallback_${nowStamp}`,
              type: "status" as const,
              content: "⚠️ 本次回复未生成内容，请重试或检查模型/网络状态。",
              isStreaming: false,
              groupId: `grp_fallback_${nowStamp}`,
            };
            set({
              messages: msgsNow.map((m) =>
                m.id === assistantId
                  ? { ...m, blocks: [...blocksNow, fallbackBlock] }
                  : m,
              ),
            });
            logger.warn("streamMessage:异常路径无内容兜底", {
              sessionId: sid,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
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
