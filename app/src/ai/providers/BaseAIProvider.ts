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
 * BaseAIProvider — AI Provider 抽象基类
 *
 * 所有 Provider 必须继承此类，统一管理：
 * - 模型解析（通过 ModelRouter）
 * - API Key / Base URL 解析（DB → env 两层回退）
 * - Transport 适配器
 * - SSE 流式解析（三种格式：openai / anthropic / google）
 * - 重试机制（withRetry + 指数退避）
 * - 工具注册 & 执行器
 * - HTTP 错误处理
 */

import type {
  ChatMessage,
  ChatResponse,
  ToolDefinition,
} from '../models/types';
import type {
  AIProvider,
  ChatOptions,
  ProviderConfig,
  ProviderValidationResult,
  ThinkingProviderChunk,
} from './AIProvider';
import type { IToolExecutor, ToolRegistry } from '../interfaces/ToolExecutor';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { modelRouter, type TaskType } from '../modelRouter';
import { ModelRegistry } from '../models/ModelRegistry';
import type { APIProvider } from '../models/ModelConfigs';
import { TransportProviderAdapter } from '../transports/TransportProviderAdapter';
import type { TransportStreamEvent } from '../transports/types';
import { configManager } from '@modules/config';
import { repairModelJson } from '@modules/utils/json';

const logger = new Logger({ level: LogLevel.INFO });

// ============================================================
// SSE 格式枚举
// ============================================================

/** SSE 流式响应格式类型 */
export enum SSEFormat {
  OPENAI = 'openai',
  ANTHROPIC = 'anthropic',
  GOOGLE = 'google',
}

// ============================================================
// BaseProviderOptions
// ============================================================

/** Provider 构造选项（替代旧的 ProviderConfig 首参） */
export interface BaseProviderOptions {
  /** Provider 唯一标识 */
  providerId: string;
  /** 显示名称 */
  displayName: string;
  /** 默认 Base URL */
  defaultBaseUrl?: string;
  /** 环境变量 API Key 名称（如 'DEEPSEEK_API_KEY'） */
  envApiKey?: string;
  /** Transport 适配器 */
  transport?: TransportProviderAdapter;
  /** 默认解析的 TaskType */
  defaultTaskType?: TaskType;
  /** 默认模型 ID（resolveModel 回退链最高优先级） */
  defaultModel?: string;
}

// ============================================================
// PendingToolCall（流式 tool_calls 分片累积）
// ============================================================

/** 流式 tool_calls 分片累积中间状态 */
export interface PendingToolCall {
  id: string;
  name: string;
  arguments: string;
}

// ============================================================
// 重试配置
// ============================================================

/** 指数退避重试配置 */
export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
};

// ============================================================
// BaseAIProvider（抽象类）
// ============================================================

/**
 * AI Provider 抽象基类
 *
 * 子类必须实现：
 * - chat()
 * - chatStream()
 * - listModels()
 *
 * 按需覆盖：
 * - supportsThinking()
 * - supportsStructuredOutputs()
 * - generateImage()
 * - analyzeImage()
 */
export abstract class BaseAIProvider implements AIProvider {
  readonly id: string;
  readonly displayName: string;

  /** 构造选项（只读，子类可通过 this.options 访问） */
  protected readonly options: BaseProviderOptions;

  /** Transport 适配器实例 */
  protected transport: TransportProviderAdapter | null;

  /** 工具注册表 */
  protected toolRegistry: ToolRegistry | null = null;

  /** 工具执行器 */
  protected toolExecutor: IToolExecutor | null = null;

  /** 连续 529 错误计数（用于指数退避） */
  protected consecutive529Errors: number = 0;

  /** 重试配置 */
  protected retryConfig: RetryConfig;

  // ============================================================
  // 构造函数
  // ============================================================

  /**
   * 初始化 Provider 实例。
   * 构造函数回退链：DB 持久化 > 环境变量（两层，无 config 层）。
   *
   * @param options - 基础选项（providerId, displayName, defaultBaseUrl, envApiKey 等）
   * @param _extraConfig - 子类特有扩展配置（可选）
   */
  constructor(
    options: BaseProviderOptions,
    _extraConfig?: Record<string, unknown>
  ) {
    this.id = options.providerId;
    this.displayName = options.displayName;
    this.options = options;
    this.transport = options.transport || null;
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG };
  }

  // ============================================================
  // 模型解析
  // ============================================================

  /**
   * 解析当前使用的模型名。
   *
   * 优先级：
   *   1. ChatOptions.model
   *   2. options.defaultModel（构造函数传入）
   *   3. ModelRouter.resolveMapped(taskType, providerId)
   *   4. ModelRouter.resolve('chat')
   *
   * 若全部为空，抛 AppError（拒绝静默空值）。
   *
   * @param taskType - 任务类型（可选，用于 ModelRouter 路由）
   * @param options - 本次调用的 ChatOptions
   * @returns 模型名（非空）
   */
  resolveModel(taskType?: TaskType, options?: ChatOptions): string {
    // 1. ChatOptions 中的 model 优先
    if (options?.model) return options.model;

    // 2. 构造函数默认模型
    if (this.options.defaultModel) return this.options.defaultModel;

    // 3. ModelRouter 带任务类型解析
    if (taskType) {
      const mapped = modelRouter.resolveMapped(taskType, this.id);
      if (mapped) return mapped;
    }

    // 4. 再试一次无 taskType 的 chat 任务
    const model = modelRouter.resolve('chat');
    if (model) return model;

    throw new AppError(
      `无法解析模型: Provider ${this.id} 未配置模型`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      '1001'
    );
  }

  // ============================================================
  // API Key 解析（DB → env 两层回退）
  // ============================================================

  /**
   * 解析 API Key。
   *
   * 回退链：DB 持久化（ModelRegistry） > 环境变量。
   *
   * @returns API Key 或 undefined
   */
  protected resolveApiKey(): string | undefined {
    // 1. 先从 DB（ModelRegistry）读取
    try {
      const registry = ModelRegistry.getInstance();
      const providerConfig = registry.getProviderConfig(this.id as APIProvider);
      if (providerConfig?.apiKey) return providerConfig.apiKey;
    } catch {
      // 忽略异常，回退到环境变量
    }

    // 2. 环境变量回退
    if (this.options.envApiKey) {
      const envKey = configManager.env(this.options.envApiKey);
      if (envKey) return envKey;
    }

    return undefined;
  }

  // ============================================================
  // Base URL 解析（DB → options 两层回退）
  // ============================================================

  /**
   * 解析 Base URL。
   *
   * 回退链：DB 持久化（ModelRegistry） > options.defaultBaseUrl。
   *
   * @returns Base URL 或 undefined
   */
  protected resolveBaseUrl(): string | undefined {
    try {
      const registry = ModelRegistry.getInstance();
      const providerConfig = registry.getProviderConfig(this.id as APIProvider);
      if (providerConfig?.baseUrl) return providerConfig.baseUrl;
    } catch {
      // 忽略异常
    }

    return this.options.defaultBaseUrl;
  }

  // ============================================================
  // 重试机制
  // ============================================================

  /**
   * 判断 HTTP 状态码是否需要退避重试。
   *
   * @param status - HTTP 状态码
   * @returns 是否应退避
   */
  shouldBackOff(status: number): boolean {
    return status === 529 || status === 429;
  }

  /**
   * 带指数退避的异步重试。
   *
   * 对 529/429 状态码自动退避重试，延迟时间随尝试次数和连续 529 计数增长。
   * 非退避错误直接抛出，不重试。
   *
   * @param fn - 需要重试的异步函数
   * @param config - 可选的重试配置覆盖
   * @returns 函数的返回值
   */
  async withRetry<T>(
    fn: () => Promise<T>,
    config?: Partial<RetryConfig>
  ): Promise<T> {
    const cfg = { ...this.retryConfig, ...config };
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error: unknown) {
        lastError = error as Error;

        if (attempt >= cfg.maxRetries) break;

        const err = error as Record<string, unknown>;
        const status = (err?.status || err?.statusCode || 0) as number;
        if (!this.shouldBackOff(status)) {
          // 非退避错误，直接抛出
          throw error;
        }

        if (status === 529) {
          this.consecutive529Errors++;
        }

        const delay = Math.min(
          cfg.baseDelayMs * Math.pow(2, attempt + this.consecutive529Errors),
          cfg.maxDelayMs
        );

        logger.warning(
          `重试 ${this.id} 请求 (attempt ${attempt + 1}/${cfg.maxRetries})`,
          { status, delayMs: delay }
        );

        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  /**
   * 带连接重试的 fetch 包装。
   *
   * 仅在网络连接阶段失败时重试（TypeError），不重试 HTTP 错误响应或超时。
   * 适用场景：Provider API 网关偶发断连、DNS 闪断、TCP 重置等瞬态网络故障。
   * 重试间隔采用线性退避（1s, 2s, 4s...）。
   *
   * @param url - 请求 URL
   * @param init - fetch Init 选项
   * @param maxRetries - 最大重试次数（默认 1，即最多请求 2 次）
   * @returns fetch Response
   */
  protected static async fetchWithConnectionRetry(
    url: string,
    init?: RequestInit,
    maxRetries: number = 1
  ): Promise<Response> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fetch(url, init);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // 仅重试网络连接错误（TypeError），不重试：
        // - HTTP 错误响应（response.ok === false 不会 throw，正常返回）
        // - AbortError（DOMException，用户主动取消或超时）
        if (error instanceof TypeError && attempt < maxRetries) {
          const delay = 1000 * Math.pow(2, attempt);

          logger.warning(`fetch 连接失败，第 ${attempt + 1} 次重试`, {
            url,
            delayMs: delay,
            error: lastError.message,
          });

          await new Promise<void>((resolve) => setTimeout(resolve, delay));
          continue;
        }

        // 非 TypeError 错误直接抛出（超时、取消等）
        throw error;
      }
    }

    throw lastError;
  }

  // ============================================================
  // 预连接
  // ============================================================

  /**
   * 预连接到 Provider 端点（发送 HEAD 请求预热连接池）。
   * 失败不抛出，仅静默忽略。
   */
  async preconnect(): Promise<void> {
    const baseUrl = this.resolveBaseUrl();
    if (!baseUrl) return;

    try {
      await fetch(baseUrl, {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // 预连接失败不抛出
    }
  }

  // ============================================================
  // 思考模式 / 结构化输出 / 压缩通知
  // ============================================================

  /**
   * 当前模型是否支持思考模式（子类按需覆盖）。
   *
   * @param _model - 模型名
   * @returns 默认 false
   */
  supportsThinking(_model: string): boolean {
    return false;
  }

  /**
   * 当前模型是否支持结构化输出（子类按需覆盖）。
   *
   * @param _model - 模型名
   * @returns 默认 false
   */
  supportsStructuredOutputs(_model: string): boolean {
    return false;
  }

  /**
   * 通知压缩事件（重置 529 错误计数）。
   * 当外部触发上下文压缩时，重置退避状态以避免过激退避。
   */
  notifyCompaction(): void {
    this.consecutive529Errors = 0;
  }

  // ============================================================
  // HTTP 错误处理
  // ============================================================

  /**
   * HTTP 响应错误统一处理。
   * 将 HTTP 状态码和状态文本包装为 AppError 抛出。
   *
   * @param response - HTTP Response 对象
   * @param context - 错误上下文描述（可选）
   */
  protected handleHttpError(response: Response, context?: string): never {
    const status = response.status;
    const statusText = response.statusText;
    const message = `${this.id} API error: ${status} - ${statusText}${
      context ? ` (${context})` : ''
    }`;

    throw new AppError(
      message,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      String(status)
    );
  }

  // ============================================================
  // SSE 流式读取（三种格式分发）
  // ============================================================

  /**
   * 读取 SSE 流，按格式分发到具体解析器。
   *
   * @param response - fetch Response 对象（需 response.body 可读）
   * @param format - SSE 格式枚举
   * @param onEvent - 事件回调（text / tool_call / thinking / usage / done / error）
   * @param pendingToolCalls - 可选的 tool_calls 累积容器（由调用方创建，流结束后读取）
   */
  protected async readSSEStream(
    response: Response,
    format: SSEFormat,
    onEvent: (event: TransportStreamEvent) => void,
    pendingToolCalls?: Map<number, PendingToolCall>
  ): Promise<void> {
    if (!response.body) {
      throw new AppError(
        `${this.id}: 响应体为空`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1002'
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;

          if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6);
            if (data === '[DONE]') return;

            try {
              const json = JSON.parse(data);

              switch (format) {
                case SSEFormat.OPENAI:
                  this.parseOpenaiSSELine(json, onEvent, pendingToolCalls);
                  break;
                case SSEFormat.ANTHROPIC:
                  this.parseAnthropicSSELine(json, onEvent, pendingToolCalls);
                  break;
                case SSEFormat.GOOGLE:
                  this.parseGoogleSSELine(json, onEvent);
                  break;
              }
            } catch {
              // JSON 解析失败，跳过该行
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // ============================================================
  // OpenAI 格式 SSE 解析（含流式 tool_calls 累积）
  // ============================================================

  /**
   * 解析 OpenAI 格式的 SSE 数据行。
   *
   * 处理特性：
   * - delta.content → text 事件
   * - delta.reasoning_content → thinking 事件
   * - delta.tool_calls → 按 index 合并分片 + arguments 字符串拼接
   * - usage → usage 事件
   * - finish_reason === 'tool_calls' → tool_call 事件 + done 事件
   * - 其他 finish_reason → done 事件
   *
   * @param json - 解析后的 SSE JSON 对象
   * @param onEvent - 事件回调
   * @param pendingToolCalls - tool_calls 累积容器（来自 DeepSeek 的流式 tool_calls 方案）
   */
  protected parseOpenaiSSELine(
    json: Record<string, unknown>,
    onEvent: (event: TransportStreamEvent) => void,
    pendingToolCalls?: Map<number, PendingToolCall>
  ): void {
    const choices = json.choices as Array<Record<string, unknown>> | undefined;
    if (!choices || !choices[0]) return;

    const delta = (choices[0].delta || {}) as Record<string, unknown>;
    const finishReason = choices[0].finish_reason as string | undefined;

    // 1. 文本内容
    if (delta.content) {
      onEvent({ type: 'text', content: delta.content as string });
    }

    // 2. 思考过程
    if (delta.reasoning_content) {
      onEvent({
        type: 'thinking',
        content: delta.reasoning_content as string,
      });
    }

    // 3. 工具调用分片累积（按 index 合并）
    const streamToolCalls = delta.tool_calls as
      | Array<Record<string, unknown>>
      | undefined;
    if (streamToolCalls && pendingToolCalls) {
      for (const tc of streamToolCalls) {
        const idx = tc.index as number;
        const func = tc.function as Record<string, unknown> | undefined;

        let pending = pendingToolCalls.get(idx);
        if (!pending) {
          pending = { id: '', name: '', arguments: '' };
          pendingToolCalls.set(idx, pending);
        }
        if (tc.id) pending.id = tc.id as string;
        if (func) {
          if (func.name) pending.name = func.name as string;
          if (func.arguments) pending.arguments += func.arguments as string;
        }
      }
    }

    // 4. 用量
    const usage = json.usage as Record<string, number> | undefined;
    if (usage) {
      const inputTokens = usage.prompt_tokens || 0;
      const outputTokens = usage.completion_tokens || 0;
      onEvent({
        type: 'usage',
        usage: {
          inputTokens,
          outputTokens,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          totalTokens: inputTokens + outputTokens,
        },
      });
    }

    // 5. 完成：tool_calls 触发 tool_call 事件
    if (
      finishReason === 'tool_calls' &&
      pendingToolCalls &&
      pendingToolCalls.size > 0
    ) {
      const sortedCalls = Array.from(pendingToolCalls.entries())
        .sort(([a], [b]) => a - b)
        .map(([_, tc]) => {
          try {
            // 修复可能的 Windows 路径反斜杠问题后解析
            const repaired = repairModelJson(tc.arguments);
            return {
              id: tc.id,
              name: tc.name,
              arguments: JSON.parse(repaired) as Record<string, unknown>,
            };
          } catch {
            return {
              id: tc.id,
              name: tc.name,
              arguments: { _raw: tc.arguments },
            };
          }
        });

      onEvent({
        type: 'tool_call',
        call: {
          id: sortedCalls[0]?.id || '',
          name: sortedCalls[0]?.name || '',
          arguments: JSON.stringify(sortedCalls[0]?.arguments || {}),
        },
      });

      pendingToolCalls.clear();
    }

    // 6. 最终完成
    if (finishReason && finishReason !== 'tool_calls') {
      const responseModel = json.model as string | undefined;
      const responseId = json.id as string | undefined;
      onEvent({
        type: 'done',
        response: {
          content: null,
          toolCalls: [],
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            totalTokens: 0,
          },
          reasoning: null,
          finishReason,
          model: responseModel || '',
          id: responseId || '',
        },
      });
    }
  }

  // ============================================================
  // Anthropic 格式 SSE 解析
  // ============================================================

  /**
   * 解析 Anthropic Messages API 格式的 SSE 数据行。
   *
   * 处理事件类型：
   * - content_block_delta（text_delta / thinking_delta）
   * - content_block_start（tool_use）
   * - content_block_delta.tool_use（partial_json 累积）
   * - message_delta（stop_reason + usage）
   * - message_stop（done 事件）
   *
   * @param json - 解析后的 SSE JSON 对象
   * @param onEvent - 事件回调
   * @param pendingToolCalls - tool_calls 累积容器
   */
  protected parseAnthropicSSELine(
    json: Record<string, unknown>,
    onEvent: (event: TransportStreamEvent) => void,
    pendingToolCalls?: Map<number, PendingToolCall>
  ): void {
    const type = json.type as string | undefined;

    switch (type) {
      case 'content_block_delta': {
        const delta = (json.delta || {}) as Record<string, unknown>;
        const deltaType = delta.type as string | undefined;

        if (deltaType === 'text_delta' && delta.text) {
          onEvent({ type: 'text', content: delta.text as string });
        }
        if (deltaType === 'thinking_delta' && delta.thinking) {
          onEvent({
            type: 'thinking',
            content: delta.thinking as string,
          });
        }
        break;
      }

      case 'content_block_start': {
        const contentBlock = (json.content_block || {}) as Record<
          string,
          unknown
        >;
        if (contentBlock.type === 'tool_use' && pendingToolCalls) {
          const idx = (json.index as number) || 0;
          pendingToolCalls.set(idx, {
            id: (contentBlock.id as string) || '',
            name: (contentBlock.name as string) || '',
            arguments: '',
          });
        }
        break;
      }

      case 'content_block_delta': {
        // Anthropic 的 tool_use delta 子类型
        const delta = (json.delta || {}) as Record<string, unknown>;
        if (
          (delta.type as string) === 'input_json_delta' &&
          delta.partial_json &&
          pendingToolCalls
        ) {
          const idx = (json.index as number) || 0;
          const pending = pendingToolCalls.get(idx);
          if (pending) {
            pending.arguments += delta.partial_json as string;
          }
        }
        break;
      }

      case 'message_delta': {
        const delta = (json.delta || {}) as Record<string, unknown>;
        const stopReason = delta.stop_reason as string | undefined;

        // tool_use 停止 → 组装 tool_calls
        if (
          stopReason === 'tool_use' &&
          pendingToolCalls &&
          pendingToolCalls.size > 0
        ) {
          const sortedCalls = Array.from(pendingToolCalls.entries())
            .sort(([a], [b]) => a - b)
            .map(([_, tc]) => {
              try {
                return {
                  id: tc.id,
                  name: tc.name,
                  arguments: JSON.parse(tc.arguments) as Record<
                    string,
                    unknown
                  >,
                };
              } catch {
                return {
                  id: tc.id,
                  name: tc.name,
                  arguments: { _raw: tc.arguments },
                };
              }
            });

          onEvent({
            type: 'tool_call',
            call: {
              id: sortedCalls[0]?.id || '',
              name: sortedCalls[0]?.name || '',
              arguments: JSON.stringify(sortedCalls[0]?.arguments || {}),
            },
          });

          pendingToolCalls.clear();
        }

        // 用量
        const usage = json.usage as Record<string, number> | undefined;
        if (usage) {
          onEvent({
            type: 'usage',
            usage: {
              inputTokens: usage.input_tokens || 0,
              outputTokens: usage.output_tokens || 0,
              cacheReadTokens: usage.cache_read_input_tokens || 0,
              cacheCreationTokens: usage.cache_creation_input_tokens || 0,
              totalTokens:
                (usage.input_tokens || 0) + (usage.output_tokens || 0),
            },
          });
        }
        break;
      }

      case 'message_stop': {
        onEvent({
          type: 'done',
          response: {
            content: null,
            toolCalls: [],
            usage: {
              inputTokens: 0,
              outputTokens: 0,
              cacheReadTokens: 0,
              cacheCreationTokens: 0,
              totalTokens: 0,
            },
            reasoning: null,
            finishReason: 'end_turn',
            model: (json.model as string) || '',
            id: (json.id as string) || '',
          },
        });
        break;
      }
    }
  }

  // ============================================================
  // Google 格式 SSE 解析
  // ============================================================

  /**
   * 解析 Google Gemini 格式的 SSE 数据行。
   *
   * 格式：data: {"candidates": [...], "usageMetadata": {...}}
   *
   * @param json - 解析后的 SSE JSON 对象
   * @param onEvent - 事件回调
   */
  protected parseGoogleSSELine(
    json: Record<string, unknown>,
    onEvent: (event: TransportStreamEvent) => void
  ): void {
    const candidates = json.candidates as
      | Array<Record<string, unknown>>
      | undefined;
    if (!candidates || !candidates[0]) return;

    const content = candidates[0].content as
      | Record<string, unknown>
      | undefined;
    if (!content) return;

    const parts = (content.parts || []) as Array<Record<string, unknown>>;
    for (const part of parts) {
      if (part.text) {
        onEvent({ type: 'text', content: part.text as string });
      }
    }

    // finishReason
    const finishReason = candidates[0].finishReason as string | undefined;
    if (finishReason) {
      onEvent({
        type: 'done',
        response: {
          content: null,
          toolCalls: [],
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            totalTokens: 0,
          },
          reasoning: null,
          finishReason: finishReason.toLowerCase(),
          model: (json.modelVersion as string) || '',
          id: '',
        },
      });
    }

    // usageMetadata
    const usage = json.usageMetadata as Record<string, number> | undefined;
    if (usage) {
      onEvent({
        type: 'usage',
        usage: {
          inputTokens: usage.promptTokenCount || 0,
          outputTokens: usage.candidatesTokenCount || 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          totalTokens:
            (usage.promptTokenCount || 0) + (usage.candidatesTokenCount || 0),
        },
      });
    }
  }

  // ============================================================
  // 工具注册 & 执行器
  // ============================================================

  /**
   * 设置工具注册表。
   *
   * @param registry - 工具注册表实例或 null
   */
  setToolRegistry(registry: ToolRegistry | null): void {
    this.toolRegistry = registry;
  }

  /**
   * 设置工具执行器。
   *
   * @param executor - 工具执行器实例或 null
   */
  setToolExecutor(executor: IToolExecutor | null): void {
    this.toolExecutor = executor;
  }

  // ============================================================
  // API Key 运行时设置
  // ============================================================

  /**
   * 运行时设置 API Key（子类可覆盖做额外处理）。
   *
   * @param _key - API Key
   */
  setApiKey(_key: string): void {
    // 子类按需覆盖
  }

  // ============================================================
  // 配置验证
  // ============================================================

  /**
   * 验证配置是否合法。
   *
   * @param config - Provider 配置
   * @returns 验证结果（包含错误 / 警告列表）
   */
  validateConfig(config: ProviderConfig): ProviderValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!config.apiKey && !this.resolveApiKey()) {
      warnings.push(`未配置 API Key（Provider: ${this.id}）`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  // ============================================================
  // 抽象方法（子类必须实现）
  // ============================================================

  /**
   * 非流式聊天。
   *
   * @param messages - 消息列表
   * @param options - 选项（工具定义、模型选择等）
   * @returns 完整 ChatResponse
   */
  abstract chat(
    messages: ChatMessage[],
    options?: ChatOptions
  ): Promise<ChatResponse>;

  /**
   * 流式聊天。
   *
   * @param messages - 消息列表
   * @param options - 选项
   * @returns AsyncGenerator，产出文本/思考分块，最终返回 ChatResponse
   */
  abstract chatStream(
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncGenerator<string | ThinkingProviderChunk, ChatResponse, unknown>;

  /**
   * 获取支持的模型列表。
   *
   * @returns 模型名数组
   */
  abstract listModels(): Promise<string[]>;
}
