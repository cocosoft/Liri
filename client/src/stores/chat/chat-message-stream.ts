/**
 * Chat Message Slice — streamMessage 实现
 *
 * 从 chat-message.slice.ts 拆出（R04-001 文件行数限制治理）。
 * streamMessage：流式发送主流程（写前持久化 + SSE 消费 + 批量更新 +
 * 无内容兜底 + 检查点恢复），chunk 处理委托 chat-stream-chunk.ts。
 */
import type {
  Message,
  MessageBlock,
  AttachedImage,
  LiriEvent,
  LiriEventType,
} from "@/types";
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
  createThinkExtractor,
  stripStructuralTags,
  reorderExplorationBlocks,
} from "./chat-toolcall.slice";
import { addFilePathsFromBlocks } from "./chat-file.slice";
import { SaveQueue, staleSessionCache } from "./chat-history.slice";
import { handleClientError } from "@/utils/handleError";
import { toastWarning } from "@/stores/toastStore";
import i18n from "@/i18n";
import { removeStreamController } from "./chat-message-shared";
import { useTrajectoryStore } from "./trajectoryStore";
import {
  processChunk,
  type ProcessChunkContext,
  type StreamBatchState,
} from "./chat-stream-chunk";
import type { MessageSet, MessageGet } from "./chat-message.types";
import { EventBasedStreamAggregator } from "./streaming/EventBasedStreamAggregator";
import { trajectoryService } from "@/services/trajectoryService";

// P8（2026-08-25）：稀疏基线——骨架（turn/tool_call/result 全量，重建 toolCallSeqMap）
// + 最近 N 条完整事件（尾部正文可见），更早正文按需 loadMore，降低长会话常驻内存。
const SKELETON_TYPES: LiriEventType[] = [
  "turn/start",
  "turn/end",
  "assistant/tool_call",
  "tool/result",
];
const TAIL_COMPLETE_COUNT = 500;

async function loadSparseBaseline(sid: string): Promise<LiriEvent[]> {
  const skeleton = await trajectoryService.getEvents(sid, {
    types: SKELETON_TYPES,
    limit: 10000,
  });
  const tailStart = Math.max(1, skeleton.tailSeq - TAIL_COMPLETE_COUNT + 1);
  const tail = await trajectoryService.getEvents(sid, {
    fromSeq: tailStart,
    limit: TAIL_COMPLETE_COUNT,
  });
  // 合并 + 按 seq 去重排序
  const bySeq = new Map<number, LiriEvent>();
  for (const e of [...skeleton.events, ...tail.events]) bySeq.set(e.seq, e);
  return Array.from(bySeq.values()).sort((a, b) => a.seq - b.seq);
}

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
  // 阶段2 对齐：该会话存在挂起流 —— 拦截发送（需先"立即恢复"或"放弃本次回复"）。
  // 与 sendMessageImpl 的 paused 拦截保持一致：挂起流尚未结束，直接 abort 旧流
  // 并发新消息会破坏挂起语义（N8：流恢复后旧回复会继续写入，与新一轮回复错乱）。
  if (get().pausedStreams[sid]) {
    logger.warn("streamMessage: 会话存在挂起流，拦截发送", { sessionId: sid });
    return;
  }
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
            // P0 根治（2026-08-14）：透传前端流式消息 id → 后端 createAssistantMessage
            // 复用 → updateMessageBlocks(assistantId) 命中落盘，刷新后 blocks 一致
            assistantMessageId: assistantId,
          },
        )
      : chatService.streamMessage(content, sessionId, controller.signal, {
          workMode,
          images: attachedImages,
          // AB-14 修复：写前落盘失败（outbox）也传前端消息 id
          messageId: userMessage ? userMessage.id : undefined,
          // P0 根治（2026-08-14）：透传前端流式消息 id（同上）
          assistantMessageId: assistantId,
        });
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
      // 阶段2：挂起中的流不参与幽灵检测——否则 30s 无 chunk 会误判
      // "任务已死"并 abort 挂起流（挂起时后端本来就不在发 chunk）
      if (get().pausedStreams[sid]) return;
      if (Date.now() - lastChunkTimeRef.current < 30000) return;

      // 30s 无 chunk：ping 后端确认会话状态
      try {
        // W6 收尾（2026-08-31）：改走统一 http 客户端（Tauri 下 Rust 代理注入密钥）
        const { http } = await import("../../services/httpClient");
        const resp = await http.get<{ streaming?: boolean }>(
          `/v1/sessions/${sessionId || "default"}/streaming`,
        );
        if (resp.ok && resp.data && !resp.data.streaming) {
          logger.warn(
            "幽灵块检测：后端报告会话流已结束，但前端仍在等待 chunk",
            { sessionId },
          );
          clearInterval(ghostCheckTimer);
          controller.abort();
        }
      } catch {
        // ping 失败静默处理，不干扰主流程
      }
    }, 10000);

    // M4：初始化事件聚合器（渲染源。chunk → 事件 → deriveMessages）
    // 从后端拉取已有 events 作为基线，流式过程中追加新事件。
    // assistantMessageId 透传给派生函数，确保派生产物的 assistant id 与
    // store 中提前占位的 assistantId UUID 一致（否则 flushSet 定向替换命中失败）。
    //
    // P0-1 修复：初始化失败守卫 + 健康度跟踪
    // 历史问题：一次瞬时 getEvents 网络抖动 → aggregator 未初始化 → 流式渲染全程空 blocks →
    // 流结束时触发"⚠️ 未生成内容"兜底 → finalBlocks 覆盖后端已持久化的正常 blocks（数据回退）
    const streamAggregator = new EventBasedStreamAggregator();
    /** P0-1：聚合器健康度标志（false 时最终落盘跳过覆盖，后端权威数据优先） */
    let aggregatorHealthy = true;
    try {
      const eventsResult = { events: await loadSparseBaseline(sid) };
      await streamAggregator.init(eventsResult.events, sid, {
        assistantMessageId: assistantId,
      });
      logger.debug("[P0-1:streamMessage] 聚合器初始化成功", {
        sessionId: sid,
        assistantId,
        baselineEvents: eventsResult.events.length,
        tailSeq: streamAggregator.getTailSeq(),
      });
    } catch (e) {
      // P0-1 修复：初始化失败重试 1 次（防抖 500ms 后立即重试）
      logger.warn("[P0-1:streamMessage] 聚合器初始化首次失败，500ms 后重试", {
        sessionId: sid,
        error: e instanceof Error ? e.message : String(e),
      });
      try {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const eventsResult = await trajectoryService.getEvents(sid, {
          limit: 10000,
        });
        await streamAggregator.init(eventsResult.events, sid, {
          assistantMessageId: assistantId,
        });
        logger.info("[P0-1:streamMessage] 聚合器初始化重试成功", {
          sessionId: sid,
          assistantId,
          baselineEvents: eventsResult.events.length,
        });
      } catch (retryErr) {
        // P0-1 修复：重试仍失败 → 置 aggregatorHealthy=false，最终落盘跳过覆盖
        aggregatorHealthy = false;
        logger.warn(
          "[P0-1:streamMessage] 聚合器初始化重试失败，标记为不健康，最终落盘将跳过覆盖",
          {
            sessionId: sid,
            error:
              retryErr instanceof Error ? retryErr.message : String(retryErr),
            consequence: "本次回复仅显示后端快照，不会覆盖后端已持久化数据",
          },
        );
        // P0-1 修复：用户侧 toast（轨迹初始化失败 → 仅显示后端快照）
        toastWarning(i18n.t("chat.aggregatorInitFailed"));
      }
    }

    // processChunk 运行上下文（显式注入替代原闭包捕获）
    // P0（2026-08-15）：thinkingCharsRef 跟踪流内 thinking 累计长度，超预算截断
    const chunkCtx: ProcessChunkContext = {
      sid,
      sessionId,
      assistantId,
      controller,
      saveQueue,
      lastChunkTimeRef,
      batch,
      flushSet,
      set,
      get,
      thinkingCharsRef: { current: 0, truncated: false },
      aggregator: streamAggregator,
    };

    // ── A2：轨迹面板实时同步（rAF 节流，会话匹配才更新） ──
    //   - 仅在用户打开轨迹面板且正在看当前会话时才写入（由 trajectoryStore.setLiveEvents 内守卫判断）
    //   - 60fps 上限，1 帧内多个 chunk 合并一次同步
    //   - **关键**：同步拍快照（events/tailSeq），避免异步回调时 aggregator 已被 reset 清空导致覆盖为空
    //   - 流式结束后强制同步一次，确保最终状态与后端落盘后刷新一致
    let trajSyncRafId: number | null = null;
    let trajSyncPending = false;
    let trajSyncCallCount = 0;
    const doSync = (opts: { force: boolean; callSeq: number }): void => {
      trajSyncPending = false;
      trajSyncRafId = null;
      // 同步拍快照：避免后续 aggregator.reset() 把我们要同步的数据抹掉
      const snapEvents = streamAggregator.getEvents();
      const snapTailSeq = streamAggregator.getTailSeq();
      const snapEventsLen = snapEvents.length;
      logger.debug("[A2:doSync] snapshot", {
        callSeq: opts.callSeq,
        force: opts.force,
        sessionId: sid,
        snapTailSeq,
        snapEventsLen,
        lastEventType:
          snapEventsLen > 0 ? snapEvents[snapEventsLen - 1].type : "<empty>",
        lastEventSeq: snapEventsLen > 0 ? snapEvents[snapEventsLen - 1].seq : 0,
      });
      try {
        const store = useTrajectoryStore.getState();
        if (!store) {
          logger.debug(
            "[A2:doSync] skip: useTrajectoryStore.getState() returned null",
            {
              callSeq: opts.callSeq,
            },
          );
          return;
        }
        logger.debug("[A2:doSync] before setLiveEvents", {
          callSeq: opts.callSeq,
          storeSessionId: store.sessionId,
          storeTailSeq: store.tailSeq,
          storeEventsLen: store.events.length,
          match: store.sessionId === sid,
        });
        store.setLiveEvents(sid, snapEvents, snapTailSeq);
        logger.debug("[A2:doSync] after setLiveEvents", {
          callSeq: opts.callSeq,
          storeTailSeq: store.tailSeq,
          storeEventsLen: store.events.length,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn(
          "[A2:doSync] trajectory store 访问失败（非关键路径，已忽略）",
          {
            callSeq: opts.callSeq,
            error: msg,
          },
        );
      }
    };
    const scheduleTrajSync = (force: boolean = false): void => {
      trajSyncCallCount += 1;
      const callSeq = trajSyncCallCount;
      const curTail = streamAggregator.getTailSeq();
      const curEventsLen = streamAggregator.getEvents().length;
      if (trajSyncPending && !force) {
        logger.debug("[A2:schedule] skip (pending && !force)", {
          callSeq,
          force,
          aggregatorTailSeq: curTail,
          aggregatorEventsLen: curEventsLen,
        });
        return;
      }
      trajSyncPending = true;
      logger.debug("[A2:schedule] entered", {
        callSeq,
        force,
        pendingNow: trajSyncPending,
        rafIdNotNull: trajSyncRafId !== null,
        aggregatorTailSeq: curTail,
        aggregatorEventsLen: curEventsLen,
      });
      if (force) {
        // 强制同步：cancel 挂起的 rAF，立即执行
        if (trajSyncRafId !== null) {
          logger.debug("[A2:schedule] cancel pending rAF (force=true)", {
            callSeq,
            oldRafId: trajSyncRafId,
          });
          cancelAnimationFrame(trajSyncRafId);
        }
        doSync({ force: true, callSeq });
      } else if (trajSyncRafId === null) {
        trajSyncRafId = requestAnimationFrame(() =>
          doSync({ force: false, callSeq }),
        );
        logger.debug("[A2:schedule] requestAnimationFrame scheduled", {
          callSeq,
          rafId: trajSyncRafId,
        });
      } else {
        logger.debug(
          "[A2:schedule] wait existing rAF (trajSyncPending marked)",
          {
            callSeq,
            existingRafId: trajSyncRafId,
          },
        );
      }
    };

    // 2026-08-24 中断提示链路：流是否正常收尾的标志。
    // receivedDone/接收 done chunk；receivedError/接收 error chunk（SSE 断开等）。
    // 流结束但两者皆假 = 异常中断（用户停止 / 幽灵块检测 / 后端静默中断），
    // 需标记消息 finishReason 供 ChatMessage 显示中断提示。
    let receivedDone = false;
    let receivedError = false;

    for await (const rawChunk of generator) {
      // 检查是否已被中止
      if (controller.signal.aborted) break;

      // 阶段2：断连挂起 —— 不结束流、不当作错误。写暂停状态后继续
      // 阻塞等待生成器内部恢复（后端恢复自动续传 / 用户点"立即恢复"）
      if (rawChunk.type === "paused") {
        logger.warn("streamMessage: 流已挂起（后端断连），等待恢复续传", {
          sessionId: sid,
        });
        get().pauseStream(sid);
        continue;
      }

      // 正常收尾标志（rawChunk 层与子 chunk 层都检查，覆盖 chatService
      // 解析路径与 extractor 拆分路径）
      if (rawChunk.type === "done") receivedDone = true;
      if (rawChunk.type === "error") receivedError = true;

      const chunks = Array.from(extractor.extract(rawChunk));
      for (const chunk of chunks) {
        chunkCount++;
        // 子 chunk 层标志（extractor 可能拆分出 done/error）
        if (chunk.type === "done") receivedDone = true;
        if (chunk.type === "error") receivedError = true;
        await processChunk(chunkCtx, chunk);
      }
      // A2：每帧最多一次轨迹同步（节流）
      scheduleTrajSync();
    }

    // 处理未闭合的 think 标签
    if (!controller.signal.aborted) {
      for (const chunk of extractor.flush()) {
        await processChunk(chunkCtx, chunk);
      }
      scheduleTrajSync();
    }

    // 根因 B：流式发送正常结束 → 后端已持久化该轮用户消息，清除该会话待补发消息（避免重复补发）
    if (outboxed && userMessage && !controller.signal.aborted) {
      clearOutboxForSession(userMessage.session_id);
    }

    // A2：流结束 —  cancel 挂起 rAF + 强制同步一次最终状态（轨迹面板显示到最后一个事件）
    if (trajSyncRafId !== null) {
      cancelAnimationFrame(trajSyncRafId);
      trajSyncRafId = null;
    }
    scheduleTrajSync(true); // force=true：立即同步

    // 清除防抖定时器已在 SaveQueue.flush() 内部处理
    // P1-5: 清除幽灵块检测定时器
    clearInterval(ghostCheckTimer);
    await saveQueue.flush();

    // M4：从 aggregator 派生最终 assistant 消息的 blocks（作为后续兜底/完整性检查/落盘的权威源）
    const derivedMsgs = streamAggregator.deriveMessages();
    // P0-2 修复：使用 findLast 取最后一条匹配消息（而非 find 取第一条）。
    // 当历史事件中存在多条同 ID 的 assistant 消息时（因 assistantMessageId 透传），
    // 第一条匹配的是历史消息，最后一条才是当前流式消息。
    const derivedAsstMsg = [...derivedMsgs]
      .reverse()
      .find((m) => m.id === assistantId);
    const derivedBlocks: Message["blocks"] = derivedAsstMsg?.blocks ?? [];

    // 2026-08-24 中断提示链路：异常结束判定（v3 修正①）。
    // 流结束但从未收到 done/error chunk = 异常中断（用户停止 / 幽灵块检测 /
    // 后端静默中断 / SSE 断开未走 error 路径）。已收到 error chunk 时已有
    // "连接已断开"提示，不再重复标记（receivedError=true 走正常落盘）。
    const abnormallyEnded = !receivedDone && !receivedError;

    // 流式结束后重置聚合器（事件已由后端追加到 events.jsonl 持久化，本地 events 丢弃避免内存泄漏）
    const preResetTail = streamAggregator.getTailSeq();
    const preResetEventsLen = streamAggregator.getEvents().length;
    logger.debug("[A2:stream-end] about to streamAggregator.reset()", {
      sessionId: sid,
      preResetTail,
      preResetEventsLen,
      assistantId,
    });
    streamAggregator.reset();
    logger.debug("[A2:stream-end] streamAggregator.reset() done", {
      sessionId: sid,
      afterResetTail: streamAggregator.getTailSeq(),
      afterResetEventsLen: streamAggregator.getEvents().length,
    });

    // P3-2: 无内容兜底 — 流正常结束（非用户取消）但未生成任何用户可见成果时处理。
    // 修复（2026-08-15）：tool_call 不算"可见结果"——工具调用成功但无正文会触发兜底
    let noVisibleResultTriggered = false;
    let finalBlocks: Message["blocks"] = derivedBlocks ?? [];
    if (!controller.signal.aborted) {
      const hasVisibleResult = derivedBlocks.some(
        (b) =>
          b.type === "text" ||
          b.type === "question" ||
          b.type === "todo" ||
          // CM-5（2026-08-25）：code_run 执行块是用户可见成果，避免触发无内容兜底
          b.type === "code_run",
      );
      if (!hasVisibleResult) {
        noVisibleResultTriggered = true;
        // 1) think-only（只有 thinking 没有 text/question/todo）→ 转 text 兜底
        const thinkingText = derivedBlocks
          .filter((b) => b.type === "thinking")
          .map((b) => b.content)
          .join("");
        if (thinkingText.trim()) {
          // 重建：保留 tool_call/status/progress 等非 thinking 块，
          // 丢弃原 thinking 块 + 追加清洗后的思考 text。
          // 与旧 blockBuilder.reset + addText 行为一致（思考内容不重复）。
          const nowStamp = Date.now();
          const fallbackTextBlock: MessageBlock = {
            id: `blk_thinkfallback_${nowStamp}`,
            type: "text",
            content: stripStructuralTags(thinkingText),
            isStreaming: false,
            groupId: `grp_thinkfallback_${nowStamp}`,
          };
          finalBlocks = [
            ...derivedBlocks.filter((b) => b.type !== "thinking"),
            fallbackTextBlock,
          ];
          logger.warn("streamMessage:think-only 转 text 兜底", {
            sessionId: sid,
            thinkingLen: thinkingText.length,
            thinkingText,
            blockTypes: derivedBlocks.map((b) => b.type),
          });
        } else {
          // 2) 完全无内容 → 提示重试（追加 status 块）
          const nowStamp = Date.now();
          const fallbackBlock: MessageBlock = {
            id: `blk_fallback_${nowStamp}`,
            type: "status",
            content: "⚠️ 本次回复未生成内容，请重试或检查模型/网络状态。",
            isStreaming: false,
            groupId: `grp_fallback_${nowStamp}`,
          };
          finalBlocks = [...derivedBlocks, fallbackBlock];
          logger.warn("streamMessage:无内容兜底触发", {
            sessionId: sid,
            blockCount: derivedBlocks.length,
            blockTypes: derivedBlocks.map((b) => b.type),
          });
        }
      }
    }

    // ── 流结束诊断埋点：记录结束原因 / 触发条件 / 耗时 / 块统计，供排查"无回复/卡死"类问题 ──
    {
      const blockStats: Record<string, number> = {};
      for (const b of finalBlocks) {
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

    // P3-1: 流完整性检查 — 检测未完成的 tool_call 块，标记中断状态
    const incompleteToolCalls = finalBlocks.filter(
      (b) => b.type === "tool_call" && b.toolCall?.status === "running",
    );
    if (incompleteToolCalls.length > 0) {
      const names = incompleteToolCalls
        .map((b) => b.toolCall?.name)
        .filter(Boolean)
        .join("、");
      const nowStamp = Date.now();
      const interruptBlock: MessageBlock = {
        id: `blk_interrupt_${nowStamp}`,
        type: "status",
        content: `⚠️ 任务中断：以下工具未完成 — ${names || `${incompleteToolCalls.length} 个工具`}`,
        isStreaming: false,
        groupId: `grp_interrupt_${nowStamp}`,
      };
      finalBlocks = [...finalBlocks, interruptBlock];
      logger.warn("流完整性检查：发现未完成的 tool_call", {
        count: incompleteToolCalls.length,
        names,
      });
    }

    // reorderExplorationBlocks：抽离"裸探索段"（泄漏进正文的工具过程叙述）
    // 为 thinking 块 + 干净正文，保证落盘 blocks 与后端剥离后的 content 一致
    finalBlocks = reorderExplorationBlocks(finalBlocks);

    // 关键修复（2026-08-23）：流式结束后移除 progress 块。
    // 旧版 ChronologicalBlockBuilder.freezeAll 会移除执行中的 progress 块
    // （"正在执行工具"等临时状态不应作为正文保留），但 M4 事件派生路径
    // 派生的 progress 块不会自动清理，导致执行结束后进度卡片残留。
    // 仅正常/中断结束都移除（progress 是瞬态，StatusFloatBar 负责流式中展示）。
    {
      const before = finalBlocks.length;
      finalBlocks = finalBlocks.filter((b) => b.type !== "progress");
      if (finalBlocks.length !== before) {
        logger.info("streamMessage:流结束移除 progress 块", {
          removed: before - finalBlocks.length,
          blockTypes: finalBlocks.map((b) => b.type),
        });
      }
    }

    // 版本号递增：使 pending 的 rAF flushSet 全部失效，
    // 旧版本的回调被丢弃，不再覆盖最终状态
    batch.version++;
    batch.latestMessages = null;
    batch.pending = false;

    // 检查最终 blocks 中是否有 question 块（仅用于完成音判断）
    const hasQuestion = finalBlocks.some((b) => b.type === "question");
    // BUG-11 修复（2026-08-23）：流结束**清除** hasPendingQuestion 而非"检测 finalBlocks
    // 置 true"——question 等待期间流是挂起不结束的，正常结束即已答完；历史残留的
    // question 块不应点亮等待态（真正的等待态只由 question chunk S1 驱动）。
    set({
      hasPendingQuestion: {
        ...get().hasPendingQuestion,
        [sid]: false,
      },
    });

    // 流完成提示音（仅当无待回答 question 且无错误时播放）
    // P1 修复（AB-3）：出错时禁止播放"完成"音，避免失败流被误判为成功
    // AB-15 修复：abort（用户停止/幽灵块检测中断）也禁止播放，中断非成功
    if (!controller.signal.aborted && !hasQuestion && !get().error) {
      playCompletionSound();
    }

    // 立即重置流式状态，让 UI 立刻响应（ThinkingBlock 收缩、tool_call 停止旋转）
    // 不等待 updateMessageBlocks 完成（标题自动重命名由后端负责，P1-4）
    // P2-2: 仅清理本会话控制器，其他会话流不受影响
    // F2 修复：传本流 controller 引用校验——同会话新流已注册时不误删（见 removeStreamController）
    const nextControllers = removeStreamController(
      get().streamControllers,
      sid,
      controller,
    );
    const nextIsStreaming = Object.keys(nextControllers).length > 0;
    // 流式结束日志（正常路径）：记录会话/abort/剩余活跃流数/推导结果，
    // 便于排查 ProjectsPage 等订阅 isStreaming 的组件是否在正确时机收到 false。
    logger.info("streamMessage:流式正常结束", {
      sessionId: sid,
      assistantId,
      aborted: controller.signal.aborted,
      remainingActiveStreams: Object.keys(nextControllers).length,
      nextIsStreaming,
      // ProjectsPage 等组件依赖此字段决定是否自动切换会话
      willNotifyStreamingEnd: !nextIsStreaming,
    });
    set({
      isSending: false,
      isInputBlocked: false,
      isStreaming: nextIsStreaming,
      streamingStatus: "",
      streamControllers: nextControllers,
      executionPhase: null,
    });

    // 构建最终消息并写入 store
    const finalMessages = get().messages;
    const finalMsgIdx = finalMessages.findIndex((m) => m.id === assistantId);
    if (finalMsgIdx !== -1) {
      const msg = {
        ...finalMessages[finalMsgIdx],
        blocks: finalBlocks,
        // 2026-08-24 中断提示链路（v3 修正④）：流结束标记 finishReason。
        // 必须走 set() 不可变更新（新数组引用）触发 ChatMessage 重渲染；
        // 直接改属性在 Zustand 下不触发渲染（隐藏的第 5 处断裂）。
        // 优先级：异常/abort → 'abort'；已收到 error chunk → 'error'
        //（已有"连接已断开"提示，3.4 对 error 不重复渲染中断提示）；正常结束不设置。
        ...(abnormallyEnded || controller.signal.aborted
          ? { finishReason: "abort" as const }
          : receivedError
            ? { finishReason: "error" as const }
            : {}),
      };
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
      //
      // P0-1 修复：聚合器不健康时跳过覆盖（后端权威数据优先）
      // 场景：aggregator 初始化失败 → 流式渲染全程空 blocks → finalBlocks 仅含兜底 status 块
      // → 覆盖会永久丢失后端已持久化的正常内容（数据回退）
      const isAggregatorFallbackOnly =
        finalBlocks.length === 1 &&
        finalBlocks[0].type === "status" &&
        typeof finalBlocks[0].content === "string" &&
        finalBlocks[0].content.includes("未生成内容");
      const shouldSkipOverwrite =
        controller.signal.aborted ||
        (!aggregatorHealthy && isAggregatorFallbackOnly);
      if (sessionId && finalBlocks.length > 0 && !shouldSkipOverwrite) {
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
      } else if (!aggregatorHealthy && isAggregatorFallbackOnly) {
        // P0-1 日志：跳过覆盖边界情况记录（用户应看到后端快照，前端仅显示兜底提示）
        logger.warn(
          "[P0-1:streamMessage] 聚合器不健康且 finalBlocks 仅含兜底块，跳过覆盖后端数据",
          {
            sessionId,
            assistantId,
            finalBlocksCount: finalBlocks.length,
            firstBlockType: finalBlocks[0]?.type,
            aggregatorHealthy,
          },
        );
      }
    }

    // 自动重命名由后端 autoGenerateTitle 唯一负责（P1-4 消除双责任方竞态），
    // 前端仅响应 session:renamed SSE 刷新标题（P2-4）。

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
        // W6 收尾（2026-08-31）：改走统一 http 客户端（Tauri 下 Rust 代理注入密钥）
        const { http } = await import("../../services/httpClient");
        const resp = await http.get<{
          checkpointAvailable?: boolean;
          messages?: Message[];
        }>(`/v1/sessions/${sessionId}/checkpoints/latest`);
        if (resp.ok) {
          const data = resp.data;
          const backendMsgs = data?.messages ?? [];
          if (data?.checkpointAvailable && backendMsgs.length > 0) {
            logger.info("从检查点恢复消息", {
              sessionId,
              messageCount: backendMsgs.length,
            });
            // AB-18 修复：合并去重而非整表替换——前端已渲染消息保留（id 不变 → React
            // DOM 复用，滚动位置/折叠态不丢失），仅补充后端有而前端缺失的消息。
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
    // 修复（2026-08-15）：与正常路径一致，tool_call 不再算"可见结果"，保证
    // "工具调用成功 + 无正文"场景也会触发 think-only 转 text 兜底。
    {
      const msgsNow = get().messages;
      const aidxNow = msgsNow.findIndex((m) => m.id === assistantId);
      if (aidxNow !== -1 && !get().error) {
        const curMsg = msgsNow[aidxNow];
        const blocksNow = curMsg.blocks ?? [];
        const hasVisible = blocksNow.some(
          (b) =>
            b.type === "text" || b.type === "question" || b.type === "todo",
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
    // F2 修复：传本流 controller 引用校验——同会话新流已注册时不误删（见 removeStreamController）
    const nextControllers = removeStreamController(
      get().streamControllers,
      sid,
      controller,
    );
    const nextIsStreamingOnError = Object.keys(nextControllers).length > 0;
    // 流式结束日志（错误/中止路径）：记录会话/abort/错误信息/剩余活跃流数/推导结果，
    // 与正常路径日志对齐，便于对比两条路径的 isStreaming 切换时机。
    logger.warn("streamMessage:流式异常结束", {
      sessionId: sid,
      assistantId,
      aborted: controller.signal.aborted,
      error: error instanceof Error ? error.message : String(error),
      remainingActiveStreams: Object.keys(nextControllers).length,
      nextIsStreaming: nextIsStreamingOnError,
      willNotifyStreamingEnd: !nextIsStreamingOnError,
    });
    set({
      error: !controller.signal.aborted ? String(error) : null,
      isSending: false,
      isInputBlocked: false,
      isStreaming: nextIsStreamingOnError,
      streamingStatus: "",
      streamControllers: nextControllers,
      executionPhase: null,
    });
    // 消息排队：即使出错也消费队列
    tryDequeue();
  }
}
