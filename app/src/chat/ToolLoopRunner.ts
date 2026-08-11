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
 * ToolLoopRunner — 工具循环执行器
 *
 * P1-2（08-09）：从 ChatManager.streamMessage 提取工具循环核心逻辑，
 * 降低 ChatManager 上帝类复杂度。手写循环（三轨之一）作为 TAORLoop 全量启用后的降级路径。
 *
 * 职责边界：
 * - 拥有：while(currentToolCalls.length > 0) 循环体全部逻辑
 * - 不拥有：回滚轮次启动/结束（ChatManager 负责）、_finalizeStreamMessage（ChatManager 负责）
 */

import type { ChatStreamChunk } from '@modules/runtime/api/CoreAPI.js';
import type {
  ParsedToolCall,
  ToolDefinition,
  ChatResponse,
  ChatMessage,
  ThinkingProviderChunk,
} from '@modules/ai';
import type { ToolCall, ToolResult } from './types/tool.js';
import type { Message } from './types/message.js';
import type { ChatSession } from './types/session.js';
import { getToolCallName } from './types/tool.js';
import { extractTodoData } from './services/ChatHelper';
import {
  ensureThinkResponseTags,
  stripThinkResponseTags,
  stripOrphanToolTags,
} from './services/MessageContextPipeline';
import { StreamingToolCallScrubber } from '../streaming/scrubbers/StreamingToolCallScrubber';
import { repairImageUrls } from './services/ChatHelper';
import { handleError } from '@modules/error';
import { getLogger } from '@modules/monitoring';
import { getOTelTracing } from '@modules/monitoring/otel';
import { trackUsage } from '@modules/ai';

const logger = getLogger('chat:toolLoopRunner');

/* ===================================================================
 *  ToolLoopContext — 工具循环所需的全部外部依赖
 * =================================================================== */

export interface ToolLoopContext {
  session: ChatSession;
  options: Record<string, unknown>;
  abortSignal: AbortSignal;

  // 工具执行
  executeTool: (
    toolCall: ToolCall,
    opts?: { useErrorHandler?: boolean }
  ) => Promise<ToolResult>;

  // 交互
  pendingInteractions: Map<
    string,
    {
      questionId: string;
      promise: Promise<string[]>;
      resolve: (answers: string[]) => void;
    }
  >;

  // 循环检测
  loopDetector: {
    detect(
      name: string,
      args: Record<string, unknown>
    ): { stuck: boolean; level?: string; detector?: string; message?: string };
    recordToolCallOutcome(
      name: string,
      args: Record<string, unknown>,
      result: unknown,
      error?: string
    ): void;
    recordTurn(hasToolCalls: boolean): void;
  };

  // 消息服务
  messageService: {
    createToolResultMessage(
      result: ToolResult,
      opts: { sessionId: string; metadata?: Record<string, unknown> }
    ): Message;
    createAssistantMessage(
      content: string,
      opts: { sessionId: string }
    ): Message;
  };
  addAndPersistMessage: (sessionId: string, message: Message) => void;

  // 检查点
  checkpointService: {
    saveCheckpointWithData(
      sessionId: string,
      messages: unknown[],
      metadata: unknown,
      state: unknown,
      label: string,
      description: string,
      isAuto: boolean,
      tokenCount: number
    ): Promise<unknown>;
  };
  streamingCheckpoint: {
    onToolCompleted(data: Record<string, unknown>): Promise<unknown>;
  };

  // LLM 客户端
  activeClient: {
    streamMessage(
      messages: ChatMessage[],
      options: Record<string, unknown>
    ): AsyncGenerator<string | ThinkingProviderChunk, ChatResponse>;
    sendMessage(
      messages: ChatMessage[],
      options?: Record<string, unknown>
    ): Promise<ChatResponse>;
    getProviderId(): string;
  };

  // 词元追踪
  unifiedTracker: {
    resetStreamTokens(): void;
    updateBaselineForRound(messages: unknown[], model: string): void;
  };
  recordChatResponseUsage: (sessionId: string, usage: unknown) => void;
  /** AB-10 修复：工具轮次 LLM 用量上报（区别于 recordChatResponseUsage 的内部记账，此回调转发给 streamMessage 的 onUsage → 前端 usage 事件） */
  onToolUsage?: (usage: Record<string, unknown>) => void;

  // 工具结果注册表
  toolResultRegistry: {
    storeResult(
      sessionId: string,
      toolCallId: string,
      toolName: string,
      args: Record<string, unknown>,
      result: { result?: unknown; error?: string },
      round: number
    ): void;
    getCurrentRound(sessionId: string): number;
    nextRound(sessionId: string): number;
  };

  // 工具注册表（用于交互检查）
  toolRegistry: {
    getTool(name: string):
      | {
          requiresUserInteraction?: () => boolean;
          isDestructive?: (input?: Record<string, unknown>) => boolean;
        }
      | undefined;
  };

  // 工具定义
  toolDefinitions: ToolDefinition[];

  // 消息构建
  buildToolRoundMessages: (
    currentMessages: Record<string, unknown>[],
    currentAssistantMsg: Message,
    currentToolCalls: ParsedToolCall[],
    processedResults: Array<{
      normalizedToolCall: ToolCall;
      result: ToolResult;
    }>
  ) => Record<string, unknown>[];

  // 配置
  maxToolTurns: number;

  // 用量估算
  estimateMessagesTokens: (messages: unknown[]) => number;
}

/* ===================================================================
 *  ToolLoopInput — 初始化参数
 * =================================================================== */

export interface ToolLoopInput {
  apiMessages: Record<string, unknown>[];
  currentToolCalls: ParsedToolCall[];
  assistantMessage: Message;

  /** P2（08-09）：非流式模式（交互恢复等场景），跳过 yield 输出 */
  nonStreaming?: boolean;

  /** P2（08-09）：交互恢复上下文 */
  interactionContext?: {
    /** 用户答案（用于交互工具恢复） */
    userAnswers: string[];
    /** 交互工具在当前工具列表中的索引（0-based） */
    interactionIdx: number;
  };

  /** P2（08-09）：初始工具调用已执行完毕，首次迭代应跳过工具执行直接调 LLM */
  needsInitialLlmCall?: boolean;
}

/* ===================================================================
 *  ToolLoopRunner
 * =================================================================== */

export class ToolLoopRunner {
  private ctx: ToolLoopContext;

  // 循环局部状态
  private currentMessages: Record<string, unknown>[];
  private currentToolCalls: ParsedToolCall[];
  private currentAssistantMsg: Message;
  private assistantMessage: Message;
  private toolTurnCount = 0;
  private llmCallCount = 1;
  private lastHeartbeatTime = Date.now();
  private completedToolNames: string[] = [];
  private completedToolCallIds: string[] = [];

  // P2（08-09）：非流式模式 + 交互恢复
  private nonStreaming: boolean;
  private interactionContext: ToolLoopInput['interactionContext'];
  private needsInitialLlmCall: boolean;

  constructor(ctx: ToolLoopContext, input: ToolLoopInput) {
    this.ctx = ctx;
    this.currentMessages = [...input.apiMessages];
    this.currentToolCalls = [...input.currentToolCalls];
    this.currentAssistantMsg = input.assistantMessage;
    this.assistantMessage = input.assistantMessage;
    this.nonStreaming = input.nonStreaming ?? false;
    this.interactionContext = input.interactionContext;
    this.needsInitialLlmCall = input.needsInitialLlmCall ?? false;
  }

  /* =================================================================
   *  run() — 异步生成器，yield ChatStreamChunk | string
   * ================================================================= */

  async *run(): AsyncGenerator<ChatStreamChunk | string> {
    const otel = getOTelTracing();
    const span = otel.startSpan('chat:toolLoop', {
      'session.id': this.ctx.session.id,
    });
    const { session, options, abortSignal } = this.ctx;

    try {
      span.addEvent('toolLoop.entry', {
        initialToolCalls: this.currentToolCalls.length,
        nonStreaming: this.nonStreaming,
        needsInitialLlmCall: this.needsInitialLlmCall,
      });
      // P2（08-09）：初始 LLM 调用（工具已执行完毕，需 LLM 判断是否有更多工具）
      if (this.needsInitialLlmCall && this.currentToolCalls.length === 0) {
        const initialResponse = await this._nonStreamingLlmRound(
          this.currentMessages
        );
        if (!initialResponse) return;

        if (initialResponse.tool_calls?.length) {
          this.currentToolCalls = [...initialResponse.tool_calls];
          this.currentAssistantMsg =
            this.ctx.messageService.createAssistantMessage(
              typeof initialResponse.content === 'string'
                ? initialResponse.content
                : JSON.stringify(initialResponse.content),
              { sessionId: session.id }
            );
          this.ctx.addAndPersistMessage(session.id, this.currentAssistantMsg);
          this.assistantMessage = this.currentAssistantMsg;
        } else {
          // 无更多工具调用，直接返回
          this.assistantMessage =
            this.ctx.messageService.createAssistantMessage(
              typeof initialResponse.content === 'string'
                ? initialResponse.content
                : JSON.stringify(initialResponse.content),
              { sessionId: session.id }
            );
          this.ctx.addAndPersistMessage(session.id, this.assistantMessage);
          return;
        }
      }

      while (this.currentToolCalls.length > 0) {
        span.addEvent('toolLoop.turn.start', {
          turn: this.toolTurnCount + 1,
          remainingToolCalls: this.currentToolCalls.length,
          toolNames: this.currentToolCalls.map((tc) => tc.name),
          llmCallCount: this.llmCallCount,
        });

        const turnStartTime = Date.now();
        logger.info('toolLoop:轮次开始', {
          sessionId: session.id,
          turn: this.toolTurnCount + 1,
          remainingToolCalls: this.currentToolCalls.length,
          toolNames: this.currentToolCalls.map((tc) => tc.name),
          llmCallCount: this.llmCallCount,
        });

        // P1-1: 客户端断开时立即中止
        if (!this.nonStreaming && abortSignal.aborted) {
          span.addEvent('toolLoop.aborted', { turn: this.toolTurnCount });
          logger.warn('客户端已断开/取消，中止工具循环', {
            sessionId: session.id,
            completedTurnCount: this.toolTurnCount,
          });
          break;
        }

        this.toolTurnCount++;

        // P2-5: 心跳（非流式模式跳过）
        if (!this.nonStreaming) {
          yield* this._heartbeat();
        }

        // MAX_TOOL_TURNS
        if (this.toolTurnCount > this.ctx.maxToolTurns) {
          span.addEvent('toolLoop.maxTurns', {
            turn: this.toolTurnCount,
            maxTurns: this.ctx.maxToolTurns,
          });
          logger.warn('工具循环达到最大轮次限制', {
            sessionId: session.id,
            maxTurns: this.ctx.maxToolTurns,
          });
          if (!this.nonStreaming) {
            yield `\n\n⚠️ 已达到最大工具轮次限制 (${this.ctx.maxToolTurns})，工具链提前终止。`;
          }
          this.currentToolCalls = [];
          break;
        }

        // LoopDetector 预检
        const loopBreak = this._preCheckLoops();
        if (loopBreak) {
          // 汇总循环检测上下文，方便排查根因
          const currentToolNames = this.currentToolCalls.map((tc) =>
            getToolCallName(tc)
          );
          const currentToolArgs = this.currentToolCalls.map((tc) => ({
            name: getToolCallName(tc),
            args: tc.arguments,
          }));
          span.addEvent('toolLoop.loopDetected', {
            turn: this.toolTurnCount,
            detector: loopBreak.detector,
            level: loopBreak.level,
            message: loopBreak.message,
            currentToolNames,
            completedToolNames: this.completedToolNames,
            completedToolCallIds: this.completedToolCallIds,
          });
          logger.error('ToolLoop: 循环检测触发，任务中止', {
            sessionId: this.ctx.session.id,
            turn: this.toolTurnCount,
            detector: loopBreak.detector,
            level: loopBreak.level,
            message: loopBreak.message,
            currentToolNames,
            currentToolArgs,
            completedToolNames: this.completedToolNames,
            completedToolCallIds: this.completedToolCallIds,
            llmCallCount: this.llmCallCount,
          });
          if (!this.nonStreaming) {
            yield loopBreak.breakMessage;
          }
          break;
        }

        // 执行本轮工具
        const processedResults = yield* this._executeToolRound();

        // 构建工具轮次消息
        const updatedMessages = this.ctx.buildToolRoundMessages(
          this.currentMessages,
          this.currentAssistantMsg,
          this.currentToolCalls,
          processedResults
        );

        this.ctx.unifiedTracker.resetStreamTokens();
        if (options?.model) {
          this.ctx.unifiedTracker.updateBaselineForRound(
            updatedMessages as unknown as Record<string, unknown>[],
            options.model as string
          );
        }
        this.llmCallCount++;

        if (this.nonStreaming) {
          // P2（08-09）：非流式 LLM 调用
          const response = await this._nonStreamingLlmRound(updatedMessages);
          if (!response) {
            this.currentToolCalls = [];
            break;
          }

          const responseContent =
            typeof response.content === 'string'
              ? response.content
              : JSON.stringify(response.content);
          this._prepareNextRound(response, updatedMessages, responseContent);
        } else {
          // LLM 流式调用（含残缺工具调用重试）
          const { response: toolResultResponse, cleanContent } =
            yield* this._streamLlmRound(updatedMessages, abortSignal);
          if (!toolResultResponse) {
            this.currentToolCalls = [];
            break;
          }

          this._prepareNextRound(
            toolResultResponse,
            updatedMessages,
            cleanContent
          );
        }

        // LoopDetector 记录轮次
        this.ctx.loopDetector.recordTurn(this.currentToolCalls.length > 0);

        logger.info('toolLoop:轮次完成', {
          sessionId: session.id,
          turn: this.toolTurnCount,
          durationMs: Date.now() - turnStartTime,
          remainingToolCalls: this.currentToolCalls.length,
          llmCallCount: this.llmCallCount,
          completedToolNames: this.completedToolNames,
        });

        // 每 5 轮保存检查点（非流式模式跳过）
        if (!this.nonStreaming) {
          yield* this._savePeriodicCheckpoint();
        }
      }
      span.addEvent('toolLoop.done', {
        totalTurns: this.toolTurnCount,
        totalLlmCalls: this.llmCallCount,
        completedToolNames: this.completedToolNames,
      });
    } finally {
      try {
        otel.endSpan(span);
      } catch {
        /* span 可能已结束 */
      }
    }
  }

  /* =================================================================
   *  私有方法
   * ================================================================= */

  /** 心跳：每 5 秒 yield execution_phase */
  private async *_heartbeat(): AsyncGenerator<ChatStreamChunk> {
    if (Date.now() - this.lastHeartbeatTime < 5000) return;
    this.lastHeartbeatTime = Date.now();

    yield {
      type: 'execution_phase',
      content: `已执行 ${this.completedToolNames.length} 个工具，第 ${this.toolTurnCount} 轮`,
      sessionId: this.ctx.session.id,
      executionPhase: {
        phase: 'implementing' as const,
        progress: this.completedToolNames.length,
        description: `第 ${this.toolTurnCount} 轮工具调用`,
        steps: [
          ...this.completedToolNames.map((name) => ({
            name,
            status: 'done' as const,
          })),
          ...this.currentToolCalls.map((tc) => ({
            name: getToolCallName(tc),
            status: 'in_progress' as const,
          })),
        ],
        currentStep: getToolCallName(this.currentToolCalls[0]) || '',
      },
    } as ChatStreamChunk;
  }

  /** LoopDetector 预检，返回需要 yield 的终止消息 */
  private _preCheckLoops(): {
    detector: string;
    level: string;
    message: string;
    breakMessage: string;
  } | null {
    for (const toolCall of this.currentToolCalls) {
      const toolName = getToolCallName(toolCall);
      const detection = this.ctx.loopDetector.detect(
        toolName,
        toolCall.arguments
      );
      if (detection.stuck && detection.level === 'critical') {
        const detector = detection.detector ?? 'unknown';
        const message = detection.message ?? '未提供详情';
        logger.warn('LoopDetector 检测到工具调用循环，中止执行', {
          sessionId: this.ctx.session.id,
          toolName,
          toolArgs: toolCall.arguments,
          detector,
          message,
          turn: this.toolTurnCount,
          completedToolNames: this.completedToolNames,
          currentToolNames: this.currentToolCalls.map((tc) =>
            getToolCallName(tc)
          ),
        });
        this.currentToolCalls = [];
        return {
          detector,
          level: 'critical',
          message,
          breakMessage: `\n\n⚠️ 检测到工具调用循环 [${detector}] ${message}，任务提前终止。`,
        };
      } else if (detection.stuck && detection.level === 'warning') {
        logger.info('LoopDetector 警告', {
          sessionId: this.ctx.session.id,
          toolName,
          toolArgs: toolCall.arguments,
          detector: detection.detector ?? 'unknown',
          message: detection.message ?? '未提供详情',
          turn: this.toolTurnCount,
          completedToolNames: this.completedToolNames,
        });
      }
    }
    return null;
  }

  /** 执行本轮所有工具调用 */
  private async *_executeToolRound(): AsyncGenerator<
    ChatStreamChunk,
    Array<{ normalizedToolCall: ToolCall; result: ToolResult }>
  > {
    const processedResults: Array<{
      normalizedToolCall: ToolCall;
      result: ToolResult;
    }> = [];

    for (const toolCall of this.currentToolCalls) {
      const toolName = getToolCallName(toolCall);

      // P2（08-09）：交互恢复 — 注入用户答案
      const isInteractionRecovery =
        this.interactionContext &&
        this.currentToolCalls.indexOf(toolCall) ===
          this.interactionContext.interactionIdx;
      if (isInteractionRecovery) {
        (toolCall.arguments as Record<string, unknown>)._userAnswers =
          this.interactionContext!.userAnswers;
      }

      // 交互检查（交互恢复时跳过，因为用户已回答）
      if (!isInteractionRecovery) {
        const toolObj = this.ctx.toolRegistry.getTool(toolName);
        if (toolObj?.requiresUserInteraction?.()) {
          yield* this._handleInteraction(toolCall, toolName, toolObj);
        }
      }

      // 执行工具
      const toolResult = await this.ctx.executeTool(
        {
          id: toolCall.id,
          name: toolName,
          arguments: toolCall.arguments,
          sessionId: this.ctx.session.id,
        },
        { useErrorHandler: true }
      );

      // 注册表 + 持久化
      this.ctx.toolResultRegistry.storeResult(
        this.ctx.session.id,
        toolCall.id,
        toolName,
        toolCall.arguments,
        { result: toolResult.result, error: toolResult.error },
        this.ctx.toolResultRegistry.getCurrentRound(this.ctx.session.id)
      );
      const toolResultMsg = this.ctx.messageService.createToolResultMessage(
        toolResult,
        {
          sessionId: this.ctx.session.id,
          metadata: toolResult.metadata,
        }
      );
      this.ctx.addAndPersistMessage(this.ctx.session.id, toolResultMsg);

      processedResults.push({
        normalizedToolCall: {
          id: toolCall.id,
          name: toolName,
          arguments: toolCall.arguments,
        },
        result: toolResult,
      });

      this.completedToolNames.push(toolName);

      // pendingApproval 工具不算完成
      const isPendingApproval =
        (toolResult as { result?: { pendingApproval?: boolean } })?.result
          ?.pendingApproval === true;
      if (!isPendingApproval) {
        this.completedToolCallIds.push(toolCall.id);
      }

      // 流式检查点
      await this.ctx.streamingCheckpoint.onToolCompleted({
        newMessagesSinceLastCheckpoint: [this.assistantMessage, toolResultMsg],
        messagesSnapshot: this.ctx.session.messages.slice(),
        currentToolCalls: this.currentToolCalls
          .filter((tc) => tc.id !== toolCall.id)
          .map((tc) => ({
            id: tc.id,
            name: getToolCallName(tc),
            arguments: tc.arguments,
          })),
        completedToolCallIds: [...this.completedToolCallIds],
        generatorState: {
          toolTurnCount: this.toolTurnCount,
          llmCallCount: this.llmCallCount,
        },
        metadata: { model: this.ctx.options?.model },
        sessionState: this.ctx.session.state,
      });

      // LoopDetector 记录
      this.ctx.loopDetector.recordToolCallOutcome(
        toolName,
        toolCall.arguments,
        toolResult.result,
        toolResult.error
      );

      // yield tool_call 完成 chunk
      yield {
        type: 'tool_call',
        content: toolResult.error
          ? `工具 ${toolName} 执行失败: ${toolResult.error.slice(0, 300)}`
          : '',
        sessionId: this.ctx.session.id,
        toolCall: {
          id: toolCall.id,
          name: toolName,
          arguments: toolCall.arguments,
          status: toolResult.error ? 'failed' : 'completed',
        },
      } as ChatStreamChunk;

      // yield todo chunk
      const todoData = extractTodoData(toolResult);
      if (todoData) {
        yield {
          type: 'todo',
          content: JSON.stringify(todoData),
          sessionId: this.ctx.session.id,
          todoData,
        } as ChatStreamChunk;
      }
    }

    return processedResults;
  }

  /** 处理用户交互工具 */
  private async *_handleInteraction(
    toolCall: ParsedToolCall,
    toolName: string,
    toolObj: {
      requiresUserInteraction?: () => boolean;
      isDestructive?: (input?: Record<string, unknown>) => boolean;
    }
  ): AsyncGenerator<ChatStreamChunk, void> {
    const toolArgs = toolCall.arguments as Record<string, unknown>;
    const questionId = `q_${Date.now()}_${(toolCall.id || '').slice(0, 8)}`;
    const rawOptions =
      (toolArgs.options as Array<{ label?: string; description?: string }>) ||
      [];
    const validatedOptions = rawOptions
      .filter((opt) => opt.label && String(opt.label).trim().length > 0)
      .slice(0, 4)
      .map((opt) => ({
        label: String(opt.label).trim(),
        description: opt.description ? String(opt.description).trim() : '',
      }));

    let finalOptions =
      validatedOptions.length >= 2
        ? validatedOptions
        : [
            { label: '好的，开始讨论', description: '按当前方向直接开始' },
            { label: '我补充信息', description: '我还有其他信息要补充' },
          ];

    let interactionResolve!: (answers: string[]) => void;
    const interactionPromise = new Promise<string[]>(
      (resolve) => (interactionResolve = resolve)
    );
    this.ctx.pendingInteractions.set(this.ctx.session.id, {
      questionId,
      promise: interactionPromise,
      resolve: interactionResolve,
    });

    yield {
      type: 'question',
      content: (toolArgs.question as string) || '',
      sessionId: this.ctx.session.id,
      toolCall: {
        id: toolCall.id,
        name: toolName,
        arguments: toolArgs,
      },
      questionData: {
        questionId,
        question: (toolArgs.question as string) || '',
        header: (toolArgs.header as string) || '请选择',
        options: finalOptions,
        multiSelect: toolArgs.multiSelect as boolean | undefined,
      },
    } as ChatStreamChunk;

    const INTERACTION_TIMEOUT_MS = 10 * 60 * 1000;
    const answers = await Promise.race([
      interactionPromise,
      new Promise<string[]>((resolve) =>
        setTimeout(() => {
          const isDestructive = toolObj?.isDestructive?.(
            toolCall.arguments as Record<string, unknown>
          );
          if (isDestructive) {
            logger.warn('交互等待超时，破坏性工具默认拒绝', {
              sessionId: this.ctx.session.id,
              questionId,
              toolName,
            });
            resolve([]);
          } else {
            logger.warn('交互等待超时，按第一个选项默认提交', {
              sessionId: this.ctx.session.id,
              questionId,
            });
            resolve([finalOptions[0]?.label || '']);
          }
        }, INTERACTION_TIMEOUT_MS)
      ),
    ]);
    this.ctx.pendingInteractions.delete(this.ctx.session.id);
    (toolCall.arguments as Record<string, unknown>)._userAnswers = answers;
  }

  /** LLM 流式调用（含残缺工具调用重试） */
  private async *_streamLlmRound(
    updatedMessages: Record<string, unknown>[],
    signal: AbortSignal | undefined
  ): AsyncGenerator<
    ChatStreamChunk | string,
    { response: ChatResponse | null; cleanContent: string }
  > {
    const toolRoundBaseMaxTokens =
      (this.ctx.options?.maxTokens as number | undefined) ?? 4096;
    let toolRoundRetried = false;

    for (;;) {
      const toolGen = this.ctx.activeClient.streamMessage(
        updatedMessages as unknown as ChatMessage[],
        {
          ...this.ctx.options,
          maxTokens: toolRoundRetried
            ? Math.min(Math.max(toolRoundBaseMaxTokens * 2, 8192), 64000)
            : toolRoundBaseMaxTokens,
          signal,
          tools:
            this.ctx.toolDefinitions.length > 0
              ? (this.ctx.toolDefinitions as unknown as ToolDefinition[])
              : undefined,
        }
      );

      let roundContent = '';
      let toolResultIter = await toolGen.next();
      try {
        while (!toolResultIter.done) {
          const chunk = toolResultIter.value as string | ThinkingProviderChunk;
          if (typeof chunk === 'string') {
            roundContent += chunk;
          } else if (chunk?.type === 'thinking') {
            yield {
              type: 'thinking',
              content: chunk.content,
              sessionId: this.ctx.session.id,
            } as ChatStreamChunk;
          }
          toolResultIter = await toolGen.next();
        }
      } catch (toolGenErr) {
        await handleError(toolGenErr, {
          module: 'chat:ToolLoopRunner',
          action: 'streamLlmRound_iteration',
          context: { sessionId: this.ctx.session.id },
        });
        roundContent += `\n\n[工具轮次流式响应中断: ${toolGenErr instanceof Error ? toolGenErr.message.slice(0, 200) : String(toolGenErr).slice(0, 200)}]`;
      }

      // toolResultIter 现在是 done 迭代，其 value 是 ChatResponse
      const toolGenResponse = toolResultIter.value as unknown as ChatResponse;

      // 残缺工具调用检测
      const truncatedToolCall =
        !toolGenResponse?.tool_calls?.length &&
        /<\/?(?:parameter|invoke|tool_call|tool_calls)\b[^>]*>\s*$/i.test(
          roundContent.trimEnd()
        );
      if (truncatedToolCall && !toolRoundRetried) {
        toolRoundRetried = true;
        logger.warn('toolRound:truncated_tool_call_retry', {
          sessionId: this.ctx.session.id,
          contentTail: roundContent.slice(-160),
        });
        yield {
          type: 'status',
          statusType: 'tool_retry',
          content: '工具调用输出不完整，正在重新生成...',
          sessionId: this.ctx.session.id,
        } as ChatStreamChunk;
        continue;
      }

      // yield 累积文本
      const repairedToolContent = ensureThinkResponseTags(
        repairImageUrls(roundContent)
      );
      const strippedToolContent = stripThinkResponseTags(repairedToolContent);
      const toolRoundScrubber = new StreamingToolCallScrubber();
      const toolScrubbed = toolRoundScrubber.scrub({
        content: strippedToolContent,
        isComplete: true,
      });
      const toolResidual = toolRoundScrubber.flush();
      const cleanToolContent = stripOrphanToolTags(
        toolScrubbed.content + toolResidual
      );

      const onStream = this.ctx.options?.onStream as
        | ((content: string) => void)
        | undefined;
      onStream?.(cleanToolContent);
      yield cleanToolContent;

      this.ctx.recordChatResponseUsage(
        this.ctx.session.id,
        toolGenResponse?.usage
      );
      // AB-10：工具轮次流式 LLM 用量上报前端（累加到 usage 事件）
      this.ctx.onToolUsage?.(
        (toolGenResponse?.usage as Record<string, unknown>) ?? {}
      );

      trackUsage(toolGenResponse ?? {}, {
        model: (this.ctx.options?.model as string) || 'unknown',
        providerId: this.ctx.activeClient.getProviderId(),
        latencyMs: 0,
        isStreaming: true,
        sessionId: this.ctx.session.id,
      }).catch(() => {});

      return { response: toolGenResponse, cleanContent: cleanToolContent };
    }
  }

  /** P2（08-09）：非流式 LLM 调用（交互恢复等场景） */
  private async _nonStreamingLlmRound(
    updatedMessages: Record<string, unknown>[]
  ): Promise<ChatResponse | null> {
    try {
      const response = await this.ctx.activeClient.sendMessage(
        updatedMessages as unknown as ChatMessage[],
        {
          ...this.ctx.options,
          tools:
            this.ctx.toolDefinitions.length > 0
              ? (this.ctx.toolDefinitions as unknown as ToolDefinition[])
              : undefined,
        }
      );

      this.ctx.recordChatResponseUsage(
        this.ctx.session.id,
        (response as unknown as { usage?: unknown }).usage
      );
      // AB-10：工具轮次非流式 LLM 用量上报前端（累加到 usage 事件）
      this.ctx.onToolUsage?.(
        ((response as unknown as { usage?: unknown }).usage as Record<
          string,
          unknown
        >) ?? {}
      );

      trackUsage(response as unknown as Record<string, unknown>, {
        model: (this.ctx.options?.model as string) || 'unknown',
        providerId: this.ctx.activeClient.getProviderId(),
        latencyMs: 0,
        isStreaming: false,
        sessionId: this.ctx.session.id,
      }).catch(() => {});

      return response;
    } catch (e) {
      await handleError(e, {
        module: 'chat:ToolLoopRunner',
        action: 'nonStreamingLlmRound',
        context: { sessionId: this.ctx.session.id },
      });
      return null;
    }
  }

  /** 准备下一轮：处理 LLM 响应 */
  private _prepareNextRound(
    toolResultResponse: ChatResponse,
    updatedMessages: Record<string, unknown>[],
    cleanContent: string
  ): void {
    const toolResultAssistantMsg =
      this.ctx.messageService.createAssistantMessage(cleanContent, {
        sessionId: this.ctx.session.id,
      });
    // ChatResponse from @modules/ai has stop_reason; the extended version from chat/models has finishReason
    const response = toolResultResponse as unknown as {
      finishReason?: string;
      stop_reason?: string;
      tool_calls?: ParsedToolCall[];
    };
    toolResultAssistantMsg.finishReason =
      response.finishReason || response.stop_reason || 'stop';

    if (toolResultResponse?.tool_calls?.length) {
      toolResultAssistantMsg.metadata = {
        ...toolResultAssistantMsg.metadata,
        tool_calls: toolResultResponse.tool_calls.map((tc: ParsedToolCall) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments:
              typeof tc.arguments === 'string'
                ? tc.arguments
                : JSON.stringify(tc.arguments || {}),
          },
        })),
      };
    }
    this.ctx.addAndPersistMessage(this.ctx.session.id, toolResultAssistantMsg);

    // 下一轮
    if (toolResultResponse?.tool_calls?.length) {
      this.ctx.toolResultRegistry.nextRound(this.ctx.session.id);
      this.currentMessages = updatedMessages;
      this.currentToolCalls = [...toolResultResponse.tool_calls];
      this.currentAssistantMsg = toolResultAssistantMsg;
      this.assistantMessage = toolResultAssistantMsg;
    } else {
      this.assistantMessage = toolResultAssistantMsg;
      this.currentToolCalls = [];
    }
  }

  /** 每 5 轮保存检查点 */
  private async *_savePeriodicCheckpoint(): AsyncGenerator<ChatStreamChunk> {
    if (this.toolTurnCount % 5 !== 0) return;

    try {
      await this.ctx.checkpointService.saveCheckpointWithData(
        this.ctx.session.id,
        this.ctx.session.messages,
        this.ctx.session.metadata,
        this.ctx.session.state,
        `auto-round-${this.toolTurnCount}`,
        `工具执行第 ${this.toolTurnCount} 轮自动检查点`,
        true,
        this.ctx.estimateMessagesTokens(
          this.ctx.session.messages as unknown as Record<string, unknown>[]
        )
      );
    } catch (e) {
      logger.warn('自动检查点保存失败（非关键）', {
        sessionId: this.ctx.session.id,
        round: this.toolTurnCount,
        error: String(e),
      });
    }
  }

  /** 获取最终的 assistantMessage（供 ChatManager 使用） */
  getFinalAssistantMessage(): Message {
    return this.assistantMessage;
  }
}
