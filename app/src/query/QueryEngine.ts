/**
 * QueryEngine核心
 * 基于现有ChatManager和其他组件实现查询引擎核心功能
 */

import type { Message } from '../chat/types/message.js';
import type { ToolCall, ToolResult } from '../chat/types/tool.js';
import type { ToolUseBlock } from '../chat/types/ToolUseBlock.js';
import type { ChatSession } from '../chat/types/session.js';
import {
  PostSamplingHookManager,
  createPostSamplingHookManager,
} from '../hooks/managers/PostSamplingHookManager.js';

/**
 * QueryEngine 所需的 ChatManager 最小接口
 * 避免 ChatManager ↔ QueryEngine 循环依赖
 */
interface IChatManagerForQuery {
  sendMessage(
    content: string,
    options?: Record<string, unknown>
  ): Promise<Message>;
  executeTool(toolCall: ToolCall): Promise<ToolResult>;
  getSessions(): ChatSession[];
  saveSession(session: ChatSession): Promise<void>;
}
import type {
  PostSamplingHookContext,
  PostSamplingHook,
} from '../hooks/types/PostSampling.js';
import type { ToolUseContext } from '../tools/types/ToolUseContext.js';
import { MemoryIntegration } from '../memory/integrations/MemoryIntegration.js';
import {
  compactionOrchestrator,
  type CompactionContext,
} from '../context/compaction/CompactionOrchestrator';
import type { ChatMessage } from '../ai/models/types';
import { AnalyticsService, analyticsService } from '../analytics/index.js';
import {
  AnalyticsEventQueue,
  getGlobalAnalyticsQueue,
} from '../analytics/AnalyticsEventQueue.js';
import {
  CostAnalyticsTracker,
  createCostAnalyticsTracker,
  setCostAnalyticsTracker,
} from '../analytics/CostAnalyticsTracker.js';
import { createPostCallSummaryHook } from '../hooks/postSampling/PostCallSummaryHook.js';
import {
  withRetry,
  categorizeAPIError,
  DEFAULT_RETRY_CONFIG,
  type RetryConfig,
} from './withRetry.js';
import {
  processUserInput as processInput,
  sanitizeUserInput,
  type ProcessedInput,
} from './processUserInput.js';
import {
  TokenBudgetController,
  TokenBudgetStatus,
  getDefaultTokenBudget,
} from '../core/tokenBudget/TokenBudgetController.js';
import { UnifiedTokenTracker } from '../core/tokenBudget/UnifiedTokenTracker.js';
import { ContextTracker } from './context/ContextTracker.js';
import { getTokenCountFromUsage } from '../services/tokenManagement/TokenCounter.js';
import type { TokenUsage } from '../services/tokenManagement/TokenCounter.js';
import {
  StopHookManager,
  createStopHookManager,
  type StopHook,
  type StopHookContext,
  type StopHookReason,
} from './StopHooks.js';
import { ToolCallPartitioner } from '../tools/orchestration/Partitioner.js';
import { ToolCallTracker } from '../utils/ToolCallTracker.js';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { QueryLogStore, getQueryLogStore } from './QueryLogStore.js';

const logger = getLogger('query:engine');

/**
 * 查询状态枚举
 */
export enum QueryState {
  IDLE = 'idle',
  RUNNING = 'running',
  WAITING_FOR_TOOL = 'waiting_for_tool',
  COMPACTING = 'compacting',
  COMPLETED = 'completed',
  ERROR = 'error',
  ABORTED = 'aborted',
}

/**
 * 会话状态接口
 */
export interface SessionState {
  sessionId: string;
  queryState: QueryState;
  turnCount: number;
  startTime: number;
  lastActivityTime: number;
  totalUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
  };
  totalCostUSD: number;
  errorCount: number;
  toolCallCount: number;
}

/**
 * 进度事件接口
 */
interface ProgressEvent {
  type:
    | 'query_start'
    | 'query_end'
    | 'tool_start'
    | 'tool_end'
    | 'compact_start'
    | 'compact_end'
    | 'api_start'
    | 'api_end';
  timestamp: number;
  data?: Record<string, unknown>;
}

/**
 * 查询配置接口
 */
export interface QueryEngineConfig {
  maxTurns?: number;
  maxBudgetUsd?: number;
  taskBudget?: { total: number };
  includePartialMessages?: boolean;
  customSystemPrompt?: string;
  appendSystemPrompt?: string;
  querySource?: string;
  retryConfig?: RetryConfig;
}

/**
 * 错误类型枚举
 */
export enum QueryErrorType {
  API_ERROR = 'api_error',
  TOOL_ERROR = 'tool_error',
  PERMISSION_DENIED = 'permission_denied',
  TIMEOUT = 'timeout',
  BUDGET_EXCEEDED = 'budget_exceeded',
  MAX_TURNS_EXCEEDED = 'max_turns_exceeded',
  UNKNOWN = 'unknown',
}

/**
 * 查询错误接口
 */
export interface QueryError {
  type: QueryErrorType;
  message: string;
  code?: number;
  retryable: boolean;
  timestamp: number;
  details?: Record<string, unknown>;
}

/**
 * 查询参数接口
 */
export interface QueryParams {
  /**
   * 提示内容
   */
  prompt: string;

  /**
   * 会话ID
   */
  sessionId?: string;

  /**
   * 选项
   */
  options?: {
    /**
     * 是否启用工具调用
     */
    enableTools?: boolean;

    /**
     * 是否启用流式输出
     */
    enableStream?: boolean;

    /**
     * 最大迭代次数
     */
    maxIterations?: number;

    /**
     * 调试模式
     */
    debug?: boolean;

    /**
     * 最大预算（美元）
     */
    maxBudgetUsd?: number;
  };
}

/**
 * 查询结果接口
 */
export interface QueryResult {
  /**
   * 消息
   */
  message: Message;

  /**
   * 工具调用
   */
  toolCalls?: ToolCall[];

  /**
   * 工具结果
   */
  toolResults?: ToolResult[];

  /**
   * 是否完成
   */
  done: boolean;

  /**
   * 使用情况
   */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
  };
}

/**
 * SDK消息接口
 */
export interface SDKMessage {
  /**
   * 类型
   */
  type: 'text' | 'tool_use' | 'tool_result' | 'error';

  /**
   * 内容
   */
  content?: string;

  /**
   * 工具使用
   */
  toolUse?: {
    id: string;
    name: string;
    input: Record<string, unknown>;
  };

  /**
   * 工具结果
   */
  toolResult?: {
    toolUseId: string;
    content: string;
    isError?: boolean;
  };

  /**
   * 错误
   */
  error?: string;

  /**
   * 会话ID
   */
  session_id?: string;
}

/**
 * QueryEngine类
 */
export class QueryEngine {
  /**
   * 聊天管理器
   */
  private chatManager: IChatManagerForQuery;

  /**
   * 采样后置Hook管理器
   */
  private postSamplingHookManager: PostSamplingHookManager;

  /**
  /**
   * 记忆集成（可选）
   */
  private memoryIntegration: MemoryIntegration | null = null;

  /**
   * 分析服务
   */
  private analyticsService: AnalyticsService;

  /**
   * 成本追踪器
   */
  private costTracker: CostAnalyticsTracker;

  /**
   * 会话状态
   */
  private sessionState: SessionState | null = null;

  /**
   * 中止控制器
   */
  private abortController: AbortController | null = null;

  /**
   * Token 预算管理器
   */
  private tokenBudgetManager: TokenBudgetController;
  private unifiedTracker: UnifiedTokenTracker;

  /**
   * 进度监听器
   */
  private progressListeners: ((event: ProgressEvent) => void)[] = [];

  /**
   * 错误处理器
   */
  private errorHandlers: ((error: QueryError) => void)[] = [];

  /**
   * 配置
   */
  private config: QueryEngineConfig;

  /**
   * 停止钩子管理器
   */
  private stopHookManager: StopHookManager;

  /**
   * 查询开始时间（用于计算持续时间）
   */
  private queryStartTime: number = 0;

  /**
   * 查询日志存储（可选）
   */
  private queryLogStore: QueryLogStore | null = null;

  /**
   * 工具调用跟踪器 — 按"工具名+参数"粒度检测重复失败，触发熔断
   */
  private toolCallTracker: ToolCallTracker = new ToolCallTracker();

  /**
   * 构造函数
   * @param chatManager 聊天管理器
   * @param config 查询引擎配置
   */
  constructor(
    chatManager: IChatManagerForQuery,
    config: QueryEngineConfig = {}
  ) {
    this.chatManager = chatManager;
    this.postSamplingHookManager = createPostSamplingHookManager({
      enableLogging: false,
    });
    this.analyticsService = analyticsService;
    const analyticsQueue = getGlobalAnalyticsQueue();
    this.costTracker = createCostAnalyticsTracker(analyticsQueue);
    setCostAnalyticsTracker(this.costTracker);
    this.config = config;
    const defaultBudget = getDefaultTokenBudget('default');
    this.tokenBudgetManager = new TokenBudgetController(
      'default',
      {
        total: config.taskBudget?.total || defaultBudget.total,
        remaining: config.taskBudget?.total || defaultBudget.remaining,
      },
      config.taskBudget?.total || defaultBudget.total
    );
    this.unifiedTracker = new UnifiedTokenTracker(
      this.tokenBudgetManager,
      new ContextTracker()
    );
    this.stopHookManager = createStopHookManager();
  }

  /**
   * 注册采样后置Hook
   * @param name Hook名称
   * @param hook Hook函数
   * @param options Hook选项
   */
  registerPostSamplingHook(
    name: string,
    hook: PostSamplingHook,
    options?: {
      enabled?: boolean;
      priority?: number;
      timeout?: number;
    }
  ): void {
    this.postSamplingHookManager.registerHook(name, hook, options);
  }

  /**
   * 注销采样后置Hook
   * @param name Hook名称
   * @returns 是否成功
   */
  unregisterPostSamplingHook(name: string): boolean {
    return this.postSamplingHookManager.unregisterHook(name);
  }

  /**
   * 获取采样后置Hook管理器
   * @returns Hook管理器
   */
  getPostSamplingHookManager(): PostSamplingHookManager {
    return this.postSamplingHookManager;
  }

  /**
   * 注册停止钩子
   * @param hook 停止钩子
   */
  registerStopHook(hook: StopHook): void {
    this.stopHookManager.registerHook(hook);
  }

  /**
   * 注销停止钩子
   * @param name 钩子名称
   * @returns 是否成功
   */
  unregisterStopHook(name: string): boolean {
    return this.stopHookManager.unregisterHook(name);
  }

  /**
   * 获取停止钩子管理器
   * @returns 停止钩子管理器
   */
  getStopHookManager(): StopHookManager {
    return this.stopHookManager;
  }

  /**
   * 执行停止钩子
   * @param reason 停止原因
   * @param error 错误对象（可选）
   */
  private async executeStopHooks(
    reason: StopHookReason,
    error?: Error
  ): Promise<void> {
    if (!this.sessionState) return;

    const context: StopHookContext = {
      sessionId: this.sessionState.sessionId,
      reason,
      turnCount: this.sessionState.turnCount,
      durationMs: Date.now() - this.sessionState.startTime,
      error,
      usage: this.sessionState.totalUsage,
    };

    await this.stopHookManager.executeHooks(context);
  }

  /**
   * 提交消息入口
   * @param prompt 提示内容
   * @param options 选项
   * @returns 异步生成器，产生SDK消息
   */
  async *submitMessage(
    prompt: string,
    options?: {
      sessionId?: string;
      isMeta?: boolean;
    }
  ): AsyncGenerator<SDKMessage, void, unknown> {
    const sessionId = options?.sessionId || this.createSession();

    // 清理和预处理用户输入
    const cleanPrompt = sanitizeUserInput(prompt);
    const inputInfo = processInput(cleanPrompt);

    // 如果是元指令，标记为meta消息
    const isMeta = options?.isMeta || inputInfo.isMeta;

    // 创建用户消息
    yield {
      type: 'text',
      content: cleanPrompt,
      session_id: sessionId,
    };

    try {
      // 处理用户输入
      const processed = await this.processUserInput(cleanPrompt, sessionId);

      // 如果是空输入或元指令，跳过查询
      if (!processed && isMeta) {
        this.updateSessionState({ queryState: QueryState.COMPLETED });
        return;
      }

      // 注入相关记忆（如果已配置记忆集成）
      let finalPrompt = processed || cleanPrompt;
      if (this.memoryIntegration) {
        finalPrompt =
          await this.memoryIntegration.injectMemoriesToContext(finalPrompt);
      }

      // 执行查询
      const queryResults = this.query({
        prompt: finalPrompt,
        sessionId,
        options: {
          enableTools: true,
          enableStream: true,
          maxIterations: this.config.maxTurns || 10,
          maxBudgetUsd: this.config.maxBudgetUsd,
        },
      });

      // 产生查询结果
      for await (const result of queryResults) {
        if (result.message) {
          yield {
            type: 'text',
            content:
              typeof result.message.content === 'string'
                ? result.message.content
                : '',
            session_id: sessionId,
          };
        }

        if (result.toolCalls) {
          for (const toolCall of result.toolCalls) {
            yield {
              type: 'tool_use',
              toolUse: {
                id: toolCall.id,
                name: toolCall.name,
                input: toolCall.arguments,
              },
            };
          }
        }

        if (result.toolResults) {
          for (const toolResult of result.toolResults) {
            yield {
              type: 'tool_result',
              toolResult: {
                toolUseId: toolResult.toolCallId,
                content:
                  typeof toolResult.result === 'string'
                    ? toolResult.result
                    : '',
                isError: toolResult.error !== undefined,
              },
            };
          }
        }

        if (result.done) {
          break;
        }
      }

      // 触发查询结束进度事件
      this.emitProgress('query_end', { sessionId });
      this.updateSessionState({ queryState: QueryState.COMPLETED });
    } catch (error) {
      const queryError: QueryError = {
        type: QueryErrorType.UNKNOWN,
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
        timestamp: Date.now(),
      };
      this.emitError(queryError);
      this.updateSessionState({ queryState: QueryState.ERROR });

      // 执行停止钩子
      await this.executeStopHooks(
        'error',
        error instanceof Error ? error : undefined
      );

      yield {
        type: 'error',
        error: queryError.message,
        session_id: sessionId,
      };
    }
  }

  /**
   * 查询入口
   * @param params 查询参数
   * @returns 异步生成器，产生查询结果
   */
  async *query(
    params: QueryParams
  ): AsyncGenerator<QueryResult, void, unknown> {
    let { prompt, sessionId, options } = params;
    const maxIterations = options?.maxIterations || 10;
    let iteration = 0;
    const startTime = Date.now();

    // 记录查询开始事件
    this.analyticsService.logEvent('query_start', {
      prompt_length: prompt.length,
      session_id: sessionId,
      timestamp: startTime,
    });

    // 触发查询开始进度事件
    this.emitProgress('query_start', {
      prompt: prompt.substring(0, 100),
      sessionId,
    });
    this.updateSessionState({ queryState: QueryState.RUNNING });

    // 检查是否需要压缩
    await this.compactIfNeeded(sessionId || '');

    // 主循环
    let isFirstCall = true;
    while (iteration < maxIterations) {
      iteration++;

      // 更新会话状态中的turnCount
      if (this.sessionState) {
        this.updateSessionState({ turnCount: iteration });
      }

      // 检查预算和Turn限制
      if (!this.checkBudget() || !this.checkMaxTurns()) {
        break;
      }

      // 触发API开始进度事件
      this.emitProgress('api_start', { iteration, session_id: sessionId });

      // 调用API获取响应（非首次调用会加"继续执行"前缀）
      const response = await this.callAPI(prompt, sessionId || '', isFirstCall);
      isFirstCall = false;

      // 记录 Token 使用并更新预算（通过统一追踪器）
      if (response.usage) {
        this.unifiedTracker.recordPostRequest({ usage: response.usage });

        const budgetState = this.tokenBudgetManager.getCurrentBudgetState();
        if (
          budgetState.status === TokenBudgetStatus.CRITICAL ||
          budgetState.status === TokenBudgetStatus.EXCEEDED
        ) {
          this.analyticsService.logEvent('token_budget_threshold', {
            session_id: sessionId,
            status: budgetState.status,
            percent_used: budgetState.percentUsed,
            current_tokens: budgetState.currentTokens,
            max_tokens: budgetState.maxTokens,
            timestamp: Date.now(),
          });
        }
      }

      // 触发API结束进度事件
      this.emitProgress('api_end', { iteration, session_id: sessionId });

      // 执行采样后置Hook
      await this.executePostSamplingHooks(response.message, sessionId || '');

      // 更新会话使用量
      if (this.sessionState) {
        this.updateSessionState({
          totalUsage: {
            inputTokens:
              this.sessionState.totalUsage.inputTokens +
              (response.usage?.inputTokens || 0),
            outputTokens:
              this.sessionState.totalUsage.outputTokens +
              (response.usage?.outputTokens || 0),
            totalTokens:
              this.sessionState.totalUsage.totalTokens +
              (response.usage?.totalTokens || 0),
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
          },
          totalCostUSD: 0,
        });
      }

      // 产生结果
      yield {
        message: response.message,
        toolCalls: response.toolCalls,
        toolResults: response.toolResults,
        done: !response.toolCalls || response.toolCalls.length === 0,
        usage: response.usage,
      };

      // 如果没有工具调用，退出循环
      if (!response.toolCalls || response.toolCalls.length === 0) {
        break;
      }

      // 更新会话状态为等待工具
      this.updateSessionState({ queryState: QueryState.WAITING_FOR_TOOL });

      // 执行工具调用
      const toolResults = await this.executeToolCalls(
        response.toolCalls,
        sessionId || ''
      );

      // 产生工具结果
      yield {
        message: response.message,
        toolCalls: response.toolCalls,
        toolResults: toolResults,
        done: false,
        usage: response.usage,
      };

      // 更新提示词
      prompt = this.buildPromptWithToolResults(
        typeof response.message.content === 'string'
          ? response.message.content
          : '',
        toolResults
      );

      // 检查是否需要压缩
      await this.compactIfNeeded(sessionId || '');
    }

    // 触发查询结束进度事件
    this.emitProgress('query_end', { sessionId });
    this.updateSessionState({ queryState: QueryState.COMPLETED });

    // 执行停止钩子
    await this.executeStopHooks('completed');

    // 记录查询完成事件
    const duration = Date.now() - startTime;
    this.analyticsService.logEvent('query_complete', {
      session_id: sessionId,
      duration: duration,
      iterations: iteration,
      timestamp: Date.now(),
    });
  }

  /**
   * 处理用户输入
   * @param input 用户输入
   * @param sessionId 会话ID
   * @returns 处理后的输入
   */
  private async processUserInput(
    input: string,
    sessionId: string
  ): Promise<string> {
    const inputInfo = processInput(input);

    // 检查是否是命令
    if (inputInfo.isCommand) {
      this.analyticsService.logEvent('command_detected', {
        session_id: sessionId,
        command: inputInfo.commandName,
        args: inputInfo.commandArgs,
        timestamp: Date.now(),
      });
      return '';
    }

    return input;
  }

  /**
   * 调用API
   * @param prompt 提示词
   * @param sessionId 会话ID
   * @param isFirstCall 是否为首次调用（非首次会在 prompt 前加"继续执行"前缀）
   * @returns 响应
   */
  private async callAPI(
    prompt: string,
    sessionId: string,
    isFirstCall: boolean = true
  ): Promise<{
    message: Message;
    toolCalls?: ToolCall[];
    toolResults?: ToolResult[];
    usage?: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    };
  }> {
    const apiStartTime = Date.now();

    // 非首次调用时添加继续执行前缀，避免模型误解为"重新开始"
    const messageContent = isFirstCall ? prompt : `[继续执行] ${prompt}`;

    // 使用重试机制包装API调用
    const apiCall = async (): Promise<{
      message: Message;
      toolCalls?: ToolCall[];
      toolResults?: ToolResult[];
      usage?: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
      };
    }> => {
      // 使用ChatManager发送消息，实现完整的聊天循环
      // 查询引擎为系统内部 LLM 调用：标记 _fromInternal，不计入 Buddy 用户对话轮数
      const message = await this.chatManager.sendMessage(messageContent, {
        sessionId,
        _fromInternal: true,
        _fromInternalSource: 'queryEngine',
      });

      // 从消息中提取工具调用（如果有）
      const toolCalls: ToolCall[] = [];
      const msg = message as { tool_calls?: Array<Record<string, unknown>> };
      if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          toolCalls.push({
            id: tc.id as string,
            name:
              ((tc.function as Record<string, unknown>)?.name as string) ||
              (tc.name as string) ||
              'unknown',
            arguments: ((tc.function as Record<string, unknown>)?.arguments ||
              tc.arguments ||
              {}) as Record<string, unknown>,
          });
        }
      }

      // 计算token使用量（简化计算）
      const contentLength =
        typeof message.content === 'string'
          ? message.content.length
          : JSON.stringify(message.content).length;
      const usage = {
        inputTokens: prompt.length,
        outputTokens: contentLength,
        totalTokens: prompt.length + contentLength,
      };

      return { message, toolCalls, usage };
    };

    try {
      const result = await withRetry(
        apiCall,
        DEFAULT_RETRY_CONFIG,
        (error, attempt, delayMs) => {
          this.analyticsService.logEvent('api_retry', {
            session_id: sessionId,
            attempt,
            delay_ms: delayMs,
            error: error instanceof Error ? error.message : String(error),
            timestamp: Date.now(),
          });
        }
      );

      // 记录API调用事件
      const apiDuration = Date.now() - apiStartTime;
      this.analyticsService.logEvent('api_call', {
        session_id: sessionId,
        model: 'default',
        duration: apiDuration,
        timestamp: Date.now(),
      });

      // 跟踪模型使用成本
      this.costTracker.trackModelUsage('default', {
        inputTokens: result.usage?.inputTokens || 0,
        outputTokens: result.usage?.outputTokens || 0,
        totalTokens: result.usage?.totalTokens || 0,
      });

      // 持久化 API 调用日志
      this.logApiCall(sessionId, result.usage ?? null, apiDuration, true);

      return result;
    } catch (error) {
      const classification = categorizeAPIError(error);
      this.analyticsService.logEvent('api_error', {
        session_id: sessionId,
        error_type: classification.type,
        retryable: classification.retryable,
        error: error instanceof Error ? error.message : String(error),
        api_duration_ms: Date.now() - apiStartTime,
        timestamp: Date.now(),
      });

      // 持久化 API 调用失败日志
      this.logApiCall(
        sessionId,
        null,
        Date.now() - apiStartTime,
        false,
        error instanceof Error ? error.message : String(error)
      );

      // 更新会话错误计数
      if (this.sessionState) {
        this.updateSessionState({
          errorCount: this.sessionState.errorCount + 1,
          queryState: QueryState.ERROR,
        });
      }

      throw error;
    }
  }

  /**
   * 记录 API 调用日志
   */
  private logApiCall(
    sessionId: string,
    usage: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    } | null,
    durationMs: number,
    success: boolean,
    error?: string
  ): void {
    this.queryLogStore
      ?.log({
        sessionId,
        type: 'api_call',
        model: 'default',
        promptTokens: usage?.inputTokens || 0,
        outputTokens: usage?.outputTokens || 0,
        totalTokens: usage?.totalTokens || 0,
        durationMs,
        success,
        error,
        timestamp: Date.now(),
      })
      .catch((err) => {
        handleError(err, { module: 'query:engine', action: '持久化 API 日志' });
      });
  }

  /**
   * 记录工具调用日志
   */
  private logToolCall(
    sessionId: string,
    toolName: string,
    inputTokens: number,
    outputTokens: number,
    durationMs: number,
    success: boolean,
    error?: string
  ): void {
    this.queryLogStore
      ?.log({
        sessionId,
        type: 'tool_call',
        toolName,
        promptTokens: inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        durationMs,
        success,
        error,
        timestamp: Date.now(),
      })
      .catch((err) => {
        handleError(err, {
          module: 'query:engine',
          action: '持久化工具调用日志',
        });
      });
  }

  /**
   * 执行工具调用
   * @param toolCalls 工具调用列表
   * @param sessionId 会话ID
   * @returns 工具结果列表
   */
  private async executeToolCalls(
    toolCalls: ToolCall[],
    sessionId: string
  ): Promise<ToolResult[]> {
    if (toolCalls.length === 0) return [];

    // 将 ToolCall[] 转换为 ToolUseBlock[] 供分区器使用
    const toolUseBlocks: ToolUseBlock[] = toolCalls.map((tc) => ({
      type: 'tool_use',
      id: tc.id,
      name: tc.name,
      input: tc.arguments as Record<string, unknown>,
    }));

    // 使用分区器将工具调用分为并发安全组和串行执行组
    const partitioner = new ToolCallPartitioner();
    const partitions = partitioner.partition(toolUseBlocks);

    // 执行单个工具调用并返回 ToolResult
    const executeSingleTool = async (
      block: ToolUseBlock
    ): Promise<ToolResult> => {
      const toolStartTime = Date.now();
      const toolCall = toolCalls.find((tc) => tc.id === block.id)!;

      this.emitProgress('tool_start', {
        tool_name: block.name,
        session_id: sessionId,
      });

      this.analyticsService.logEvent('tool_execute', {
        session_id: sessionId,
        tool_name: block.name,
        timestamp: toolStartTime,
      });

      try {
        // 熔断检查：同一工具+参数连续失败超过阈值时跳过执行
        const circuit = this.toolCallTracker.shouldCircuitBreak(
          block.name,
          block.input
        );
        if (circuit.break) {
          const breakResult: ToolResult = {
            toolCallId: block.id,
            toolName: block.name,
            result: `[熔断] ${circuit.reason}`,
          };
          this.emitProgress('tool_end', {
            tool_name: block.name,
            session_id: sessionId,
          });
          return breakResult;
        }

        const result = await this.chatManager.executeTool(toolCall);

        if (this.sessionState) {
          this.updateSessionState({
            toolCallCount: this.sessionState.toolCallCount + 1,
          });
        }

        const toolDuration = Date.now() - toolStartTime;
        this.analyticsService.logEvent('tool_result', {
          session_id: sessionId,
          tool_name: block.name,
          success: true,
          duration: toolDuration,
          timestamp: Date.now(),
        });

        this.emitProgress('tool_end', {
          tool_name: block.name,
          session_id: sessionId,
        });

        this.logToolCall(sessionId, block.name, 0, 0, toolDuration, true);

        // 记录成功调用到跟踪器
        this.toolCallTracker.record(block.name, block.input, true);

        return result;
      } catch (error) {
        const errorResult: ToolResult = {
          toolCallId: block.id,
          toolName: block.name,
          result: '',
          error: error instanceof Error ? error.message : String(error),
        };

        const queryError: QueryError = {
          type: QueryErrorType.TOOL_ERROR,
          message: error instanceof Error ? error.message : String(error),
          retryable: true,
          timestamp: Date.now(),
          details: { toolName: block.name },
        };
        this.emitError(queryError);

        const toolDuration = Date.now() - toolStartTime;
        this.analyticsService.logEvent('tool_result', {
          session_id: sessionId,
          tool_name: block.name,
          success: false,
          error: queryError.message,
          duration: toolDuration,
          timestamp: Date.now(),
        });

        this.emitProgress('tool_end', {
          tool_name: block.name,
          session_id: sessionId,
        });

        this.logToolCall(
          sessionId,
          block.name,
          0,
          0,
          toolDuration,
          false,
          queryError.message
        );

        // 记录失败调用到跟踪器
        this.toolCallTracker.record(
          block.name,
          block.input,
          false,
          queryError.message
        );

        return errorResult;
      }
    };

    const results: ToolResult[] = [];

    // 按分区顺序执行：每个分区内并发安全组并行执行，串行组顺序执行
    for (const partition of partitions) {
      if (partition.isConcurrencySafe) {
        const concurrentResults = await Promise.all(
          partition.blocks.map((block) => executeSingleTool(block))
        );
        results.push(...concurrentResults);
      } else {
        for (const block of partition.blocks) {
          const result = await executeSingleTool(block);
          results.push(result);
        }
      }
    }

    return results;
  }

  /**
   * 构建包含工具结果的提示词
   * @param originalContent 原始内容
   * @param toolResults 工具结果
   * @returns 新的提示词
   */
  private buildPromptWithToolResults(
    originalContent: string,
    toolResults: ToolResult[]
  ): string {
    let prompt = originalContent;

    for (const toolResult of toolResults) {
      if (toolResult.error) {
        prompt += `\n[Error: ${toolResult.error}]`;
      } else {
        prompt += `\n[Tool result: ${JSON.stringify(toolResult.result)}]`;
      }
    }

    return prompt;
  }

  /**
   * 执行采样后置Hook
   * @param message 响应消息
   * @param sessionId 会话ID
   */
  private async executePostSamplingHooks(
    message: Message,
    sessionId: string
  ): Promise<void> {
    const hookContext: PostSamplingHookContext = {
      messages: [message],
      systemPrompt: { content: '' },
      userContext: {},
      systemContext: {},
      toolUseContext: {
        toolName: '',
        toolInput: {},
        sessionId: sessionId,
        type: 'tool',
        createdAt: new Date(),
      } as unknown as ToolUseContext,
    };

    await this.postSamplingHookManager.executeHooks(hookContext);
  }

  // ─────────────────────────────────────────────────────────
  // BUG-A fix: 压缩统一入口 — 委托给 CompactionOrchestrator
  // 消除双管线冲突（旧管线已移除）
  // ─────────────────────────────────────────────────────────

  /**
   * 检查并执行上下文压缩（公开接口）
   * 供外部组件（如 TAORLoop）在 TokenBudget WARNING 时调用
   */
  async compactIfNeeded(sessionId: string): Promise<void> {
    if (!sessionId) return;

    const sessions = this.chatManager.getSessions();
    const session = sessions.find((s) => s.id === sessionId);
    if (!session || !session.messages?.length) return;

    const messages = session.messages as unknown as ChatMessage[];
    // C4 修复（压缩链路排查 2026-08-13）：传真实模型名而非硬编码 'default'——
    // 原实现 resolveContextWindow('default') 落到默认窗口 200K，真实模型（如
    // deepseek-v4-flash 128K）时压缩触发过晚 → TAORLoop WARNING 路径压缩失效。
    const result = await compactionOrchestrator.compact(messages, {
      model: session.metadata?.model || 'default',
      sessionId,
    } as CompactionContext);

    if (result.applied) {
      session.messages = result.messages as unknown as typeof session.messages;
      this.chatManager
        .saveSession(session)
        .catch((err) =>
          handleError(err, { module: 'query:engine', action: '压缩持久化' })
        );
    }
  }

  /**
   * 记忆集成实例注入
   */
  setMemoryIntegration(integration: MemoryIntegration): void {
    this.memoryIntegration = integration;
  }

  /**
   * 获取记忆集成实例
   * @returns 记忆集成实例或 null
   */
  getMemoryIntegration(): MemoryIntegration | null {
    return this.memoryIntegration;
  }

  /**
   * 获取分析服务
   * @returns 分析服务实例
   */
  getAnalyticsService(): AnalyticsService {
    return this.analyticsService;
  }

  /**
   * 获取成本追踪器
   * @returns 成本追踪器实例
   */
  getCostTracker(): CostAnalyticsTracker {
    return this.costTracker;
  }

  /**
   * 创建新会话
   * @param sessionId 会话ID
   * @returns 会话ID
   */
  createSession(sessionId?: string): string {
    const id = sessionId || `session-${Date.now()}`;
    this.sessionState = {
      sessionId: id,
      queryState: QueryState.IDLE,
      turnCount: 0,
      startTime: Date.now(),
      lastActivityTime: Date.now(),
      totalUsage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
      totalCostUSD: 0,
      errorCount: 0,
      toolCallCount: 0,
    };
    return id;
  }

  /**
   * 设置查询日志存储
   * @param store 日志存储实例
   */
  setQueryLogStore(store: QueryLogStore): void {
    this.queryLogStore = store;
  }

  /**
   * 获取当前会话状态
   * @returns 会话状态
   */
  getSessionState(): SessionState | null {
    return this.sessionState;
  }

  /**
   * 获取当前查询状态
   * @returns 查询状态
   */
  getQueryState(): QueryState {
    return this.sessionState?.queryState || QueryState.IDLE;
  }

  /**
   * 获取总使用量
   * @returns 使用量统计
   */
  getTotalUsage() {
    return (
      this.sessionState?.totalUsage || {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      }
    );
  }

  /**
   * 获取总成本
   * @returns 总成本
   */
  getTotalCost(): number {
    return this.sessionState?.totalCostUSD || 0;
  }

  /**
   * 获取Turn数
   * @returns Turn数
   */
  getTurnCount(): number {
    return this.sessionState?.turnCount || 0;
  }

  /**
   * 添加进度监听器
   * @param listener 监听器函数
   */
  addProgressListener(listener: (event: ProgressEvent) => void): void {
    this.progressListeners.push(listener);
  }

  /**
   * 移除进度监听器
   * @param listener 监听器函数
   */
  removeProgressListener(listener: (event: ProgressEvent) => void): void {
    this.progressListeners = this.progressListeners.filter(
      (l) => l !== listener
    );
  }

  /**
   * 添加错误处理器
   * @param handler 错误处理函数
   */
  addErrorHandler(handler: (error: QueryError) => void): void {
    this.errorHandlers.push(handler);
  }

  /**
   * 移除错误处理器
   * @param handler 错误处理函数
   */
  removeErrorHandler(handler: (error: QueryError) => void): void {
    this.errorHandlers = this.errorHandlers.filter((h) => h !== handler);
  }

  /**
   * 触发进度事件
   * @param type 事件类型
   * @param data 事件数据
   */
  private emitProgress(
    type: ProgressEvent['type'],
    data?: Record<string, unknown>
  ): void {
    const event: ProgressEvent = {
      type,
      timestamp: Date.now(),
      data,
    };
    for (const listener of this.progressListeners) {
      try {
        listener(event);
      } catch (e) {
        handleError(e, {
          module: 'query:engine',
          action: 'Progress监听器回调',
        });
      }
    }
  }

  /**
   * 触发错误处理
   * @param error 错误对象
   */
  private emitError(error: QueryError): void {
    if (this.sessionState) {
      this.sessionState.errorCount++;
    }
    for (const handler of this.errorHandlers) {
      try {
        handler(error);
      } catch (e) {
        handleError(e, { module: 'query:engine', action: 'Error处理器回调' });
      }
    }
  }

  /**
   * 更新会话状态
   * @param updates 更新内容
   */
  private updateSessionState(updates: Partial<SessionState>): void {
    if (this.sessionState) {
      this.sessionState = {
        ...this.sessionState,
        ...updates,
        lastActivityTime: Date.now(),
      };
    }
  }

  /**
   * 检查预算限制
   * @returns 是否在预算范围内
   */
  private checkBudget(): boolean {
    if (this.config.maxBudgetUsd !== undefined) {
      const currentCost = this.getTotalCost();
      if (currentCost >= this.config.maxBudgetUsd) {
        const error: QueryError = {
          type: QueryErrorType.BUDGET_EXCEEDED,
          message: `Budget exceeded: ${currentCost} USD >= ${this.config.maxBudgetUsd} USD`,
          retryable: false,
          timestamp: Date.now(),
        };
        this.emitError(error);
        return false;
      }
    }

    const budgetState = this.tokenBudgetManager.getCurrentBudgetState();
    if (budgetState.status === TokenBudgetStatus.EXCEEDED) {
      const error: QueryError = {
        type: QueryErrorType.BUDGET_EXCEEDED,
        message: budgetState.warningMessage || 'Token budget exhausted',
        retryable: false,
        timestamp: Date.now(),
        details: {
          currentTokens: budgetState.currentTokens,
          maxTokens: budgetState.maxTokens,
        },
      };
      this.emitError(error);
      return false;
    }

    if (budgetState.shouldCompact) {
      this.analyticsService.logEvent('auto_compact_triggered', {
        status: budgetState.status,
        percent_used: budgetState.percentUsed,
        timestamp: Date.now(),
      });
    }

    return true;
  }

  /**
   * 检查Turn限制
   * @returns 是否在Turn限制范围内
   */
  private checkMaxTurns(): boolean {
    if (this.config.maxTurns !== undefined) {
      const currentTurns = this.getTurnCount();
      if (currentTurns >= this.config.maxTurns) {
        const error: QueryError = {
          type: QueryErrorType.MAX_TURNS_EXCEEDED,
          message: `Max turns exceeded: ${currentTurns} >= ${this.config.maxTurns}`,
          retryable: false,
          timestamp: Date.now(),
        };
        this.emitError(error);
        return false;
      }
    }
    return true;
  }

  /**
   * 中止当前查询
   */
  async abort(): Promise<void> {
    if (this.abortController) {
      this.abortController.abort();
    }
    this.updateSessionState({ queryState: QueryState.ABORTED });

    // 执行停止钩子
    await this.executeStopHooks('aborted');
  }

  getTokenBudgetManager(): TokenBudgetController {
    return this.tokenBudgetManager;
  }

  getUnifiedTracker(): UnifiedTokenTracker {
    return this.unifiedTracker;
  }

  /**
   * 重置会话
   */
  resetSession(): void {
    this.sessionState = null;
    this.abortController = null;
  }
}

/**
 * 创建QueryEngine实例
 * @param chatManager 聊天管理器
 * @param config 查询引擎配置
 * @returns QueryEngine实例
 */
export function createQueryEngine(
  chatManager: IChatManagerForQuery,
  config?: QueryEngineConfig
): QueryEngine {
  const engine = new QueryEngine(chatManager, config);

  // 接线查询日志持久化：工具调用/API 调用统计落库（query_logs 表），
  // 供仪表盘工具统计在重启后仍保留。此前 setQueryLogStore 无调用方 → 统计从未落库。
  try {
    engine.setQueryLogStore(getQueryLogStore());
  } catch (err) {
    // KB-QENGINE-WIRE（2026-08-29）：查询日志接线失败 → 工具统计不落库且无线索
    logger.warn('查询日志存储接线失败（统计将不落库）', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 注册 AI 调用聚合日志 Hook（在每次 AI 调用后输出汇总日志）
  try {
    engine.registerPostSamplingHook(
      'PostCallSummary',
      createPostCallSummaryHook(),
      { priority: 100 }
    );
  } catch (err) {
    // KB-QENGINE-HOOK（2026-08-29）：Hook 注册失败 → 调用汇总日志缺失且无线索
    logger.warn('PostCallSummary Hook 注册失败', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return engine;
}

export default {
  QueryEngine,
  createQueryEngine,
};
