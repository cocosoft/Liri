// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * S2（2026-11-19，`.trae/specs/core-api-impl-split.md`）：`chatStream` 及其私有助手。
 *
 * **纯搬迁**（只搬不改）：宿主成员经 `ChatStreamOpsDeps` 端口取用；`_fileOldContentCache`
 * 随之归本类所有（原只被 chatStream 使用）。行为、日志与顺序均逐字不变。
 */
import { configManager } from '@openliri/infra/config';
import {
  resolveStreamFinishReason,
  terminationReasonField,
} from '@openliri/service/runtime/api/streamTermination';
import {
  accumulateStreamUsage,
  describeStreamError,
} from './chatStreamTurnHelpers';
import type { ChatRequest, ChatResponse, ChatStreamChunk } from './CoreAPI';
import type { ChatManager } from '@modules/chat';
import type { LiriEvent } from '@modules/session/types/events';
import type { Message } from '@modules/session/types/message';
import { emitToolCallEnd, emitToolCallStart } from './toolCallStreamChunks';
import { getOTelTracing } from '@openliri/infra/monitoring/otel/OTelTracing';
import { SpanStatusCode } from '@opentelemetry/api';
import { handleError, AppError } from '@openliri/infra/error';
import { getLogger } from '@openliri/infra/monitoring';
import { STATUS_TYPE } from '@shared/types';
import type { SessionTitling } from '@openliri/service/runtime/api/sessionTitling';
import type { LlmChatOps } from './llmChatOps';

const logger = getLogger('runtime:api:chatStreamOps');

/**
 * G-1 / D-l（2026-10-11，Spec `daily-budget-over-limit-ux.md`）：流式 `error` 块的**真实业务错误码**。
 *
 * 仅 `AppError` 携带业务码；其余（普通 `Error` / provider 返回的普通对象）无业务码 ⇒ 由传输层
 * 回落 `UNKNOWN`（`chat-handlers.ts` 的 `chunk.errorCode || 'UNKNOWN'`）。收敛为纯函数以便单测：
 * 此前内联导致业务码在传输层被抹平 ⇒ 前端无法按码分流（限额提示只能当通用错误渲染）。
 *
 * S2（2026-11-19）：随 `chatStream` 搬迁至本文件（原在 `CoreAPIImpl.ts`，消费面为本文件）。
 */
export function resolveStreamErrorCode(error: unknown): string | undefined {
  return error instanceof AppError ? error.code : undefined;
}

/**
 * D-l（2026-10-11，Spec §5-A / §10-9）：流式失败时的 fallback 落盘判定。
 *
 * 既有行为：零产出且有 `sessionId` 时落一条 assistant fallback 消息（Write-Ahead，避免刷新后空白）。
 * **撞限例外**：日预算耗尽是**本机环境状态**、不是对话内容 ⇒ 落盘会把它写进对话上下文
 * （后续模型会读到 + 跨机重放分叉）⇒ `DAILY_BUDGET_EXCEEDED` 时**跳过**落盘（仅留日志/审计）。
 *
 * P8（2026-10-17）：**任何带业务码的失败**都跳过通用 fallback —— 流式 `error` chunk
 * 已把真实原因/出路展示给用户；再落一条「未能生成回复」的泛化消息会形成重复。
 * 仅**无业务码**的未知失败保留 Write-Ahead 兜底。
 *
 * S2（2026-11-19）：随 `chatStream` 搬迁至本文件（原在 `CoreAPIImpl.ts`，消费面为本文件）。
 */
export function shouldPersistStreamFallback(input: {
  fullContent: string;
  sessionId: string;
  errorCode?: string;
}): boolean {
  if (input.fullContent || !input.sessionId) return false;
  return input.errorCode === undefined;
}

export interface ChatStreamOpsDeps {
  getChatManager(): ChatManager;
  getSessionTitling(): SessionTitling;
  getLlmChatOps(): LlmChatOps;
  /** 宿主 `_modelName` 写入端口（chatStream 解析出模型后回写） */
  setModelName(model: string): void;
}

export class ChatStreamOps {
  /** E-1 diff（2026-08-23）：文件变更前后 unified diff 缓存（仅 chatStream 使用） */
  private readonly _fileOldContentCache = new Map<string, string>();

  constructor(private readonly deps: ChatStreamOpsDeps) {}

  async *chatStream(
    request: ChatRequest
  ): AsyncGenerator<ChatStreamChunk, ChatResponse, unknown> {
    const otel = getOTelTracing();
    const span = otel.startSpan('coreapi.chatStream', {
      'session.id': request.sessionId ?? '',
    });
    const chatStreamStartTime = Date.now();
    logger.info('chatStream:入口', {
      sessionId: request.sessionId ?? '',
      model: request.model ?? '',
      contentLength: request.content?.length ?? 0,
      messageId: request.messageId ?? '',
      maxTokens: request.max_tokens ?? undefined,
      temperature: request.temperature ?? undefined,
    });
    await this.deps.getLlmChatOps().ensureLLMClientInitialized();
    // D-227（2026-10-02）：app 层符号改为**方法内动态导入**（仅 R00-003 上报）。
    // 同一方法内只取一次；`eventNotificationService` 在 try 内 `.on` 与 finally 内 `.off` 复用。
    const { computeUnifiedDiff, eventNotificationService } =
      await import('@modules/chat');
    let fullContent = '';
    let finalSessionId = request.sessionId || '';
    let finalMessageId = '';
    let capturedUsage:
      | {
          inputTokens: number;
          outputTokens: number;
          totalTokens: number;
          estimatedCostUsd?: number;
          cacheReadTokens?: number;
          cacheCreationTokens?: number;
        }
      | undefined;
    let finalMessage: Message | undefined;
    // P1 修复（AB-3）：流式出错标记。catch 中置 true，
    // 结束时 finishReason 必须为 'error'，禁止用 'stop' 掩盖失败。
    let streamFailed = false;

    yield {
      type: 'status',
      content: 'AI is analyzing your request...',
      sessionId: finalSessionId,
      statusType: STATUS_TYPE.AI_THINKING,
    } as ChatStreamChunk;

    // 工具执行结果缓存：tool:completed 事件可能在 onToolCall('end') 之前或之后到达
    const toolResultCache = new Map<string, Record<string, unknown>>();
    const onToolCompletedFromCache = (evt: { type: string; data: unknown }) => {
      const d = evt.data as {
        toolName: string;
        toolCallId?: string;
        resultData?: unknown;
      };
      if (d.toolCallId && d.resultData) {
        toolResultCache.set(
          d.toolCallId,
          d.resultData as Record<string, unknown>
        );
      }
    };

    // E-1 diff（2026-08-23）：本次请求内文件变更的 unified diff 结果（done 前发射；
    // 定义在 try 外，供 finally 之后的发射块访问）
    const pendingFileDiffs: Array<{
      file: string;
      diff: string;
      additions: number;
      deletions: number;
    }> = [];

    // 内层生成器声明**提升到 try 之外**（2026-09-25，spec §6.7）：
    // `finally` 必须能关闭它（否则消费方提前 `.return()` 时内层被遗弃、互斥锁不释放），
    // 而 try 块内的 `const` 在 catch / finally 中**不可见**（块级作用域）。
    let generator:
      | AsyncGenerator<string | ChatStreamChunk, Message, unknown>
      | undefined;

    try {
      const pendingEvents: ChatStreamChunk[] = [];

      eventNotificationService.on('tool:completed', onToolCompletedFromCache);

      // E-3（2026-08-23，方案 D2-B）：流式入口同样先设占位标题（LLM 调用前，不阻塞主路径）
      // 回滚开关：TITLE_STAGE='false' 时跳过占位标题（回退单阶段精化）
      // T3（2026-11-17）：判定与调用**原样搬运**到 `_setPreliminaryTitleIfNeeded`。
      this._setPreliminaryTitleIfNeeded(request, finalSessionId);

      const { model, tier } = await this.deps
        .getLlmChatOps()
        .resolveSmartModel(request.content, request.sessionId, request.model);

      yield {
        type: 'status',
        content: 'AI is preparing context...',
        sessionId: finalSessionId,
        statusType: STATUS_TYPE.AI_THINKING,
      } as ChatStreamChunk;
      // 同步更新模型名（用于成本记录）
      if (model) this.deps.setModelName(model);
      // 将路由层级注入 metadata
      const enrichedMetadata = {
        ...(request.metadata || {}),
        routerTier: tier,
      };
      // 排查日志：确认前端透传的 assistantMessageId 是否到达（undefined 说明
      // 前端未传/未走新协议 → 后端回退自动生成 msg-xxx，idSource 为 auto_generated）
      logger.debug('chatStream:assistantMessageId 透传入参', {
        sessionId: finalSessionId,
        assistantMessageId: request.assistantMessageId,
        hasAssistantId: !!request.assistantMessageId,
      });
      generator = this.deps.getChatManager().streamMessage(request.content, {
        sessionId: request.sessionId,
        messageId: request.messageId,
        // P0 根治（2026-08-14）：前端流式消息 id 透传 → createAssistantMessage 复用
        assistantMessageId: request.assistantMessageId,
        metadata: enrichedMetadata,
        model,
        images: request.images,
        onProgress: request.onProgress,
        temperature: request.temperature,
        maxTokens: request.max_tokens,
        top_p: request.top_p,
        systemPrompt: request.systemPrompt,
        // 2026-10-17：通道投递契约等「按请求注入」的系统补充（追加在基础提示之后）
        runtimeSystemNote: request.runtimeSystemNote,
        // P26-1 §9.1（2026-10-07）：优先级透传至 StreamMessageOptions（下游 resourceGovernor 消费）
        priority: request.priority,
        // P0-1（2026-08-26）：流中断续写（从断点继续而非从头重发）
        continueFrom: request.continue_from,
        // PR2（2026-10-09）：外部取消信号透传 → ChatManager 中继到会话 controller
        signal: request.signal,
        // B-05（2026-10-09）：执行标识透传 → ChatManager 按会话记录 → 工具执行器前置记账
        executionId: request.executionId,
        onUsage: (usage) => {
          // AB-10 修复：累加而非覆盖——主回复 + 各工具轮次 LLM 调用都会回调，
          // 累加后 usage SSE 事件反映整轮消息的完整用量
          // T3（2026-11-17）：累加口径**原样搬运**到 `accumulateStreamUsage`（纯函数）。
          capturedUsage = accumulateStreamUsage(capturedUsage, usage);

          // [v1.2] 成本统计已由 UsageTracker.trackUsage 统一处理（唯一入口 + 算法统一）
          // 不再在此回调中重复调用 costTracker.addCost / getCostMetricsBridge / recordCost
          // costTracker.addCost → UsageTracker.syncToTrackers（第 1 步已迁移为唯一入口）
          // getCostMetricsBridge.record → COST_RECORDED 事件订阅者（cost/index.ts）
          // recordCost（预算告警）→ COST_RECORDED 事件订阅者（cost/index.ts）
        },
        onToolCall: (phase, toolName, toolCallId, detail) => {
          if (phase === 'start') {
            emitToolCallStart(toolName, toolCallId, detail, {
              sessionId: finalSessionId,
              pendingEvents,
              fileOldContentCache: this._fileOldContentCache,
            });
            return;
          }
          emitToolCallEnd(toolName, toolCallId, detail, {
            sessionId: finalSessionId,
            pendingEvents,
            pendingFileDiffs,
            toolResultCache,
            fileOldContentCache: this._fileOldContentCache,
            sessionTitling: this.deps.getSessionTitling(),
            chatManager: this.deps.getChatManager(),
            computeUnifiedDiff,
          });
        },
      });

      yield {
        type: 'status',
        content: 'AI is waiting for response...',
        sessionId: finalSessionId,
        statusType: STATUS_TYPE.AI_THINKING,
      } as ChatStreamChunk;

      // 排查日志：chunk 从生成到发送的完整链路（2026-08-14）
      // 计数：streamMessage 产出的 chunk 数 / pendingEvents flush 数（onToolCall 事件经此转发）
      let yieldedChunkCount = 0;
      let flushedEventCount = 0;
      let result = await generator.next();
      while (!result.done) {
        const chunk = result.value;

        // 发送前先 flush onToolCall 累积的 pendingEvents（tool_call/status 事件）
        const pendingCount = pendingEvents.length;
        if (pendingCount > 0) {
          const firstType = (pendingEvents[0] as { type?: string })?.type;
          while (pendingEvents.length > 0) {
            flushedEventCount++;
            yield pendingEvents.shift()!;
          }
          logger.debug('chatStream:flush_pending_events', {
            sessionId: finalSessionId,
            count: pendingCount,
            firstEventType: firstType ?? 'unknown',
          });
        }

        if (typeof chunk === 'string') {
          fullContent += chunk;
          yieldedChunkCount++;
          // 文本 chunk 高频（每 token 一条），debug 级别避免刷屏
          logger.debug('chatStream:yield_text_chunk', {
            sessionId: finalSessionId,
            chunkLength: chunk.length,
            fullContentLength: fullContent.length,
          });
          yield {
            type: 'text',
            content: chunk,
            sessionId: finalSessionId,
          } as ChatStreamChunk;
        } else if (chunk) {
          yieldedChunkCount++;
          // 状态机方案 阶段 2.2（2026-10-12）：此处原以**结构断言**读取工具调用状态字段
          // ⇒ 类型上把工具调用状态**降级为裸 string**（G14 残留）。`chunk` 在本分支已收窄为
          // `ChatStreamChunk`，其 `toolCall?: ToolCallSpec`（`status` 已引用 `ToolCallStatus`）故断言可整体删除。
          const toolName = chunk.toolCall?.name;
          logger.debug('chatStream:yield_chunk', {
            sessionId: finalSessionId,
            type: chunk.type,
            toolName: toolName ?? '',
            toolCallId: chunk.toolCall?.id ?? '',
            status: chunk.toolCall?.status ?? '',
            contentLength:
              typeof chunk.content === 'string' ? chunk.content.length : 0,
            hasResult: chunk.toolCall?.result !== undefined,
          });
          yield chunk as ChatStreamChunk;
        }

        result = await generator.next();
      }

      while (pendingEvents.length > 0) {
        flushedEventCount++;
        yield pendingEvents.shift()!;
      }

      logger.info('chatStream:complete', {
        sessionId: finalSessionId,
        yieldedChunkCount,
        flushedEventCount,
        fullContentLength: fullContent.length,
        durationMs: Date.now() - chatStreamStartTime,
      });

      finalMessage = result.value;
      // T3（2026-11-17）：流末消息收敛**原样搬运**到 `_settleFinalTurn`（含正文拼接与回落）。
      const settledTurn = this._settleFinalTurn(finalMessage, {
        sessionId: finalSessionId,
        messageId: finalMessageId,
        content: fullContent,
      });
      finalSessionId = settledTurn.sessionId;
      finalMessageId = settledTurn.messageId;
      fullContent = settledTurn.content;
    } catch (error) {
      // P1 修复（AB-3）：标记失败，结束块 finishReason 用 'error'
      streamFailed = true;
      // D-l：真实业务码须随 error 块透出（否则传输层回落 UNKNOWN，前端无法按码分流）
      const streamErrorCode = resolveStreamErrorCode(error);
      // 普通对象（如 AI Provider 返回的 { message: "...", type: "..." }）可能不是 Error 实例
      // T3（2026-11-17）：文案解析**原样搬运**到 `describeStreamError`（纯函数）。
      const message = describeStreamError(error);
      otel.recordError(
        span,
        error instanceof Error ? error : new Error(message)
      );
      otel.endSpan(span, SpanStatusCode.ERROR, message);
      await handleError(error, {
        module: 'core:api',
        action: 'chatStream',
        context: { sessionId: finalSessionId },
      });

      // G-2 补漏（2026-10-11）：`ChatStreamChunk.errorCode` 已改为**已知码 + 开放取值**
      //（业务码源自开放的 `AppError.code`）⇒ 此处**不再需要 `as ChatStreamChunk` 强转**。
      yield {
        type: 'error',
        content: message,
        sessionId: finalSessionId,
        errorCode: streamErrorCode,
      };

      // 主 chat 空回复/中断 fallback（2026-09-19）：失败且未产出任何内容时，
      // 按 Write-Ahead 持久化一条 assistant fallback 消息——此前该分支既不落盘
      // 助手消息也不产出内容（日志证据：messageId:"" contentLength:0 finishReason:"error"），
      // 会话刷新后消息整体缺失、前端空白。有部分产出时不覆盖（前端已渲染 partial
      // content，续写/重发可继续）。addMessage 为 fire-and-forget，自动进入
      // _pendingPersistPromises，由会话切换前 flushPendingPersists 统一落盘。
      // D-l：撞限**不落盘**（限额属本机环境状态、非对话内容）；其余失败保持既有 Write-Ahead 行为。
      // T3（2026-11-17）：失败兜底落盘**原样搬运**到 `_persistStreamFallbackOnError`
      //（未落盘 ⇒ undefined，保留既有 finalMessageId）。
      finalMessageId =
        (await this._persistStreamFallbackOnError({
          fullContent,
          sessionId: finalSessionId,
          errorCode: streamErrorCode,
          assistantMessageId: request.assistantMessageId,
        })) ?? finalMessageId;
    } finally {
      eventNotificationService.off('tool:completed', onToolCompletedFromCache);
      // 内层生成器必须显式关闭（2026-09-25，spec §6.7「内层生成器未关闭风险」）：
      // 本层用手工 `await generator.next()` 驱动，**不是** `yield*` ⇒ 消费方
      // （chat-handlers）在我们身上调的 `.return()` **不会**自动向下传导到
      // `ChatManager.streamMessage` → `ChatOrchestrator.streamMessage` → `runStreamMessage`
      // ⇒ 后者被遗弃在挂起点，其 `finally`（**唯一** `mutex.release()` 点 +
      // `endInteractionSpan` + 兜底检查点落盘 + `endSpan`）**永不执行**
      //（实测：Bun 下遗弃的 async generator 即使 3× 强制 GC 也不补跑 finally）。
      // 此处补齐这一跳，使 [chat-handlers 的 generator.return()] → 本层 → 内层 形成闭环。
      // 挂 noop catch 防孤儿 rejection（KB-INTERRUPT-ORPHAN 同口径）；正常完成时为 no-op。
      void generator?.return(undefined as never).catch(() => {});
    }

    // 从 finalMessage 提取实际的 finishReason，而非硬编码 'stop'
    // P1 修复（AB-3）：出错时强制 'error'，防止前端把失败流误判为成功
    // 2026-10-17：终止原因（如 `budget_exhausted`）落在 `metadata.finishReason`，须回落读取
    //（详见 `resolveStreamFinishReason` 头注：否则通道侧发卡判据永不成立）
    const actualFinishReason = resolveStreamFinishReason({
      streamFailed,
      topLevelFinishReason: finalMessage?.finishReason,
      metadata: (
        finalMessage as { metadata?: Record<string, unknown> } | undefined
      )?.metadata,
    });

    // E-1 接入（2026-08-23）：工具执行完成 → 发射 deliverable chunk + 写 assistant/deliverable 事件
    // （复用 ExecutionPhaseTracker.buildDeliverableData，纯事件回放由前端聚合器/后端派生器重建）
    // T3（2026-11-17）：整块**原样搬运**到 `_emitDeliverableOnTurnEnd`（`yield*` 委托，顺序不变）。
    yield* this._emitDeliverableOnTurnEnd(finalSessionId, streamFailed);

    // E-1 diff（2026-08-23）：文件变更 unified diff → 发射 diff chunk + 写 assistant/diff 事件
    // T3（2026-11-17）：整块**原样搬运**到 `_emitPendingFileDiffs`（`yield*` 委托）。
    yield* this._emitPendingFileDiffs(
      finalSessionId,
      streamFailed,
      pendingFileDiffs
    );

    try {
      yield {
        type: 'done',
        content: '',
        sessionId: finalSessionId,
        usage: capturedUsage,
        finishReason: actualFinishReason,
        ...terminationReasonField(finalMessage),
      } as ChatStreamChunk;

      if (fullContent && finalSessionId) {
        this.deps
          .getSessionTitling()
          .autoGenerateTitle(finalSessionId, request.content, fullContent);
      }
    } catch (err) {
      // @ignore-catch — 流已关闭，yield 失败说明客户端已断开
      logger.debug(
        'chatStream final yield failed (client likely disconnected)',
        {
          error: String(err),
        }
      );
    }

    otel.endSpan(span, SpanStatusCode.OK);
    const chatStreamDurationMs = Date.now() - chatStreamStartTime;
    logger.info('chatStream:完成', {
      sessionId: finalSessionId,
      messageId: finalMessageId,
      contentLength: fullContent.length,
      finishReason: actualFinishReason,
      durationMs: chatStreamDurationMs,
      usage: capturedUsage
        ? {
            inputTokens: capturedUsage.inputTokens,
            outputTokens: capturedUsage.outputTokens,
            totalTokens: capturedUsage.totalTokens,
            cacheReadTokens: capturedUsage.cacheReadTokens,
            cacheCreationTokens: capturedUsage.cacheCreationTokens,
          }
        : null,
    });
    return {
      content: fullContent,
      sessionId: finalSessionId,
      messageId: finalMessageId,
      finishReason: actualFinishReason,
    };
  }

  /**
   * T3（2026-11-17）：流末消息 → 会话 id / 消息 id / 整轮正文（原样从 `chatStream` 搬出）。
   *
   * 正文取流末消息（多块时拼接 `value`），为空则回落流内累计正文；会话 id 同样回落。
   */
  private _settleFinalTurn(
    finalMessage: Message | undefined,
    prev: { sessionId: string; messageId: string; content: string }
  ): { sessionId: string; messageId: string; content: string } {
    if (!finalMessage) return prev;
    const content =
      typeof finalMessage.content === 'string'
        ? finalMessage.content
        : finalMessage.content
            .map((block) => ('value' in block ? block.value : ''))
            .join('');
    return {
      sessionId: finalMessage.sessionId || prev.sessionId,
      messageId: finalMessage.id,
      content: content || prev.content,
    };
  }

  /**
   * T3（2026-11-17）：轮次结束的 **deliverable** 发射（`yield*` 委托，原样从 `chatStream` 搬出）。
   *
   * 工具执行完成 → 发射 deliverable chunk + 写 `assistant/deliverable` 事件；
   * 无论是否有交付物都 `reset()` tracker（B3：避免跨轮重复上报）。
   */
  private async *_emitDeliverableOnTurnEnd(
    sessionId: string,
    streamFailed: boolean
  ): AsyncGenerator<ChatStreamChunk, void, unknown> {
    try {
      if (sessionId && !streamFailed) {
        const tracker = this.deps
          .getSessionTitling()
          .getExecutionPhaseTracker(sessionId);
        const deliverable = tracker.buildDeliverableData();
        if (deliverable && deliverable.files.length > 0) {
          yield {
            type: 'deliverable',
            content: deliverable.summary,
            sessionId,
            deliverableData: deliverable,
          } as ChatStreamChunk;
          // 写事件（回放重建；失败不阻断流）
          try {
            await this.deps.getChatManager().appendStreamEvent(sessionId, {
              type: 'assistant/deliverable',
              // seq 0 ⇒ 原子分配（收尾写者与后台任务并发，tail+1 会撞号被丢弃）
              seq: 0,
              time: Date.now(),
              sessionId,
              data: deliverable,
            } as LiriEvent);
          } catch (evErr) {
            logger.debug('chatStream:deliverable 事件写入失败（不影响流式）', {
              sessionId,
              error: String(evErr),
            });
          }
        }
        // B3（架构归一 Step3）：轮次结束无论是否有交付物都清空 tracker，
        // 避免无交付物轮次跨轮重复上报上一轮交付物（原在 if(deliverable) 内致漏清）。
        tracker.reset();
      }
    } catch (deliverableErr) {
      // @ignore-catch — deliverable 发射失败不影响流结束
      logger.debug('chatStream:deliverable 发射失败', {
        sessionId,
        error: String(deliverableErr),
      });
    }
  }

  /**
   * T3（2026-11-17）：轮次结束的 **diff** 发射（`yield*` 委托，原样从 `chatStream` 搬出）。
   *
   * 每条文件变更 → 发射 diff chunk + 写 `assistant/diff` 事件；单条失败继续下一条。
   */
  private async *_emitPendingFileDiffs(
    sessionId: string,
    streamFailed: boolean,
    pendingFileDiffs: Array<{
      file: string;
      diff: string;
      additions: number;
      deletions: number;
    }>
  ): AsyncGenerator<ChatStreamChunk, void, unknown> {
    if (!sessionId || streamFailed || pendingFileDiffs.length === 0) return;
    for (const item of pendingFileDiffs) {
      try {
        yield {
          type: 'diff',
          content: item.diff,
          sessionId,
          diffData: {
            file: item.file,
            diff: item.diff,
            stats: {
              additions: item.additions,
              deletions: item.deletions,
            },
          },
        } as ChatStreamChunk;
        // 写事件（回放重建；失败不阻断流）
        try {
          await this.deps.getChatManager().appendStreamEvent(sessionId, {
            type: 'assistant/diff',
            // seq 0 ⇒ 原子分配（同 deliverable：并发写者下 tail+1 会撞号被丢弃）
            seq: 0,
            time: Date.now(),
            sessionId,
            data: {
              file: item.file,
              diff: item.diff,
              stats: {
                additions: item.additions,
                deletions: item.deletions,
              },
            },
          } as LiriEvent);
        } catch (evErr) {
          logger.debug('chatStream:diff 事件写入失败（不影响流式）', {
            sessionId,
            error: String(evErr),
          });
        }
      } catch (diffErr) {
        // @ignore-catch — 单条 diff 发射失败继续下一条
        logger.debug('chatStream:diff 发射失败', {
          sessionId,
          error: String(diffErr),
        });
      }
    }
  }

  /**
   * T3（2026-11-17）：流式入口的**占位标题**（LLM 调用前，不阻塞主路径）。
   *
   * 原样从 `chatStream` 搬出（零行为变更）；回滚开关 `TITLE_STAGE='false'` 时跳过。
   */
  private _setPreliminaryTitleIfNeeded(
    request: ChatRequest,
    sessionId: string
  ): void {
    if (
      configManager.env('TITLE_STAGE') !== 'false' &&
      sessionId &&
      request.content &&
      this.deps.getSessionTitling().shouldAutoTitle(sessionId)
    ) {
      void this.deps
        .getSessionTitling()
        .setPreliminaryTitle(
          sessionId,
          this.deps
            .getSessionTitling()
            .sanitizePlaceholderTitle(request.content)
        )
        .catch(() => {});
    }
  }

  /**
   * T3（2026-11-17）：流式失败时的 fallback 落盘（Write-Ahead），原样从 `chatStream` 的 catch 搬出。
   *
   * 返回落盘消息 id；未落盘（有部分产出 / 撞限等）⇒ `undefined`。
   */
  private async _persistStreamFallbackOnError(input: {
    fullContent: string;
    sessionId: string;
    errorCode?: string;
    assistantMessageId?: string;
  }): Promise<string | undefined> {
    const { fullContent, sessionId, errorCode, assistantMessageId } = input;
    const persistFallback = shouldPersistStreamFallback({
      fullContent,
      sessionId,
      errorCode,
    });
    if (!persistFallback) {
      if (!fullContent && sessionId) {
        // D-l：撞限场景**抑制**落盘 —— 只留日志/审计，不写进对话上下文
        logger.warn('chatStream:fallback 落盘已抑制（日预算撞限，D-l）', {
          sessionId,
          errorCode,
        });
      }
      return undefined;
    }
    try {
      const fallbackMsg = this.deps
        .getChatManager()
        .getMessageService()
        .createAssistantMessage(
          '⚠️ 本次未能生成回复（任务被中断或模型无响应），请重发消息重试。',
          {
            sessionId,
            // 复用前端透传的 assistantMessageId，避免生成重复消息
            ...(assistantMessageId ? { id: assistantMessageId } : {}),
          }
        );
      this.deps.getChatManager().addMessage(sessionId, fallbackMsg);
      logger.info('chatStream:fallback 消息已持久化', {
        sessionId,
        messageId: fallbackMsg.id,
      });
      return fallbackMsg.id;
    } catch (persistErr) {
      // @ignore-catch — fallback 持久化失败不阻断流（error chunk 已下发）
      logger.warning('chatStream:fallback 消息持久化失败', {
        sessionId,
        error: String(persistErr),
      });
      return undefined;
    }
  }
}
