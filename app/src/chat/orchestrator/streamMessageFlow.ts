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

import { Logger, LogLevel } from '@modules/monitoring';
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
import { resolveMaxContextTokens } from '../services/ChatHelper';
import { isCheckpointLogEnabled } from '../../config/settings/CheckpointLogConfig';
import { getOTelTracing } from '@modules/monitoring';
import { trajectoryRecorder } from '../../agent/trajectory/TrajectoryRecorder';
import { trajectoryRuntime } from '../../core/trajectory/TrajectoryRuntime.js';
import { agentTelemetry } from '../../agent/AgentTelemetry.js';
import type { ChatOrchestratorHost } from './ChatOrchestrator.js';
import type { Message, StreamMessageOptions } from '../types/message.js';
import type { ChatResponse } from '../types/message.js';
import type { ChatSession } from '../types/session.js';
import type { ToolResult } from '../types/tool.js';
import type { ToolDefinition, ParsedToolCall } from '@modules/ai';
import type { ChatMessage, ThinkingProviderChunk } from '@modules/ai';
import type { ChatStreamChunk } from '@modules/runtime/api/CoreAPI.js';

const logger = new Logger({ module: 'chat:streamFlow', level: LogLevel.INFO });

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
    streamSpan.addEvent('streamMessage.pipeline.contextCompacted', {
      'message.count': apiMessages.length,
    });

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
    let ctxDegradation: DegradationState =
      createDegradationState(initialCtxLimit);

    let streamHadError = false;
    while (true) {
      streamHadError = false;
      host.unifiedTracker.resetStreamTokens();
      streamSpan.addEvent('streamMessage.llm.call', {
        'retry.count': retryState.retryCount,
        maxTokens: retryState.nextMaxTokens,
        'message.count': apiMessages.length,
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

      let result = await gen.next();

      // Phase 1c: 流式水位监测
      host.unifiedTracker.startStreamingCheck((state) => {
        logger.warn('流式输出中上下文水位告警', {
          sessionId: session.id,
          currentTokens: state.currentTokens,
          contextLimit: state.contextLimit,
          ratio: Number(state.ratio.toFixed(3)),
          severity: state.severity,
        });
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

      // 获取会话互斥锁（保护工具执行循环）
      await mutex.acquire();
      try {
        while (!result.done) {
          const chunk = result.value as string | ThinkingProviderChunk;
          if (typeof chunk === 'string') {
            accumulatedContent += chunk;
            host.unifiedTracker.onStreamChunk(chunk);
          } else if (chunk?.type === 'thinking') {
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
            session.id
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
        // 推理结束诊断：打印最终 raw response，确认是否存在 tool_calls
        // （排查"模型只输出 thinking 不调用工具"：contentLength=0 + toolCallCount=0 即为 think-only）
        const rawResp = finalResponse as unknown as Record<string, unknown>;
        const toolCallsArr = Array.isArray(rawResp.tool_calls)
          ? (rawResp.tool_calls as Array<{ name?: string; id?: string }>)
          : [];
        logger.info('streamMessage:推理结束 raw response', {
          sessionId: session.id,
          hasToolCalls: toolCallsArr.length > 0,
          toolCallCount: toolCallsArr.length,
          toolCallNames: toolCallsArr.map((tc) => tc.name),
          toolCallsRaw: rawResp.tool_calls ?? null,
          finishReason:
            rawResp.finishReason ??
            rawResp.finish_reason ??
            rawResp.stop_reason ??
            null,
          contentLength:
            typeof rawResp.content === 'string'
              ? rawResp.content.length
              : Array.isArray(rawResp.content)
                ? rawResp.content.length
                : 0,
          contentPreview:
            typeof rawResp.content === 'string'
              ? rawResp.content.slice(0, 300)
              : null,
          stopReason: rawResp.stop_reason ?? null,
        });
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

    // 管线 — 内容修复 + 输出
    const finalContent = pipeline.repairContent();
    options?.onStream?.(finalContent);
    yield finalContent;

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
    assistantMessage = pipeline.createAssistantMessage(finalContent);

    // 管线 — 记忆提取 + 路径校验 + post hooks
    await pipeline.postProcess(ctx.content);

    // P2（08-09）：普通对话轻量检查点
    if (!finalResponse?.tool_calls?.length) {
      const msgCount = session.messages.length;
      if (isCheckpointLogEnabled()) {
        logger.info('PlainTextCheckpoint: 主触发点 — 无工具调用的纯文本对话', {
          sessionId: session.id,
          messageCount: msgCount,
          finishReason: finalResponse?.finishReason ?? 'unknown',
          contentLength: accumulatedContent.length,
        });
      }
      plainTextCheckpoint
        .save(session.messages, session.metadata, session.state)
        .then((cp) => {
          if (isCheckpointLogEnabled()) {
            if (cp) {
              logger.info('PlainTextCheckpoint: 主触发点 — 检查点已保存', {
                sessionId: session.id,
                checkpointId: cp.id,
                messageCount: msgCount,
              });
            } else {
              logger.debug('PlainTextCheckpoint: 主触发点 — 消息数未变，跳过', {
                sessionId: session.id,
                messageCount: msgCount,
              });
            }
          }
        })
        .catch((err) => {
          logger.warn('PlainTextCheckpoint: 主触发点 — 保存失败（非关键）', {
            sessionId: session.id,
            error: String(err),
          });
        });
    } else if (isCheckpointLogEnabled()) {
      logger.debug('PlainTextCheckpoint: 主触发点 — 跳过（有工具调用）', {
        sessionId: session.id,
        toolCallCount: finalResponse.tool_calls.length,
        toolNames: finalResponse.tool_calls.map(
          (tc: ParsedToolCall) => tc.name
        ),
      });
    }

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

        const { ToolLoopRunner } = await import('../ToolLoopRunner.js');
        const toolLoopCtx = {
          session,
          options: options as Record<string, unknown>,
          abortSignal: streamAbortController.signal,
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
        } as unknown as import('../ToolLoopRunner.js').ToolLoopContext;

        const runner = new ToolLoopRunner(toolLoopCtx, {
          apiMessages,
          currentToolCalls,
          assistantMessage,
        });

        for await (const chunk of runner.run()) {
          yield chunk;
        }
        assistantMessage = runner.getFinalAssistantMessage();
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
    // P2（08-09）：兜底检查点
    const msgCount = session.messages.length;
    if (isCheckpointLogEnabled()) {
      logger.debug('PlainTextCheckpoint: 兜底触发点 — finally 块', {
        sessionId: session.id,
        messageCount: msgCount,
      });
    }
    plainTextCheckpoint
      .save(session.messages, session.metadata, session.state)
      .then((cp) => {
        if (isCheckpointLogEnabled()) {
          if (cp) {
            logger.info('PlainTextCheckpoint: 兜底触发点 — 检查点已保存', {
              sessionId: session.id,
              checkpointId: cp.id,
              messageCount: msgCount,
            });
          } else {
            logger.debug(
              'PlainTextCheckpoint: 兜底触发点 — 消息数未变，跳过（主触发点已保存）',
              { sessionId: session.id, messageCount: msgCount }
            );
          }
        }
      })
      .catch((err) => {
        logger.warn('PlainTextCheckpoint: 兜底触发点 — 保存失败（非关键）', {
          sessionId: session.id,
          error: String(err),
        });
      });

    try {
      getOTelTracing().endSpan(streamSpan);
    } catch {
      /* span 可能已结束 */
    }
  }
}

/**
 * 将工具执行异常转换为用户友好提示（原 ChatManager 模块级函数迁移）。
 * 过滤 OpenAI SDK / fetch 级别的技术错误（如 socket 关闭），
 * 避免向用户暴露底层实现细节。
 */
function getToolExecErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) {
    return `工具执行异常: ${String(err).slice(0, 200)}`;
  }
  const msg = err.message;
  const lower = msg.toLowerCase();

  // ── 服务商过载/不可用 ──
  if (
    lower.includes('503') ||
    lower.includes('overloaded') ||
    lower.includes('too busy') ||
    lower.includes('server error') ||
    lower.includes('service unavailable') ||
    lower.includes('capacity')
  ) {
    let detail = '';
    try {
      const jsonMatch = msg.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const body = JSON.parse(jsonMatch[0]);
        if (body.code) detail = ` (${body.code})`;
        if (body.message) detail = ` (${body.code || ''}: ${body.message})`;
      }
    } catch {
      /* ignore */
    }
    return `AI 服务繁忙，请稍后重试${detail}`;
  }

  // ── 频率限制 ──
  if (
    lower.includes('429') ||
    lower.includes('rate limit') ||
    lower.includes('too many requests')
  ) {
    return '请求过于频繁，请稍后重试';
  }

  // ── 认证/权限 ──
  if (
    lower.includes('401') ||
    lower.includes('403') ||
    lower.includes('unauthorized') ||
    lower.includes('invalid api key')
  ) {
    return 'AI 服务认证失败，请检查模型配置中的 API Key';
  }

  // ── 上下文溢出 ──
  if (
    lower.includes('context length') ||
    lower.includes('too long') ||
    lower.includes('maximum context') ||
    lower.includes('token limit')
  ) {
    return '输入内容过长，请缩短输入或开启会话压缩';
  }

  // ── 超时 ──
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return 'AI 服务响应超时，请稍后重试';
  }

  // ── mutex 死锁 ──
  if (lower.includes('simplemutex') || lower.includes('acquire timeout')) {
    return '会话正在处理中，请等待上一条消息完成后重试';
  }

  // socket 连接意外关闭 → AI 服务响应中断
  if (msg.includes('socket connection was closed')) {
    return 'AI 服务响应中断，请重试';
  }
  // fetch 超时 / 网络错误
  if (
    msg.includes('fetch failed') ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('ENOTFOUND')
  ) {
    return '连接 AI 服务失败，请检查网络后重试';
  }

  // 超过 200 字符的未知错误也截断
  return `工具执行异常: ${msg.slice(0, 200)}`;
}
