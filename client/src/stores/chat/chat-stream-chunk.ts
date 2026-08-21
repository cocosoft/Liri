/**
 * Chat Message Slice — streamMessage 内 processChunk 实现（M4 单轨版本）
 *
 * 从 chat-message.slice.ts 拆出（R04-001 文件行数限制治理）。
 *
 * M4 切换：渲染不再走 ChronologicalBlockBuilder 可变 blocks，
 * 改为 appendChunk → 事件流 → deriveConversationBlocks 纯函数派生。
 * 副作用（streamingStatus / executionPhase / watermarkStore / saveQueue /
 * playWarningSound / dispatchEvent / hasPendingQuestion）保持原逻辑独立运行。
 *
 * 副作用与渲染两条链路分离：
 *   渲染链路：chunk → aggregator.appendChunk → events → deriveMessages → Message[]
 *   副作用链路：chunk → set({streamingStatus / executionPhase / error …}) / watermarkStore / saveQueue …
 */
import type { Message } from "@/types";
import { useContextWatermarkStore } from "@/stores/contextWatermarkStore";
import { playWarningSound } from "@/services/SoundService";
import { stripStructuralTags } from "./chat-toolcall.slice";
import { friendlyErrorSummary } from "@/utils/friendlyError";
import { switchState } from "./chat-message-shared";
import { createLogger } from "@/utils/logger";
import type { SaveQueue } from "./chat-history.slice";
import type { StreamChunk } from "@/services/chatService";
import type { MessageSet, MessageGet } from "./chat-message.types";
import type { EventBasedStreamAggregator } from "./streaming/EventBasedStreamAggregator";

const logger = createLogger("stores:chat:message");

/**
 * P0（2026-08-15）：thinking 预算上限（字符数）。
 * 防止模型输出数万字思考占满正文预算：超限后截断 thinking，
 * 不再进入 store/messages.jsonl，避免上下文爆炸（CS04 根因修复）。
 */
export const MAX_THINKING_CHARS = 16000;

/** 批量更新状态（J4 版本号机制，防止过期 rAF 覆盖最终状态） */
export interface StreamBatchState {
  version: number;
  pending: boolean;
  latestMessages: Message[] | null;
}

/** processChunk 运行时上下文（替代原闭包捕获的局部变量） */
export interface ProcessChunkContext {
  sid: string;
  sessionId?: string;
  assistantId: string;
  controller: AbortController;
  saveQueue: SaveQueue;
  lastChunkTimeRef: { current: number };
  batch: StreamBatchState;
  flushSet: (currentVersion: number) => void;
  set: MessageSet;
  get: MessageGet;
  /** P0（2026-08-15）：thinking 预算跟踪 — 累计字符数，防止数万字思考进 store/messages.jsonl */
  thinkingCharsRef: { current: number; truncated: boolean };
  /** M4：事件聚合器（渲染源。chunk → 事件 → deriveMessages） */
  aggregator: EventBasedStreamAggregator;
}

/**
 * 从聚合器派生出本流 assistant 消息的 blocks（供 saveQueue/外部使用）。
 *
 * 约定：
 *  1. 若 aggregator 派生出的新 messages 中找不到 assistantId，
 *     返回空数组（不应发生，但作为安全兜底）。
 *  2. 返回的 blocks 是非空浅拷贝，避免调用方意外修改聚合器状态。
 */
function deriveAssistantBlocks(
  ctx: ProcessChunkContext,
): Message["blocks"] | undefined {
  const derived = ctx.aggregator.deriveMessages();
  const assistantMsg = derived.find((m) => m.id === ctx.assistantId);
  if (!assistantMsg) return undefined;
  return assistantMsg.blocks;
}

/**
 * 处理单个流式 chunk：M4 单轨版（副作用 + 渲染分离）
 *   - 渲染：aggregator.appendChunk → deriveMessages → batch.latestMessages
 *   - 副作用：保留原有 set(streamingStatus/error/executionPhase/hasPendingQuestion)、
 *     watermarkStore、playWarningSound、window.dispatchEvent、saveQueue 等
 */
export async function processChunk(
  ctx: ProcessChunkContext,
  chunk: StreamChunk,
): Promise<void> {
  const {
    sid,
    sessionId,
    assistantId,
    saveQueue,
    lastChunkTimeRef,
    batch,
    flushSet,
    set,
    get,
  } = ctx;

  // P1-5: 每次收到 chunk 时更新时间戳
  lastChunkTimeRef.current = Date.now();

  // ── 渲染链路 前置守卫：thinking 预算截断（aggregator 之前做，避免事件流污染） ──
  // 注意：
  //   1. thinking 预算截断：若超限，appendToAggregator = false
  //   2. error chunk 去重：若已有 error，appendToAggregator = false（在副作用 switch 内设置）
  //   3. aggregator 调用在副作用 switch 之后（因为 error 去重守卫依赖 get().error 状态可能在副作用里改）
  let appendToAggregator = true;
  if (chunk.type === "thinking") {
    const thinkingChars = ctx.thinkingCharsRef.current;
    if (thinkingChars >= MAX_THINKING_CHARS) {
      ctx.thinkingCharsRef.current += chunk.content.length;
      if (!ctx.thinkingCharsRef.truncated) {
        ctx.thinkingCharsRef.truncated = true;
        logger.warn("processChunk: thinking 超预算截断", {
          sessionId: sid,
          maxChars: MAX_THINKING_CHARS,
          totalChars: ctx.thinkingCharsRef.current,
        });
      }
      appendToAggregator = false;
    } else {
      const remaining = MAX_THINKING_CHARS - thinkingChars;
      const keep =
        chunk.content.length <= remaining
          ? chunk.content
          : chunk.content.slice(0, remaining);
      ctx.thinkingCharsRef.current += keep.length;
      if (
        keep.length < chunk.content.length &&
        !ctx.thinkingCharsRef.truncated
      ) {
        ctx.thinkingCharsRef.truncated = true;
        logger.warn("processChunk: thinking 超预算截断", {
          sessionId: sid,
          maxChars: MAX_THINKING_CHARS,
          totalChars: ctx.thinkingCharsRef.current,
        });
      }
      // 替换成已截断的子串，避免 aggregator 追加超预算思考
      chunk = { ...chunk, content: keep } as StreamChunk;
    }
  }

  // AB-5：以 batch.latestMessages 为累积基准（同帧内多个 chunk 连续累加）
  const current = batch.latestMessages ?? get().messages;
  const msgIdx = current.findIndex((m) => m.id === assistantId);

  if (msgIdx === -1) {
    logger.warn(
      "processChunk: 未找到对应的 assistant 消息（assistantId=%s），跳过 chunk",
      assistantId,
    );
    return;
  }

  // ── 副作用链路：按 chunk 类型执行 set / watermarkStore / 播放音 / dispatch ──
  // （全部保留在 processChunk 内，不写入 aggregator 事件流，避免回放时重复触发副作用）
  switch (chunk.type) {
    case "status":
      set({ streamingStatus: chunk.content });
      break;

    case "reconnect_status":
      set({ streamingStatus: chunk.content });
      break;

    case "context_state": {
      const watermarkStore = useContextWatermarkStore.getState();
      if (chunk.watermarkState) {
        watermarkStore.updateWatermark(chunk.watermarkState);
        // 异常水位：额外 status 块已由 aggregator 写入事件流
      } else {
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
        } else {
          const legacy = chunk.content.match(/上下文水位:\s*(\d+)%/);
          if (legacy) {
            const pct = parseInt(legacy[1], 10);
            const isCompact =
              chunk.content.includes("压缩") || chunk.content.includes("临界");
            watermarkStore.updateWatermark({
              currentTokens: 0,
              contextLimit: 0,
              ratio: pct / 100,
              severity: isCompact ? "compact" : "warn",
            });
          } else {
            // 非水位提示（压缩/召回/降级事件）
            set({ streamingStatus: chunk.content });
          }
        }
      }
      break;
    }

    case "execution_phase":
      if (chunk.executionPhase) {
        const ep = chunk.executionPhase;
        const progressData: {
          phase:
            | "analyzing"
            | "designing"
            | "implementing"
            | "verifying"
            | "presenting";
          progress: number;
          description: string;
          steps: Array<{
            name: string;
            status: "pending" | "in_progress" | "done" | "failed";
          }>;
          totalSteps?: number;
          truncated?: boolean;
          currentStep: string;
        } = {
          phase:
            (ep.phase as
              | "analyzing"
              | "designing"
              | "implementing"
              | "verifying"
              | "presenting") || "analyzing",
          progress: ep.progress || 0,
          description: ep.description || "",
          steps: (
            (ep.steps as Array<{
              name: string;
              status: "pending" | "in_progress" | "done" | "failed";
            }>) || []
          ).map((s) => ({
            name: s.name,
            status: s.status,
          })),
          totalSteps: ep.totalSteps,
          truncated: ep.truncated,
          currentStep: ep.currentStep || "",
        };
        // 截断时 info 级日志（与旧逻辑保持一致）
        const receivedSteps = progressData.steps.length;
        if (ep.truncated) {
          logger.info("execution_phase 收到（steps 已截断）", {
            phase: progressData.phase,
            totalSteps: ep.totalSteps ?? receivedSteps,
            keptSteps: receivedSteps,
            droppedSteps: (ep.totalSteps ?? receivedSteps) - receivedSteps,
            progress: ep.progress,
            currentStep: ep.currentStep ?? "",
          });
        } else {
          logger.debug("execution_phase 收到", {
            phase: progressData.phase,
            totalSteps: ep.totalSteps ?? receivedSteps,
            steps: receivedSteps,
            progress: ep.progress,
            currentStep: ep.currentStep ?? "",
          });
        }
        set({
          executionPhase: {
            phase: progressData.phase,
            progress: progressData.progress,
            description: progressData.description,
          },
        });
      }
      break;

    case "error": {
      // 错误去重：已有 error 状态时仅补充 errorCode，不重复追加 status 块/覆盖错误文本
      const hasExistingError = !!get().error;
      if (!hasExistingError) {
        // 注入友好摘要到 chunk._meta，供 aggregator 渲染 assistant/status 块
        chunk = {
          ...chunk,
          _meta: {
            ...(chunk._meta ?? {}),
            friendlySummary: friendlyErrorSummary(chunk.content),
          },
        } as StreamChunk;
      } else {
        // 已有错误：跳过 aggregator（避免重复 assistant/status 块），
        // 仅保留 system/error 事件用于日志面板
        appendToAggregator = false;
        // 仍写 system/error 到事件流（用于轨迹面板显示，不影响对话视图）
        try {
          ctx.aggregator.appendEvent({
            type: "system/error",
            data: {
              module: "chat:stream",
              action: "streamErrorDeduped",
              error: chunk.content,
              errorCode: chunk.errorCode,
            },
          });
        } catch (e) {
          logger.error("processChunk: system/error 事件注入失败", {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
      if (hasExistingError) {
        set({ errorCode: chunk.errorCode || "UNKNOWN" });
      } else {
        set({
          error: chunk.content,
          errorCode: chunk.errorCode || "UNKNOWN",
        });
      }
      break;
    }

    case "tool_call":
      // _meta 导航建议：create_project 完成后触发前端提示
      if (chunk._meta?.action === "suggest_navigate") {
        window.dispatchEvent(
          new CustomEvent("pyapp:navigate-suggest", {
            detail: chunk._meta,
          }),
        );
      }
      break;

    case "question":
      if (chunk.questionData) {
        logger.debug("收到 question chunk", {
          questionId: chunk.questionData.questionId,
          q: chunk.questionData.question?.slice(0, 40),
          optCnt: chunk.questionData.options?.length,
        });
        // hasPendingQuestion 只由副作用触发，避免回放重复设置
        if (!get().hasPendingQuestion[sid]) {
          set({
            hasPendingQuestion: {
              ...get().hasPendingQuestion,
              [sid]: true,
            },
          });
        }
        playWarningSound();
      }
      break;

    case "doc_workflow":
      if (sessionId) {
        const blocks = deriveAssistantBlocks(ctx);
        if (blocks && blocks.length > 0) {
          saveQueue.enqueue(sessionId, assistantId, blocks, true);
        }
      }
      break;

    case "usage": {
      if (chunk.finishReason === "length" && sessionId) {
        // 关键节点即时落盘：截断时立即持久化
        const blocks = deriveAssistantBlocks(ctx);
        if (blocks && blocks.length > 0) {
          saveQueue.enqueue(sessionId, assistantId, blocks, true);
        }
      }
      if (chunk._meta?.action === "suggest_navigate") {
        window.dispatchEvent(
          new CustomEvent("pyapp:navigate-suggest", {
            detail: chunk._meta,
          }),
        );
      }
      break;
    }
    // 其他 chunk 类型：无额外副作用（或副作用已由 aggregator + 派生产出）
    default:
      break;
  }

  // ── 渲染链路：追加 chunk 到 aggregator（在副作用 switch 之后，因为 error 去重会改 appendToAggregator） ──
  if (appendToAggregator) {
    // 正文 text：先做结构标签剥离，与旧 blockBuilder.addText 行为一致
    if (chunk.type === "text") {
      const cleanContent = stripStructuralTags(chunk.content);
      chunk = { ...chunk, content: cleanContent } as StreamChunk;
    }
    try {
      ctx.aggregator.appendChunk(chunk);
    } catch (e) {
      logger.error("processChunk: aggregator.appendChunk 失败", {
        chunkType: chunk.type,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // tool_call 终态即时落盘：写在 switch 外，因为状态在 chunk.toolCall.status
  if (
    chunk.type === "tool_call" &&
    chunk.toolCall &&
    (chunk.toolCall.status === "completed" ||
      chunk.toolCall.status === "failed")
  ) {
    if (sessionId) {
      logger.info("processChunk: tool_call 终态即时落盘", {
        sessionId,
        toolName: chunk.toolCall.name,
        toolCallId: chunk.toolCall.id,
        status: chunk.toolCall.status,
      });
      const blocks = deriveAssistantBlocks(ctx);
      if (blocks && blocks.length > 0) {
        saveQueue.enqueue(sessionId, assistantId, blocks, true);
      }
    }
  }

  // ── 渲染链路：从 aggregator 派生全量 messages，提取本流 assistant 定向替换 ──
  const derivedAll = ctx.aggregator.deriveMessages();
  const derivedAssistant = derivedAll.find((m) => m.id === assistantId);

  let updatedMsg: Message;
  if (derivedAssistant) {
    // 派生结果中 assistantId 命中（M4 正常路径）：
    //   - blocks/progress/tool_calls/content 走派生（纯函数保证与回放一致）
    //   - 保留已写的 usage/metadata（防止 usage chunk 的数据在 chunk 顺序上位于 assistant/text 之后而丢失）
    const base = current[msgIdx];
    updatedMsg = {
      ...derivedAssistant,
      // usage：usage chunk 的处理发生在 assistant/text 之后，derived 中不会包含 usage
      usage: (base as Message).usage ?? derivedAssistant.usage,
      // 其他辅助字段：如果派生结果无则继承 base（避免派生覆盖了 set 的中间状态）
      error: (base as Message).error ?? derivedAssistant.error,
      metadata: (base as Message).metadata ?? derivedAssistant.metadata,
    };
  } else {
    // 派生结果不含本流 assistant（极端情况：尚未产生任何 assistant/* 事件，
    // 如 chunk 全是 context_state/usage/execution_phase 这类非对话事件）。
    // 保留 base，仅确保 blocks 至少存在空数组
    updatedMsg = {
      ...current[msgIdx],
      blocks: current[msgIdx].blocks ?? [],
    };
  }

  const newMessages = [...current];
  newMessages[msgIdx] = updatedMsg;
  batch.latestMessages = newMessages;

  // J4：批量更新——仅在无挂起 flush 时调度微任务
  if (!batch.pending) {
    batch.pending = true;
    Promise.resolve()
      .then(() => requestAnimationFrame(() => flushSet(++batch.version)))
      .catch(() => {
        /* flushSet 异常不阻塞后续更新 */
      });
  }

  // J3：流式传输中实时防抖保存 blocks
  if (sessionId && updatedMsg.blocks && updatedMsg.blocks.length > 0) {
    if (switchState.lock) {
      switchState.pending.push({
        sessionId,
        assistantId,
        blocks: updatedMsg.blocks,
      });
    } else {
      saveQueue.enqueue(sessionId, assistantId, updatedMsg.blocks);
    }
  }
}
