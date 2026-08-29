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
 * ChatOrchestrator — 消息编排门面（ChatManager 拆分第 4 步）
 *
 * 从 ChatManager.ts 提取：sendMessage / streamMessage 编排核心。
 * 与 ChatManager 共享状态（Map 引用 + currentSessionId 端口），
 * 其余依赖通过委托回调注入（与 SessionLifecycleManager / ToolLoopRunner 同模式）。
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { SimpleMutex } from '@modules/core';
import type { ToolAwareClient } from '@modules/ai';
import type { ToolRegistry } from '@modules/tools';
import type { ChatMessage, ToolDefinition, ParsedToolCall } from '@modules/ai';
import type {
  ChatStreamChunk,
  QuestionData,
} from '@modules/runtime/api/CoreAPI.js';
import { compactionOrchestrator } from '@modules/context';
import type {
  Message,
  SendMessageOptions,
  StreamMessageOptions,
} from '../types/message.js';
import type { LiriEvent } from '../types/events.js';
import type { ChatSession } from '../types/session.js';
import type { ToolResult } from '../types/tool.js';
import type { SessionLifecycleManager } from '../services/SessionLifecycleManager.js';
import type { SessionCurrentIdPort } from '../services/SessionLifecycleManager.js';
import type { MessageService } from '../services/MessageService.js';
import type { UnifiedTokenTracker } from '../../core/tokenBudget/UnifiedTokenTracker.js';
import type { ImageContextService } from '../services/ImageContextService.js';
import type { HookChainManager } from '@modules/hooks';
import type { StreamingAutoCheckpoint } from '../services/StreamingAutoCheckpoint.js';
import type { MaxOutputRetryState } from '@modules/ai';
import type { DegradationState } from '@modules/ai';
import type { SessionMemoryManager } from '../services/SessionMemoryManager.js';
import type { SessionSummarizer } from '../services/SessionSummarizer.js';
import type { PdcaLauncher } from '../launchers/PdcaLauncher.js';
import type { Span } from '@opentelemetry/api';
import { securityService } from '../services/SecurityService.js';
import { recursivelySanitizeUnicode } from '@modules/utils/sanitization.js';
import { SensitiveErrorType } from '@modules/security';
import { trajectoryRuntime } from '@modules/core';
import type { SessionCheckpointService } from '../services/SessionCheckpointService.js';
import type { ChatManagerTAORContext } from '@modules/query';
import type { LoopDetector } from '@modules/query';

const logger = getLogger('chat:orchestrator');

/**
 * 编排所需的最小 ChatManager 端口（sendMessage/streamMessage 编排委托）
 */
export interface ChatOrchestratorHost {
  // ── 共享状态（Map 直接传共享引用） ──────────────────────────
  chatSessions: Map<string, ChatSession>;
  sessionMutexes: Map<string, SimpleMutex>;
  sessionAbortControllers: Map<string, AbortController>;
  currentSessionIdRef: SessionCurrentIdPort;
  pendingInteractions: Map<string, unknown>;
  /** 工具轮次计数（sendMessage TAORLoop/计划编排读取） */
  toolRoundCount: number;
  /** 工具轮次计数 +1（流式/非流式完成后调用，确保 turn 编号唯一） */
  incrementToolRoundCount(): void;
  /** 是否正在执行计划（create_task_list 编排标志） */
  executingPlan: boolean;
  /** 原子切换 executingPlan 并执行（finally 恢复原值） */
  withExecutingPlan<T>(flag: boolean, fn: () => Promise<T>): Promise<T>;

  // ── 只读配置/标志 ─────────────────────────────────────────
  readonly ENABLE_TELEMETRY: boolean;
  readonly ENABLE_TRAJECTORY: boolean;
  readonly ENABLE_PLAN_DRIVEN_LOOP: boolean;
  readonly MAX_TOOL_TURNS: number;

  // ── 依赖服务 ──────────────────────────────────────────────
  messageService: MessageService;
  sessionLifecycle: SessionLifecycleManager;
  hookChainManager: HookChainManager;
  unifiedTracker: UnifiedTokenTracker;
  imageContextService: ImageContextService;
  checkpointService: SessionCheckpointService;
  memoryManager: SessionMemoryManager | null;
  summarizer: SessionSummarizer | null;
  pdcaLauncher: PdcaLauncher | null;
  /** 工具循环检测器（ToolLoopRunner 依赖，缺失会导致工具执行 TypeError） */
  loopDetector: LoopDetector;

  // ── 委托回调（编排需要触达 ChatManager 的其他能力） ─────────
  getLLMClient(): ToolAwareClient;
  getClientForModel(model?: string): ToolAwareClient;
  getToolRegistry(): ToolRegistry | null;
  buildToolDefinitions(schemas: unknown[]): ToolDefinition[];
  addAndPersistMessage(sessionId: string, message: Message): void;
  /**
   * M1 事件溯源：流式过程中追加事件到 events.jsonl
   *
   * 供 streamMessageFlow 在每个 chunk yield 前调用，
   * 把 thinking/text chunk 实时落盘到事件日志。
   * 失败不阻断流式（CS03），返回结果含失败原因。
   */
  appendStreamEvent(
    sessionId: string,
    event: LiriEvent
  ): Promise<{ ok: boolean; reason?: string; tailSeq: number }>;
  /**
   * M1 事件溯源：获取当前会话的 tailSeq
   *
   * 供 streamMessageFlow 在流式开始时调用，决定 turn/start 与首个 chunk 的 seq。
   */
  getStreamTailSeq(sessionId: string): Promise<number>;
  /**
   * M1 事件溯源：获取当前会话已有事件的最大 turn 编号（重启后恢复 turn 计数）
   *
   * 供 streamMessageFlow 在写入 turn/start 时调用，替代内存计数器 toolRoundCount，
   * 避免后端重启后 turn 编号从 1 重新开始导致重复 turn 号。
   */
  getStreamMaxTurn(sessionId: string): Promise<number>;
  getSessionMachine(sessionId: string): {
    start(reason?: string): unknown;
    finish(reason?: string): unknown;
  };
  getOrAssembleSystemPrompt(
    session: ChatSession,
    content: string
  ): Promise<string>;
  extractFilePathsFromText(text: string): string[];
  extractMemoryFromChat(
    userMsg: string,
    aiMsg: string,
    sessionId: string
  ): Promise<void>;
  recordChatResponseUsage(
    sessionId: string,
    usage: Record<string, number> | null | undefined
  ): void;
  sanitizeApiMessages(messages: Record<string, unknown>[]): void;
  truncateApiMessages(
    messages: Record<string, unknown>[],
    maxTokens: number,
    sessionId: string,
    outputBudgetTokens?: number
  ): Promise<void>;
  persistTurnSummary(session: ChatSession): void;
  flushPendingPersists(): Promise<void>;
  shouldUseTAORLoop(sessionId: string): boolean;
  getOrCreateTAORLoop(sessionId: string): unknown;
  buildTAORContext(
    sessionId: string,
    toolDefinitions: ToolDefinition[],
    options?: SendMessageOptions
  ): unknown;
  executeTool(
    toolCall: {
      id: string;
      name: string;
      arguments: unknown;
      sessionId: string;
    },
    opts?: { useErrorHandler?: boolean }
  ): Promise<ToolResult>;
  executeStepPrompt(
    prompt: string,
    session: ChatSession,
    options?: SendMessageOptions
  ): Promise<void>;
  executePlanSteps(
    session: ChatSession,
    options?: SendMessageOptions
  ): Promise<void>;
  triggerCouncilDebate(
    workspaceId: string,
    topic: string,
    context: string
  ): Promise<void>;
  sendMessageDowngradePath(
    session: ChatSession,
    toolCalls: ParsedToolCall[],
    apiMessages: Record<string, unknown>[],
    activeClient: ToolAwareClient,
    options?: SendMessageOptions
  ): Promise<Message>;
  /** 是否触发 Council 辩论（sendMessage 收尾判断） */
  shouldTriggerCouncil(
    session: ChatSession,
    content: string,
    options?: SendMessageOptions
  ): boolean;
  /** 异步发起 Council 辩论（不阻塞主流程） */
  triggerCouncilDebateAsync(
    session: ChatSession,
    content: string,
    options?: SendMessageOptions
  ): void;
  /** telemetry/trajectory 回合收尾 */
  endTurnTelemetry(sessionId: string, ok: boolean, content?: string): void;
  /** Agent Loop 完成回调（AlwaysOnManager 注册） */
  onTurnEnd?: () => void;

  // ── 流式编排端口（streamMessageFlow 委托） ─────────────────
  _prepareStreamSession(
    content: string,
    options?: StreamMessageOptions
  ): Promise<{
    content: string;
    session: ChatSession;
    streamAbortController: AbortController;
    streamingCheckpoint: StreamingAutoCheckpoint;
    mutex: SimpleMutex;
    userMessage: Message;
    streamSpan: Span;
  }>;
  _buildApiMessagesForStream(
    messages: Message[]
  ): Promise<Record<string, unknown>[]>;
  _createStreamPipeline(
    session: ChatSession,
    content: string,
    options?: StreamMessageOptions
  ): {
    ctx: {
      apiMessages: Record<string, unknown>[];
      toolDefinitions: ToolDefinition[];
      accumulatedContent: string;
      finalResponse: unknown;
      assistantMessage?: Message;
    };
    registerImages(): Promise<void>;
    preStreamHook(): Promise<void>;
    assembleSystemPrompt(
      fn: (s: ChatSession, c: string) => Promise<string>
    ): Promise<void>;
    compactContext(): Promise<{
      applied: boolean;
      beforeTokens: number;
      afterTokens: number;
      savedPercent: number;
    }>;
    repairContent(): string;
    recordUsage(): void;
    notifyUsage(): void;
    createAssistantMessage(content: string, opts?: { id?: string }): Message;
    postProcess(content: string): Promise<void>;
  };
  _finalizeStreamMessage(
    session: ChatSession,
    content: string,
    accumulatedContent: string,
    assistantMessage: Message,
    finalResponse: unknown,
    streamAbortController: AbortController,
    streamSpan: Span,
    options?: StreamMessageOptions
  ): Promise<Message>;
  /** 回滚轮次启动（streamMessage 工具循环） */
  startRollbackRound(sessionId: string, roundId: number): Promise<unknown>;
  /** 回滚轮次结束 */
  endRollbackRound(
    sessionId: string,
    content: string,
    firstAssistantContent: string
  ): Promise<unknown>;
  /** 构建工具轮次消息 */
  buildToolRoundMessages(
    messages: Record<string, unknown>[],
    assistantMessage: Message,
    toolCalls: ParsedToolCall[],
    processedResults: Array<{
      normalizedToolCall: ParsedToolCall;
      result: ToolResult;
    }>
  ): Record<string, unknown>[];
}

/**
 * ChatOrchestrator 门面依赖
 */
export interface ChatOrchestratorDeps {
  host: ChatOrchestratorHost;
}

/**
 * ChatOrchestrator — 消息编排门面
 *
 * 提供 sendMessage（非流式）/ streamMessage（流式）编排入口。
 * 大段阶段逻辑委托给 sendMessageFlow / streamMessageFlow 函数模块，
 * 本类保持薄编排（< 800 行），满足 R04-001。
 */
export class ChatOrchestrator {
  private readonly host: ChatOrchestratorHost;

  constructor(deps: ChatOrchestratorDeps) {
    this.host = deps.host;
  }

  /**
   * 发送消息（非流式）— 主编排
   * 委托 sendMessageFlow 的阶段函数完成消息构建/压缩/LLM 调用/工具循环。
   */
  async sendMessage(
    content: string,
    options?: SendMessageOptions
  ): Promise<Message> {
    // 清理用户输入 + 脱敏（与原 sendMessage 行为一致）
    let safeContent = recursivelySanitizeUnicode(content) as string;
    const { validateInput, sanitize } = securityService;
    const validationResult = validateInput(safeContent);
    if (!validationResult.valid) {
      logger.warn('用户输入包含敏感数据，已自动脱敏处理', {
        module: 'chat:manager',
        action: 'sendMessage',
      });
      safeContent = sanitize(safeContent);
      securityService.logSecurityError({
        type: SensitiveErrorType.SENSITIVE_DATA_DETECTED,
        message: '用户输入包含敏感数据，已自动脱敏处理',
      });
    }

    // 检查是否是命令
    if (safeContent.startsWith('/')) {
      return this._handleCommand(safeContent, options);
    }

    // 获取或创建会话
    const sessionId = options?.sessionId || this.host.currentSessionIdRef.get();
    if (!sessionId) {
      throw new Error('No session id provided');
    }
    const session = await this.host.sessionLifecycle.getOrLoadSession(
      sessionId,
      options?.metadata
    );
    if (!session) {
      throw new Error('No session found or created');
    }

    // Session Mutex
    let mutex = this.host.sessionMutexes.get(sessionId);
    if (!mutex) {
      mutex = new SimpleMutex();
      this.host.sessionMutexes.set(sessionId, mutex);
    }

    return mutex.run(async () => {
      // hook 前置
      const preMsgResult = await this.host.hookChainManager.execute('chat', {
        event: 'chat.pre-message',
        data: { message: safeContent, sessionId: session.id },
        sessionId: session.id,
      });
      for (const hr of preMsgResult.before) {
        if (
          hr.data &&
          typeof hr.data === 'object' &&
          'message' in (hr.data as Record<string, unknown>)
        ) {
          safeContent = (hr.data as Record<string, string>).message;
        }
      }

      // 用户消息 + 轮次计数 + 持久化（前端写前落盘后按 id 复用，避免重复持久化）
      let userMessage: Message;
      const prePersisted = options?.messageId
        ? (session.messages.find((m) => m.id === options.messageId) as
            | Message
            | undefined)
        : undefined;
      const prevRoundCount = session.metadata.roundCount ?? 0;
      session.metadata.roundCount = prevRoundCount + 1;
      const fromInternal = options?._fromInternal === true;
      if (!fromInternal) {
        // Buddy 成长：用户发起对话才计数（内部调用不计入，精确"用户真实对话轮数"）
        void import('@modules/buddy')
          .then(({ recordUserSession }) => recordUserSession())
          .catch((err) =>
            logger.warn('Buddy 用户对话轮次埋点失败', { error: String(err) })
          );
      }
      if (fromInternal) {
        // 现场调试断点：内部调用触发时醒目提示（默认日志级别可见）
        logger.info(
          '[内部调用断点] _fromInternal=true，本轮不计入 userSessions',
          {
            sessionId: session.id,
            roundCountFrom: prevRoundCount,
            roundCountTo: session.metadata.roundCount,
            source: options?._fromInternalSource ?? 'unknown',
          }
        );
      }
      logger[fromInternal ? 'debug' : 'info']('用户对话轮次+1（非流式）', {
        sessionId: session.id,
        roundCountFrom: prevRoundCount,
        roundCountTo: session.metadata.roundCount,
        model: options?.model ?? null,
        contentLength: safeContent.length,
        prePersisted: !!prePersisted,
        messageId: options?.messageId ?? null,
        _fromInternal: options?._fromInternal ?? false,
        source: fromInternal ? 'internal' : 'user',
      });
      if (prePersisted) {
        userMessage = prePersisted;
      } else {
        userMessage = this.host.messageService.createUserMessage(safeContent, {
          sessionId: session.id,
          metadata: options?.metadata,
        });
        this.host.addAndPersistMessage(session.id, userMessage);
      }
      this.host.getSessionMachine(session.id).start('sendMessage');

      const { getOTelTracing } = await import('@modules/monitoring');
      const sendSpan = getOTelTracing().startSpan('chat.sendMessage', {
        'session.id': session.id,
      });

      let response: import('@modules/ai').ChatResponse;
      let assistantMessage: Message;
      try {
        // telemetry 初始化
        if (this.host.ENABLE_TRAJECTORY) {
          const { trajectoryRecorder } =
            await import('../../agent/trajectory/TrajectoryRecorder');
          try {
            trajectoryRecorder.startSession(session.id, options?.model);
          } catch (err) {
            logger.debug('Telemetry recording skipped', {
              error: err instanceof Error ? err.message : String(err),
            });
          }
          try {
            trajectoryRuntime.startSession(session.id, options?.model);
          } catch (err) {
            logger.debug('Telemetry recording skipped', {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        if (!this.host.getLLMClient()) {
          throw new Error('LLM client not initialized');
        }
        const activeClient = this.host.getClientForModel(options?.model);

        // 构建编排上下文 + 阶段管线
        const {
          prepareApiMessages,
          assembleSystemPrompt,
          loadSharedContext,
          compactContext,
          invokeLlm,
          buildAssistantMessage,
          notifyUsage,
          validateOutputPaths,
          shouldRunPlan,
        } = await import('./sendMessageFlow.js');
        const ctx = {
          host: this.host,
          content: safeContent,
          options,
          session,
          sessionId: session.id,
          apiMessages: [] as Record<string, unknown>[],
          toolDefinitions: [] as ToolDefinition[],
        };

        // 阶段 1: 构建 API 消息
        ctx.apiMessages = prepareApiMessages(ctx);

        // 工具定义
        const registry = this.host.getToolRegistry();
        ctx.toolDefinitions = registry
          ? this.host.buildToolDefinitions(registry.getToolSchemas())
          : [];

        // 注入注册表查询工具
        const { toolResultRegistry } =
          await import('../../tool/ToolResultRegistry');
        if (toolResultRegistry.getRoundCount(session.id) > 0) {
          ctx.toolDefinitions.push(
            {
              type: 'function',
              function: {
                name: 'get_tool_result',
                description: '获取工具执行结果',
                parameters: { type: 'object', properties: {} },
              },
            } as ToolDefinition,
            {
              type: 'function',
              function: {
                name: 'list_tool_calls',
                description: '列出工具调用',
                parameters: { type: 'object', properties: {} },
              },
            } as ToolDefinition
          );
        }

        // 阶段 2: 系统提示
        await assembleSystemPrompt(ctx);

        // 阶段 3: 共享上下文
        await loadSharedContext(ctx);

        // 阶段 4: 上下文压缩
        await compactContext(ctx);

        // 进度通知
        options?.onProgress?.({
          stage: 'analyzing',
          message: '正在分析问题...',
        });

        // 阶段 5: LLM 调用
        const { response: llmResponse, llmStartTime } = await invokeLlm(
          ctx,
          activeClient
        );
        response = llmResponse;

        // 阶段 6: 构建助手消息 + 持久化
        assistantMessage = buildAssistantMessage(ctx, response);

        // 路径幻觉校验（dry-run）
        await validateOutputPaths(ctx, assistantMessage.content as string);

        // 阶段 7: 用量通知
        notifyUsage(ctx, response, Date.now() - llmStartTime);

        // 项1（会话排查 2026-08-13）：非流式发送完成后的后台预压缩——压缩结果写回
        // 会话，下一轮窗口更小。fire-and-forget 不阻塞本轮；长度守卫防覆盖
        // （若后续工具循环新增消息则放弃写回，安全）。
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

        // 响应后自动提取记忆
        await this.host.extractMemoryFromChat(
          safeContent,
          assistantMessage.content as string,
          session.id
        );

        // 触发 ChatPostMessage Hook
        await this.host.hookChainManager.execute('chat', {
          event: 'chat.post-message',
          data: { message: safeContent, response, sessionId: session.id },
          sessionId: session.id,
        });

        // 工具调用 — TAORLoop / 降级路径
        if (response.tool_calls && response.tool_calls.length > 0) {
          if (this.host.shouldUseTAORLoop(session.id)) {
            logger.info('sendMessage 委托 TAORLoop 编排工具调用循环', {
              sessionId: session.id,
              toolCalls: response.tool_calls.length,
              toolNames: response.tool_calls.map((tc) => tc.name),
            });
            // P0-1 修复（2026-08-20 渠道排查）：invokeLlm 的响应（含 tool_calls）此前
            // 未写回 ctx.apiMessages，TAORLoop 拿到的上下文缺失"本轮已决定调用工具"的
            // assistant 消息 → 重新调 LLM 时模型不再生成 tool_calls → turns:1 直接
            // completed，工具从未执行（各渠道"只回一次+动作不执行"根因）。
            // 修复：委托前补入第一响应，TAOR 从 ACT 阶段续跑而非重新开始。
            const assistantTurnMessage: Record<string, unknown> = {
              role: 'assistant',
              content: response.content ?? '',
              tool_calls: response.tool_calls,
            };
            ctx.apiMessages.push(assistantTurnMessage);
            logger.info('sendMessage 第一响应已补入 TAOR 上下文', {
              sessionId: session.id,
              appendedRole: 'assistant',
              hasToolCalls: true,
              toolCallCount: response.tool_calls.length,
              contentPreview: (response.content ?? '').slice(0, 50),
              apiMessagesTotal: ctx.apiMessages.length,
            });
            try {
              const { createChatManagerTAORDeps } =
                await import('../../query/ChatManagerTAORAdapter');
              const taorLoop = this.host.getOrCreateTAORLoop(session.id) as {
                reset(): void;
                runCollect(input: {
                  messages: import('@modules/ai').ChatMessage[];
                  deps: unknown;
                }): Promise<{
                  turnCount: number;
                  totalTokens: number;
                  stopReason: string;
                }>;
              };
              taorLoop.reset();
              const taorContext = this.host.buildTAORContext(
                session.id,
                ctx.toolDefinitions,
                options
              );
              const deps = createChatManagerTAORDeps(
                taorContext as ChatManagerTAORContext
              );
              const taorMessages: ChatMessage[] = ctx.apiMessages.map((m) => ({
                role: (m.role as ChatMessage['role']) || 'user',
                content:
                  typeof m.content === 'string'
                    ? m.content
                    : JSON.stringify(m.content),
                ...(m.tool_call_id
                  ? { tool_call_id: m.tool_call_id as string }
                  : {}),
                ...(m.tool_calls
                  ? { tool_calls: m.tool_calls as ChatMessage['tool_calls'] }
                  : {}),
              }));
              const taorResult = await taorLoop.runCollect({
                messages: taorMessages,
                deps,
              });
              logger.info('sendMessage TAORLoop 完成', {
                sessionId: session.id,
                turns: taorResult.turnCount,
                tokens: taorResult.totalTokens,
                reason: taorResult.stopReason,
              });
              this.host.onTurnEnd?.();
              // TAORLoop 已持久化消息，取会话最后一条 assistant 作为返回值
              const updatedSession = this.host.chatSessions.get(session.id);
              if (updatedSession) {
                const lastAssistant = [...updatedSession.messages]
                  .reverse()
                  .find((m) => m.role === 'assistant');
                if (lastAssistant) assistantMessage = lastAssistant;
              }
            } catch (err) {
              await handleError(err, {
                module: 'chat:ChatManager',
                action: 'sendMessage_TAORLoop_fallback',
              });
              logger.warn('TAORLoop 执行失败，降级到逐工具执行', {
                sessionId: session.id,
                error: err instanceof Error ? err.message : String(err),
              });
              assistantMessage = await this.host.sendMessageDowngradePath(
                session,
                response.tool_calls!,
                ctx.apiMessages,
                activeClient,
                options
              );
            }
          }
        }

        // create_task_list 计划编排
        if (shouldRunPlan(ctx, response)) {
          await this.host.withExecutingPlan(true, () =>
            this.host.executePlanSteps(session, options)
          );
        }

        options?.onProgress?.({ stage: 'completed', message: '处理完成' });
      } catch (sendErr) {
        await handleError(sendErr, {
          module: 'chat:ChatManager',
          action: 'sendMessage',
          context: { sessionId: session.id },
        });
        response = {
          content: `处理请求时发生错误: ${sendErr instanceof Error ? sendErr.message : String(sendErr)}`,
          stop_reason: 'stop' as const,
          tool_calls: [],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          model: options?.model ?? '',
        };
        assistantMessage = this.host.messageService.createAssistantMessage(
          response.content,
          { sessionId: session.id }
        );
      } finally {
        this.host.getSessionMachine(session.id).finish('sendMessage完成');
        getOTelTracing().endSpan(sendSpan);
      }

      // 收尾：跨轮摘要 + memory 累计
      this.host.persistTurnSummary(session);
      this.host.memoryManager?.accumulate(
        session.id,
        safeContent,
        typeof assistantMessage.content === 'string'
          ? assistantMessage.content
          : '',
        response.usage?.prompt_tokens || 0,
        response.tool_calls?.length || 0
      );

      // Council 辩论
      if (this.host.shouldTriggerCouncil(session, safeContent, options)) {
        this.host.triggerCouncilDebateAsync(session, safeContent, options);
        assistantMessage.content += `\n\n> 🏛️ 理事会正在讨论此议题，请切换到"理事会"标签页查看辩论过程。`;
      }

      this.host.endTurnTelemetry(
        session.id,
        true,
        assistantMessage.content as string
      );

      // 修复：非流式 sendMessage 完成后 turn 计数 +1，确保下次 turn 编号唯一
      this.host.incrementToolRoundCount();
      return assistantMessage;
    });
  }

  /** 命令处理（/ 前缀） */
  private async _handleCommand(
    content: string,
    options?: SendMessageOptions
  ): Promise<Message> {
    const cmdSessionId =
      options?.sessionId || this.host.currentSessionIdRef.get();
    const cmdSession = cmdSessionId
      ? await this.host.sessionLifecycle.getOrLoadSession(
          cmdSessionId,
          options?.metadata
        )
      : undefined;

    const parts = content.slice(1).split(' ');
    const [commandName, ...args] = parts;

    let commandResult = '';
    const { commandExecutor } = await import('../../commands/index.js');
    const { resolveProjectRoot } = await import('@modules/core/paths');
    const result = await commandExecutor.execute(
      `/${commandName} ${args.join(' ')}`,
      {
        sessionId: options?.sessionId || 'chat-session',
        cwd: resolveProjectRoot(),
        messages: cmdSession?.messages || [],
      }
    );
    commandResult = result.message || result.value || '';

    const commandMessage = this.host.messageService.createAssistantMessage(
      commandResult,
      {
        sessionId: options?.sessionId,
        metadata: {
          isCommand: true,
          command: commandName,
        },
      }
    );

    const resultSession = cmdSessionId
      ? await this.host.sessionLifecycle.getOrLoadSession(
          cmdSessionId,
          options?.metadata
        )
      : undefined;
    if (resultSession) {
      this.host.addAndPersistMessage(resultSession.id, commandMessage);
    }
    return commandMessage;
  }

  /** 流式消息编排入口（委托 streamMessageFlow） */
  async *streamMessage(
    content: string,
    options?: StreamMessageOptions
  ): AsyncGenerator<string | ChatStreamChunk, Message, unknown> {
    const { runStreamMessage } = await import('./streamMessageFlow.js');
    const gen = runStreamMessage(this.host, content, options);
    let next = await gen.next();
    while (!next.done) {
      yield next.value;
      next = await gen.next();
    }
    return next.value;
  }
}
