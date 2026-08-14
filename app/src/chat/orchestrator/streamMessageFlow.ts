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
 * streamMessageFlow — 流式消息编排阶段管线（ChatManager 拆分第 4 步）
 *
 * 从 ChatManager.streamMessage（~620 行）+ _prepareStreamSession（~145 行）
 * + _finalizeStreamMessage（~226 行）提取。
 * 编排顺序由 runStreamMessage 控制，各阶段为纯函数。
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { SimpleMutex } from '@modules/core/SimpleMutex';
import { PlainTextCheckpoint } from '../services/PlainTextCheckpoint.js';
import { StreamingAutoCheckpoint } from '../services/StreamingAutoCheckpoint.js';
import {
  createMaxOutputRetryState,
  advanceMaxOutputRetry,
  type MaxOutputRetryState,
} from '../../ai/MaxOutputRetryHandler';
import {
  createDegradationState,
  tryDegradeContext,
  getDegradationWarning,
  type DegradationState,
} from '../../ai/ContextDegradation';
import { resolveMaxContextTokens, toUsageInfo } from '../services/ChatHelper';
import { estimateMessagesTokens } from '../../ai/tokenizer/TokenEstimator';
import {
  logTokenSnapshot,
  applyPreSendProtection,
  applyErrorCalibration,
  logInferenceUsage,
  createStreamLoopStats,
  beginStreamLoop,
  countStreamChunk,
  logStreamLoopDone,
  logFinalRawResponse,
} from './preSendContextProtection.js';
import { savePlainTextCheckpoint } from './plainTextCheckpointSave.js';
import { compactionOrchestrator } from '../../context/compaction/CompactionOrchestrator';
import { getOTelTracing } from '@modules/monitoring';
import { trajectoryRecorder } from '../../agent/trajectory/TrajectoryRecorder';
import { trajectoryRuntime } from '../../core/trajectory/TrajectoryRuntime.js';
import { agentTelemetry } from '../../agent/AgentTelemetry.js';
import type { ChatOrchestratorHost } from './ChatOrchestrator.js';
import { getToolExecErrorMessage } from './toolErrorMessages.js';
import type { Message, StreamMessageOptions } from '../types/message.js';
import type { ChatResponse } from '../types/message.js';
import type { ChatSession } from '../types/session.js';
import type { ToolResult } from '../types/tool.js';
import type { ToolDefinition, ParsedToolCall } from '@modules/ai';
import type { ChatMessage, ThinkingProviderChunk } from '@modules/ai';
import type { ChatStreamChunk } from '@modules/runtime/api/CoreAPI.js';

const logger = getLogger('chat:streamFlow');

/**
 * 流式编排入口 — 由 ChatOrchestrator.streamMessage 委托
 */
export async function* runStreamMessage(
  host: ChatOrchestratorHost,
  content: string,
  options?: StreamMessageOptions
): AsyncGenerator<string | ChatStreamChunk, Message, unknown> {
  const {
    _prepareStreamSession,
    _buildApiMessagesForStream,
    _createStreamPipeline,
    _finalizeStreamMessage,
  } = host;

  // P2-3.5: 流式消息预处理
  const ctx = await _prepareStreamSession(content, options);
  const session = ctx.session;
  // 1.6：流式开始时间（落盘 startedAt，导出显示开始时间+耗时）
  const streamStartedAt = new Date();

  // P2（08-09）：普通对话轻量检查点（try 外声明，finally 可访问）
  const plainTextCheckpoint = new PlainTextCheckpoint(
    host.checkpointService,
    session.id
  );

  const streamSpan = ctx.streamSpan;
  const streamAbortController = ctx.streamAbortController;
  const streamingCheckpoint = ctx.streamingCheckpoint;
  const mutex = ctx.mutex;
  const userMessage = ctx.userMessage;

  try {
    streamSpan.addEvent('streamMessage.start', {
      'session.id': session.id,
      model: options?.model ?? 'unknown',
      'content.length': ctx.content.length,
    });

    // 构建 API 格式消息列表
    let apiMessages = _buildApiMessagesForStream(session.messages);
    // 诊断日志：压缩前 token 基线
    logTokenSnapshot(
      'API 消息构建后（压缩前）',
      session.id,
      options?.model ?? 'unknown',
      apiMessages
    );

    // 管线 — 图片路径注册 + 文件路径提取
    const pipeline = _createStreamPipeline(session, ctx.content, options);
    pipeline.ctx.apiMessages = apiMessages;
    await pipeline.registerImages();
    streamSpan.addEvent('streamMessage.pipeline.imagesRegistered');
    host.sanitizeApiMessages(apiMessages);

    // 工具定义
    const toolRegistry = host.getToolRegistry();
    const toolDefinitions: ToolDefinition[] = toolRegistry
      ? host.buildToolDefinitions(toolRegistry.getToolSchemas())
      : [];
    if (toolDefinitions.length === 0) {
      // 诊断埋点：工具定义为空时明确记录，区分"注册表缺失" vs "注册表内无工具"，
      // 避免"模型想调工具却无工具可用 → think-only"被静默掩盖
      logger.warn('streamMessage: 工具定义为空，模型无法调用任何工具', {
        sessionId: session.id,
        registryPresent: !!toolRegistry,
        schemaCount: toolRegistry?.getToolSchemas().length ?? 0,
      });
    }

    // 触发 ChatPreStream Hook
    await pipeline.preStreamHook();

    const hasSystemMessage = apiMessages.some(
      (m: Record<string, unknown>) => m.role === 'system'
    );
    if (!hasSystemMessage) {
      await pipeline.assembleSystemPrompt(
        host.getOrAssembleSystemPrompt.bind(host)
      );
    }

    let assistantMessage: Message | undefined;
    let accumulatedContent = '';
    let finalResponse: ChatResponse | null = null;

    if (!host.getLLMClient()) {
      throw new Error('LLM client not initialized');
    }
    const activeClient = host.getClientForModel(options?.model);

    // 管线 — 上下文压缩
    await pipeline.compactContext();
    // BUG 修复：compactContext 内部可能替换 this.ctx.apiMessages 引用（压缩后新数组），
    // 局部 apiMessages 变量仍是旧引用，必须重新同步，否则发送的仍是未压缩的完整历史
    // （llama.cpp 等小上下文模型会因 15408 > n_ctx 4096 直接 400）。
    apiMessages = pipeline.ctx.apiMessages;
    // 诊断日志：压缩后 token 变化
    logTokenSnapshot(
      '上下文压缩后',
      session.id,
      options?.model ?? 'unknown',
      apiMessages
    );
    streamSpan.addEvent('streamMessage.pipeline.contextCompacted', {
      'message.count': apiMessages.length,
    });

    // 发送前上下文保护（估算截断 + llama.cpp 精确截断 + 工具预算检查）
    await applyPreSendProtection({
      host,
      apiMessages,
      toolDefinitions,
      activeClient,
      options,
      session,
    });
    // 诊断日志：发送前强制截断后的 token（兜底保护结果）
    logTokenSnapshot(
      '发送前兜底截断后',
      session.id,
      options?.model ?? 'unknown',
      apiMessages
    );

    // Phase 2: Telemetry + Trajectory THINK 开始
    const streamLlmStartTime = Date.now();
    if (host.ENABLE_TELEMETRY) {
      try {
        agentTelemetry.startTurn(
          session.id,
          options?.model ?? '',
          host.toolRoundCount + 1
        );
      } catch (err) {
        logger.debug('Telemetry recording skipped', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (host.ENABLE_TRAJECTORY) {
      try {
        trajectoryRecorder.recordStep(session.id, {
          phase: 'thinking',
          input: ctx.content.slice(0, 500),
          modelName: options?.model,
        });
      } catch (err) {
        logger.debug('Telemetry recording skipped', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 缺陷 C 修复: 推理前容量预检
    if (options?.model) {
      const preCheck = host.unifiedTracker.checkBeforeRequest(
        apiMessages as unknown as readonly {
          role?: string;
          content?: string | unknown;
        }[],
        options.model,
        options?.maxTokens
      );
      if (preCheck.decision !== 'skip') {
        logger.warn('compaction:preemptive_check', {
          sessionId: session.id,
          decision: preCheck.decision,
          beforeTokens: preCheck.beforeTokens,
        });
        if (preCheck.decision === 'trigger') {
          options?.onProgress?.({
            stage: 'generating',
            message: `上下文空间不足（预计 ${preCheck.beforeTokens.toLocaleString()} tokens），建议手动压缩`,
          });
        }
      }
    }

    // P2-12: max_output 加倍重试
    const MAX_OUTPUT_RETRY_CFG = { maxRetries: 3, maxOutputLimit: 64000 };
    const initialMaxTokens = (options?.maxTokens as number | undefined) ?? 4096;
    let retryState: MaxOutputRetryState = createMaxOutputRetryState(
      initialMaxTokens,
      MAX_OUTPUT_RETRY_CFG
    );

    // P1-7: 上下文溢出渐进降级
    const initialCtxLimit = resolveMaxContextTokens(options?.model);
    // 发送前截断上限（与 applyPreSendProtection 内部一致，用于重试轮次日志）
    const sendCtxLimit = initialCtxLimit;
    let ctxDegradation: DegradationState =
      createDegradationState(initialCtxLimit);

    let streamHadError = false;
    // 流式统计（跨重试轮次，循环外声明供结束后日志使用）
    const streamStats = createStreamLoopStats();
    // P2 修复（AB-1）：mutex 仅首轮获取（重试轮重复 acquire 会因 release 未执行而 30s 超时）
    let mutexHeld = false;
    while (true) {
      streamHadError = false;
      host.unifiedTracker.resetStreamTokens();
      streamSpan.addEvent('streamMessage.llm.call', {
        'retry.count': retryState.retryCount,
        maxTokens: retryState.nextMaxTokens,
        'message.count': apiMessages.length,
      });
      // 诊断日志：实际发送前的 token 估算（含降级重试轮次，观察重试是否带上被截断后的消息）
      logger.info('streamMessage:token — 实际发送前', {
        sessionId: session.id,
        model: options?.model ?? 'unknown',
        retryCount: retryState.retryCount,
        messageCount: apiMessages.length,
        estimateTokens: estimateMessagesTokens(apiMessages),
        sendCtxLimit,
      });
      const gen = activeClient.streamMessage(
        apiMessages as unknown as ChatMessage[],
        {
          ...options,
          maxTokens: retryState.nextMaxTokens,
          signal: streamAbortController.signal,
          tools:
            toolDefinitions.length > 0
              ? (toolDefinitions as unknown as ToolDefinition[])
              : undefined,
        }
      );

      beginStreamLoop(streamStats);
      let result = await gen.next();

      // Phase 1c: 流式水位监测
      // P1 修复（2026-08-14 排查）：水位告警刷屏降噪——定时器每 1.5s 触发一次，
      // 原实现无条件 logger.warn（normal 级别也在刷，24h 日志膨胀 12.6MB+）。
      // 复用 severity 分级：normal 降为 debug，仅 warn/compact 记录告警。
      // P2（2026-08-14 排查）：warn 级仍 1.5s 一条会淹没其他日志 → warn 节流 15s，
      // compact（触发压缩的关键告警）保持全量记录。
      let lastWatermarkWarnAt = 0;
      host.unifiedTracker.startStreamingCheck((state) => {
        const logPayload = {
          sessionId: session.id,
          currentTokens: state.currentTokens,
          contextLimit: state.contextLimit,
          ratio: Number(state.ratio.toFixed(3)),
          severity: state.severity,
        };
        if (state.severity === 'normal') {
          logger.debug('流式输出中上下文水位（normal）', logPayload);
        } else if (state.severity === 'warn') {
          const now = Date.now();
          if (now - lastWatermarkWarnAt >= 15_000) {
            lastWatermarkWarnAt = now;
            logger.warn('流式输出中上下文水位告警', logPayload);
          }
        } else {
          logger.warn('流式输出中上下文水位告警', logPayload);
        }
        const pct = Math.round(state.ratio * 100);
        const curK =
          state.currentTokens > 0
            ? `${(state.currentTokens / 1000).toFixed(0)}K`
            : '?';
        const maxK =
          state.contextLimit > 0
            ? `${(state.contextLimit / 1000).toFixed(0)}K`
            : '?';
        options?.onProgress?.({
          stage: 'generating',
          message: `上下文水位: ${pct}% (${curK}/${maxK}) | severity:${state.severity} | ratio:${state.ratio.toFixed(3)} | tokens:${state.currentTokens}/${state.contextLimit}`,
          watermarkState: {
            currentTokens: state.currentTokens,
            contextLimit: state.contextLimit,
            ratio: state.ratio,
            severity: state.severity,
          },
        });
      });

      if (!mutexHeld) {
        logger.info('获取互斥锁(首轮)', { sessionId: session.id });
        await mutex.acquire();
        mutexHeld = true;
      }
      try {
        while (!result.done) {
          const chunk = result.value as string | ThinkingProviderChunk;
          if (typeof chunk === 'string') {
            countStreamChunk(streamStats, false);
            accumulatedContent += chunk;
            host.unifiedTracker.onStreamChunk(chunk);
            yield { type: 'text', content: chunk, sessionId: session.id };
          } else if (chunk?.type === 'thinking') {
            countStreamChunk(streamStats, true);
            if (chunk.content) {
              host.unifiedTracker.onStreamChunk(
                typeof chunk.content === 'string'
                  ? chunk.content
                  : JSON.stringify(chunk.content)
              );
            }
            const thinkingChunk: ChatStreamChunk = {
              type: 'thinking',
              content: chunk.content,
              sessionId: session.id,
            };
            yield thinkingChunk;
          }
          result = await gen.next();
        }
      } catch (genErr) {
        // 错误校准（估算 vs 真实对比 + 400 自动回写 DB）
        await applyErrorCalibration(
          genErr,
          apiMessages,
          session.id,
          options?.model
        );
        // P1-7: 上下文溢出降级
        const degradationResult = tryDegradeContext(ctxDegradation, genErr);
        if (degradationResult.shouldRetry) {
          logger.warn('chat:context_degraded — 降低上下文窗口重试', {
            sessionId: session.id,
            from: initialCtxLimit,
            to: degradationResult.limit,
            degradationCount: ctxDegradation.degradationCount,
          });
          const warning = getDegradationWarning(ctxDegradation);
          if (warning) {
            yield {
              type: 'context_state',
              content: warning,
              sessionId: session.id,
              watermarkState: {
                currentTokens: 0,
                contextLimit: degradationResult.limit,
                ratio: degradationResult.limit / ctxDegradation.originalLimit,
                severity:
                  degradationResult.limit / ctxDegradation.originalLimit <= 0.5
                    ? ('compact' as const)
                    : ('warn' as const),
              },
            } as ChatStreamChunk;
          }
          await host.truncateApiMessages(
            apiMessages,
            degradationResult.limit,
            session.id,
            options?.maxTokens
          );
          continue;
        }

        streamHadError = true;
        await handleError(genErr, {
          module: 'chat:ChatManager',
          action: 'streamMessage_genIteration',
          context: { sessionId: session.id },
        });
        const errorMsg =
          genErr instanceof Error
            ? genErr.message.slice(0, 200)
            : String(genErr).slice(0, 200);
        yield {
          type: 'error',
          content: `流式响应中断: ${errorMsg}`,
          sessionId: session.id,
        } as ChatStreamChunk;
      }

      if (!streamHadError) {
        finalResponse = result.value as unknown as ChatResponse;
        logFinalRawResponse(session.id, finalResponse);
      } else {
        finalResponse = { finishReason: 'error' } as unknown as ChatResponse;
        break;
      }

      // P2-12: 检查是否需要加倍重试
      const aiStopReason = (
        finalResponse as unknown as { stop_reason?: string }
      ).stop_reason;
      if (aiStopReason === 'max_tokens') {
        retryState = advanceMaxOutputRetry(
          'max_tokens',
          retryState,
          MAX_OUTPUT_RETRY_CFG
        );
      } else {
        retryState = { ...retryState, shouldRetry: false };
      }

      if (!retryState.shouldRetry) break;

      logger.info('maxOutputRetry: retrying with increased maxTokens', {
        sessionId: session.id,
        retryCount: retryState.retryCount,
        nextMaxTokens: retryState.nextMaxTokens,
        previousContentLength: accumulatedContent.length,
      });
      yield {
        type: 'status',
        statusType: 'retry',
        content: `输出截断，正在以更大 token 限制重试（第 ${retryState.retryCount} 次，maxTokens=${retryState.nextMaxTokens}）...`,
        sessionId: session.id,
      } as ChatStreamChunk;
      accumulatedContent = '';
    }

    streamSpan.addEvent('streamMessage.llm.done', {
      'content.length': accumulatedContent.length,
      finishReason: finalResponse?.finishReason ?? 'unknown',
      'toolCalls.count': finalResponse?.tool_calls?.length ?? 0,
      'usage.inputTokens':
        (finalResponse?.usage as Record<string, number> | undefined)
          ?.inputTokens ?? 0,
      'usage.outputTokens':
        (finalResponse?.usage as Record<string, number> | undefined)
          ?.outputTokens ?? 0,
    });

    logStreamLoopDone(
      streamStats,
      session.id,
      finalResponse?.finishReason ?? 'unknown',
      finalResponse?.tool_calls?.length ?? 0,
      {
        model: options?.model ?? 'unknown',
        retryCount: retryState.retryCount,
        accumulatedContentLength: accumulatedContent.length,
      }
    );

    // 诊断日志：发送前估算 vs 发送后 API 返回真实 usage（闭环对比截断/压缩效果）
    logInferenceUsage(
      session.id,
      options?.model ?? 'unknown',
      finalResponse,
      apiMessages
    );

    // 管线 — 内容修复 + 输出（repairContent 从 ctx.accumulatedContent 读取，须先同步局部累积）
    pipeline.ctx.accumulatedContent = accumulatedContent;
    const finalContent = pipeline.repairContent();
    options?.onStream?.(finalContent);
    // 管线 — 用量记录
    pipeline.recordUsage();

    // Phase 2: Telemetry + Trajectory THINK 完成
    const streamLlmDuration = Date.now() - streamLlmStartTime;
    if (host.ENABLE_TELEMETRY) {
      try {
        agentTelemetry.recordTokens(
          session.id,
          finalResponse?.usage?.inputTokens ?? 0,
          finalResponse?.usage?.outputTokens ?? 0
        );
      } catch (err) {
        logger.debug('Telemetry recording skipped', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (host.ENABLE_TRAJECTORY) {
      try {
        trajectoryRecorder.recordStep(session.id, {
          phase: 'response',
          output:
            typeof accumulatedContent === 'string'
              ? accumulatedContent.slice(0, 500)
              : '',
          tokensUsed:
            (finalResponse?.usage?.inputTokens ?? 0) +
            (finalResponse?.usage?.outputTokens ?? 0),
          durationMs: streamLlmDuration,
        });
      } catch (err) {
        logger.debug('Telemetry recording skipped', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 通知外部：本次 LLM 响应的词元用量
    pipeline.notifyUsage();

    // 创建助手消息
    // P0 根治（2026-08-14）：复用前端透传的 assistantId（如存在），
    // 使前端 updateMessageBlocks(assistantId) 直接命中，不再依赖兜底取最后一条 assistant。
    assistantMessage = pipeline.createAssistantMessage(finalContent, {
      id: options?.assistantMessageId,
    });
    // 排查日志：确认助手消息 ID 来源（前端透传 vs 后端自动生成）与内容规模
    logger.debug('streamMessageFlow:assistantMessage created', {
      sessionId: session.id,
      messageId: assistantMessage.id,
      idSource: options?.assistantMessageId
        ? 'frontend_passthrough'
        : 'auto_generated',
      contentLength: finalContent.length,
    });
    assistantMessage.startedAt = streamStartedAt; // 1.6：回填流式开始时间（createdAt 为完成时间）

    // 管线 — 记忆提取 + 路径校验 + post hooks
    await pipeline.postProcess(ctx.content);

    // P2（08-09）：普通对话轻量检查点
    savePlainTextCheckpoint({
      checkpoint: plainTextCheckpoint,
      session,
      trigger: 'main',
      finishReason: finalResponse?.finishReason ?? 'unknown',
      contentLength: accumulatedContent.length,
      toolCalls: finalResponse?.tool_calls,
    });

    // 处理工具调用 — 流式工具执行循环
    try {
      if (finalResponse?.tool_calls && finalResponse.tool_calls.length > 0) {
        streamSpan.addEvent('streamMessage.toolLoop.start', {
          'toolCalls.count': finalResponse.tool_calls.length,
          toolNames: finalResponse.tool_calls.map(
            (tc: ParsedToolCall) => tc.name
          ),
        });
        let currentMessages: Record<string, unknown>[] = [...apiMessages];
        let currentToolCalls: ParsedToolCall[] = [...finalResponse.tool_calls];
        let currentAssistantMsg = assistantMessage;
        const firstAssistantContent = String(assistantMessage.content ?? '');

        const { toolResultRegistry } =
          await import('../../tool/ToolResultRegistry');
        const rollbackRoundId = toolResultRegistry.nextRound(session.id);
        if (!session.metadata.roundIndex) session.metadata.roundIndex = {};
        session.metadata.roundIndex[userMessage.id] = rollbackRoundId;
        session.metadata.roundCounter = rollbackRoundId;

        await host
          .startRollbackRound(session.id, rollbackRoundId)
          .catch((err) => {
            logger.warn('回滚轮次启动失败', { error: String(err) });
            handleError(err, {
              module: 'chat:ChatManager',
              action: 'rollback:startRound',
            }).catch(() => {});
          });

        const toolLoopCtx = {
          session,
          options: options as Record<string, unknown>,
          abortSignal: streamAbortController.signal,
          // P0-4（2026-08-14）：透传工具执行事件回调 → ReActToolLoop.act 触发 → CoreAPIImpl
          // onToolCall 收集（带参数 tool_call chunk + 完成状态提示，与 TAOR 路径行为一致）
          onToolCall: options?.onToolCall,
          executeTool: (tc: ParsedToolCall, opts: unknown) =>
            host.executeTool(
              {
                id: tc.id,
                name: tc.name,
                arguments: tc.arguments,
                sessionId: session.id,
              },
              opts as { useErrorHandler?: boolean }
            ),
          pendingInteractions: host.pendingInteractions,
          messageService: host.messageService,
          addAndPersistMessage: (sid: string, msg: Message) =>
            host.addAndPersistMessage(sid, msg),
          checkpointService: host.checkpointService,
          streamingCheckpoint,
          activeClient,
          unifiedTracker: host.unifiedTracker,
          recordChatResponseUsage: (
            sid: string,
            usage: Record<string, number>
          ) => host.recordChatResponseUsage(sid, usage),
          onToolUsage: (usage: Record<string, unknown>) => {
            const u = toUsageInfo(usage);
            if (u && options?.onUsage) options.onUsage(u);
          },
          toolResultRegistry,
          toolRegistry: host.getToolRegistry(),
          toolDefinitions,
          loopDetector: host.loopDetector,
          buildToolRoundMessages: (
            msgs: Record<string, unknown>[],
            am: Message,
            tcs: ParsedToolCall[],
            prs: Array<{
              normalizedToolCall: ParsedToolCall;
              result: ToolResult;
            }>
          ) => host.buildToolRoundMessages(msgs, am, tcs, prs),
          maxToolTurns: host.MAX_TOOL_TURNS,
          estimateMessagesTokens: estimateMessagesTokens as (
            messages: unknown[]
          ) => number,
        } as unknown as import('../ToolLoopRunner.js').ToolLoopContext;

        const { ReActToolLoop } = await import('../ReActToolLoop.js');
        const { reactEventsToChunks } =
          await import('../reactEventsToChunks.js');
        const loop = new ReActToolLoop(
          toolLoopCtx,
          {
            apiMessages,
            currentToolCalls,
            assistantMessage,
          },
          { maxIterations: host.MAX_TOOL_TURNS }
        );

        // M1c：骨架事件流 → ChatStreamChunk（转换层）+ 心跳聚合 + todo chunk
        let heartbeatAt = 0;
        for await (const event of loop.run({
          apiMessages,
          currentToolCalls,
          assistantMessage,
        })) {
          for (const chunk of reactEventsToChunks(event, session.id)) {
            yield chunk;
          }
          // todo chunk：工具结果含 _todoData 时产出（对齐旧类 _executeToolRound）
          for (const todoData of loop.getPendingTodos()) {
            yield {
              type: 'todo',
              content: JSON.stringify(todoData),
              sessionId: session.id,
              todoData,
            } as ChatStreamChunk;
          }
          // 心跳：tool_end 后每 5s 产出 execution_phase（对齐旧类 _heartbeat）
          if (event.type === 'tool_end') {
            const now = Date.now();
            if (now - heartbeatAt >= 5000) {
              heartbeatAt = now;
              const hb = loop.getHeartbeatData();
              // 5. steps 截断：仅保留最近 MAX_HEARTBEAT_STEPS 条，避免长任务心跳体积线性增长
              //   （对齐旧类 ToolLoopRunner._buildExecutionSteps；totalSteps 保留真实计数）
              const MAX_HEARTBEAT_STEPS = 30;
              const fullSteps = hb.completedToolNames.map((name) => ({
                name,
                status: 'done' as const,
              }));
              const truncated = fullSteps.length > MAX_HEARTBEAT_STEPS;
              const steps = truncated
                ? fullSteps.slice(-MAX_HEARTBEAT_STEPS)
                : fullSteps;
              yield {
                type: 'execution_phase',
                content: '正在执行工具',
                sessionId: session.id,
                executionPhase: {
                  phase: 'implementing' as const,
                  progress: hb.totalCompletedToolCount,
                  description: '正在执行工具调用',
                  steps,
                  totalSteps: fullSteps.length,
                  truncated,
                  currentStep: '',
                },
              } as ChatStreamChunk;
            }
          }
        }
        assistantMessage = loop.getAssistantMessage();
        await host
          .endRollbackRound(session.id, ctx.content, firstAssistantContent)
          .catch((err) => {
            logger.warn('回滚轮次结束失败', { error: String(err) });
            handleError(err, {
              module: 'chat:ChatManager',
              action: 'rollback:endRound',
            }).catch(() => {});
          });
        void currentMessages;
        void currentAssistantMsg;
      }
    } catch (toolExecErr) {
      await handleError(toolExecErr, {
        module: 'chat:ChatManager',
        action: 'streamMessage_toolExecution',
        context: { sessionId: session.id },
      });
      const errMsg = getToolExecErrorMessage(toolExecErr);
      accumulatedContent += `\n\n[${errMsg}]`;
    } finally {
      mutex.release();
    }

    streamSpan.addEvent('streamMessage.toolLoop.done', {
      'toolTurns.completed': host.toolRoundCount,
    });

    // 项1（会话排查 2026-08-13）：发送完成后的后台预压缩——压缩结果写回会话，
    // 下一轮窗口更小（可能 skip/warn 而非触发慢 Tier3），把 Tier3 的等待从
    // "用户发送前"转移到"发送后后台"。fire-and-forget 不阻塞本轮；
    // 长度守卫（compactSessionInBackground 内部）防覆盖压缩期间新增消息。
    void compactionOrchestrator
      .compactSessionInBackground(
        () => session.messages as unknown as ChatMessage[],
        (messages) => {
          session.messages = messages as unknown as typeof session.messages;
        },
        { model: options?.model || '', sessionId: session.id }
      )
      .catch((err) =>
        logger.warn('compaction:bg_failed', {
          sessionId: session.id,
          error: err instanceof Error ? err.message : String(err),
        })
      );

    // P2-3.5: 资源清理 + 持久化 + 构建返回消息
    return await _finalizeStreamMessage(
      session,
      ctx.content,
      accumulatedContent,
      assistantMessage,
      finalResponse,
      streamAbortController,
      streamSpan,
      options
    );
  } finally {
    // P2 修复（AB-2）：兜底释放会话互斥锁（内层被 return 遗弃时工具循环 finally 不执行，
    // 锁永久泄漏致下一条消息 30s 超时）。release 幂等，正常路径双 release 无害。
    mutex.release();
    // P2（08-09）：兜底检查点
    savePlainTextCheckpoint({
      checkpoint: plainTextCheckpoint,
      session,
      trigger: 'fallback',
    });

    try {
      getOTelTracing().endSpan(streamSpan);
    } catch {
      /* span 可能已结束 */
    }
  }
}
