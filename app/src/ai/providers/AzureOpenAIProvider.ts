/**
 * Azure OpenAI 提供商
 * 扩展 OpenAI 兼容 API，覆盖 Azure 端点
 */
import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  // 2026-09-25 §6.8：预期中断判据（已下沉到 error/）
  isAbortReason,
  markAsExpectedAbort,
} from '@openliri/infra/error';
import { configManager } from '@openliri/infra/config';
import type {
  ChatMessage,
  ChatResponse,
  ParsedToolCall,
} from '../models/types';
import type {
  ProviderConfig,
  ProviderValidationResult,
  ChatOptions,
  ThinkingProviderChunk,
} from './AIProvider';
import { BaseAIProvider, type BaseProviderOptions } from './BaseAIProvider';
import { ChatCompletionsTransport } from '../transports/ChatCompletionsTransport';
import { TransportProviderAdapter } from '../transports/TransportProviderAdapter';

import { getLogger } from '@openliri/infra/monitoring';
const logger = getLogger('ai\providers\AzureOpenAIProvider');

/** 累积中的 tool_call 分片（同一 index 跨片合并） */
type AzurePendingToolCall = {
  id: string;
  name: string;
  arguments: string;
};

/** 流式 SSE 解析的累积状态 */
type AzureStreamState = {
  fullContent: string;
  lastUsage: ChatResponse['usage'] | undefined;
  pendingToolCalls: Map<number, AzurePendingToolCall>;
  stopReason: 'stop' | 'tool_calls' | 'max_tokens';
  toolCalls: ParsedToolCall[];
};

export class AzureOpenAIProvider extends BaseAIProvider {
  private config: ProviderConfig;
  private readonly adapter: TransportProviderAdapter;

  constructor(
    options: BaseProviderOptions,
    extraConfig?: Record<string, unknown>
  ) {
    super(options);
    this.config = {
      apiVersion: '2024-02-15-preview',
      ...(extraConfig || {}),
    };
    this.adapter = new TransportProviderAdapter(new ChatCompletionsTransport());
  }

  async chat(
    messages: ChatMessage[],
    options?: ChatOptions
  ): Promise<ChatResponse> {
    // 耗时统计：委托 BaseAIProvider.measureChat（2026-08-16）
    return BaseAIProvider.measureChat(this.providerLabel, () =>
      this.sendRequest(messages, options, false)
    );
  }

  async *chatStream(
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncGenerator<string | ThinkingProviderChunk, ChatResponse, unknown> {
    // 流式耗时统计：委托 BaseAIProvider.wrapChatStreamMeasure（2026-08-16）
    return yield* BaseAIProvider.wrapChatStreamMeasure(
      this.providerLabel,
      // P1-1：传工厂，首包前连接重置时可重建一条流重试一次
      () => this.chatStreamInternal(messages, options)
    );
  }

  private async *chatStreamInternal(
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncGenerator<string | ThinkingProviderChunk, ChatResponse, unknown> {
    const { apiKey, deployment, url } = this.resolveConnection();

    const requestBody = this.adapter.buildRequest({
      model: deployment,
      messages,
      tools: options?.tools,
      maxTokens: options?.maxTokens || 4096,
      temperature: options?.temperature,
      stream: true,
    });

    try {
      const response = await AzureOpenAIProvider.fetchWithConnectionRetry(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': apiKey,
        },
        body: JSON.stringify(requestBody),
        // 外部取消信号（用户停止/会话切换）与请求超时任一触发即中断（CS01：与 OpenAIProvider 一致）
        signal: options?.signal
          ? AbortSignal.any([options.signal, AbortSignal.timeout(180000)])
          : AbortSignal.timeout(180000),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new AppError(
          `Azure OpenAI stream error (${response.status}): ${errorBody}`,
          ErrorCategory.API,
          ErrorSeverity.HIGH,
          'API_ERROR'
        );
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new AppError(
          'Azure OpenAI stream: no response body',
          ErrorCategory.API,
          ErrorSeverity.HIGH,
          'API_ERROR'
        );
      }

      const decoder = new TextDecoder();
      let buffer = '';
      const state: AzureStreamState = {
        fullContent: '',
        lastUsage: undefined,
        pendingToolCalls: new Map(),
        stopReason: 'stop',
        toolCalls: [],
      };

      while (true) {
        const { done, value } = await this.readStreamChunkWithTimeout(reader);
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6);
          if (data === '[DONE]') break;

          try {
            const emitted = AzureOpenAIProvider.applyStreamPayload(data, state);
            if (emitted.thinking) {
              yield { type: 'thinking', content: emitted.thinking };
            }
            if (emitted.content) {
              yield emitted.content;
            }
          } catch (err) {
            // skip malformed SSE lines
          }
        }
      }

      return {
        content: state.fullContent,
        model: deployment,
        stop_reason: state.stopReason,
        tool_calls: state.toolCalls.length > 0 ? state.toolCalls : undefined,
        usage: state.lastUsage,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      // 2026-09-25 §6.8：预期中止降噪（文案不变，仅 severity 降级 + 携带预期中断品牌）
      const expectedAbort = isAbortReason(error);
      const wrapped = new AppError(
        `Azure OpenAI stream failed: ${(error as Error).message}`,
        ErrorCategory.API,
        expectedAbort ? ErrorSeverity.LOW : ErrorSeverity.HIGH,
        'API_ERROR'
      );
      throw expectedAbort ? markAsExpectedAbort(wrapped) : wrapped;
    }
  }

  /**
   * 解析连接参数（鉴权 / 部署名 / 完整 URL）。
   * 流式与一次性请求共用同一回退链，避免两处各自拼装产生漂移。
   */
  private resolveConnection(): {
    apiKey: string;
    deployment: string;
    url: string;
  } {
    const apiKey =
      this.resolveApiKey() ||
      (this.config.apiKey as string) ||
      configManager.env('AZURE_OPENAI_API_KEY') ||
      '';
    const endpoint =
      (this.config.baseUrl as string) ||
      configManager.env('AZURE_OPENAI_ENDPOINT') ||
      '';
    const deployment = (this.config.deployment as string) || '';
    const apiVersion =
      (this.config.apiVersion as string) || '2024-02-15-preview';

    return {
      apiKey,
      deployment,
      url: `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`,
    };
  }

  /**
   * 处理一条 `data: ` 载荷：累积正文、思考、tool_calls 分片与终止原因。
   * 需要 yield 的增量以返回值交给调用方（生成器内统一 yield，便于特征化测试）。
   */
  private static applyStreamPayload(
    data: string,
    state: AzureStreamState
  ): { thinking?: string; content?: string } {
    const parsed = JSON.parse(data) as Record<string, unknown>;
    const usage = parsed['usage'] as ChatResponse['usage'] | undefined;
    if (usage) state.lastUsage = usage;

    const choice = (parsed.choices as Record<string, unknown>[])?.[0];
    const delta = choice?.delta as Record<string, unknown> | undefined;
    const finishReason = choice?.finish_reason as string | undefined;

    let thinking: string | undefined;
    const reasoningContent = delta?.['reasoning_content'] as string | undefined;
    if (reasoningContent) {
      thinking = reasoningContent;
    }

    let content: string | undefined;
    const contentDelta = delta?.content as string | undefined;
    if (contentDelta) {
      state.fullContent += contentDelta;
      content = contentDelta;
    }

    const streamToolCalls = delta?.tool_calls as
      | Array<Record<string, unknown>>
      | undefined;
    if (streamToolCalls) {
      AzureOpenAIProvider.accumulateToolCallDeltas(
        state.pendingToolCalls,
        streamToolCalls
      );
    }

    if (finishReason === 'tool_calls' && state.pendingToolCalls.size > 0) {
      state.stopReason = 'tool_calls';
      state.toolCalls = AzureOpenAIProvider.collectToolCalls(
        state.pendingToolCalls
      );
    } else if (finishReason === 'max_tokens' || finishReason === 'length') {
      state.stopReason = 'max_tokens';
    }

    return { thinking, content };
  }

  /** 按 index 合并 tool_calls 分片（id / name / arguments 逐片累积） */
  private static accumulateToolCallDeltas(
    pendingToolCalls: Map<number, AzurePendingToolCall>,
    streamToolCalls: Array<Record<string, unknown>>
  ): void {
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

  /** 把累积的 tool_calls 收敛为按 index 升序的调用列表，参数非法 JSON 时保留原文 */
  private static collectToolCalls(
    pendingToolCalls: Map<number, AzurePendingToolCall>
  ): ParsedToolCall[] {
    return Array.from(pendingToolCalls.entries())
      .sort(([a], [b]) => a - b)
      .map(([_, tc]) => {
        try {
          return {
            id: tc.id,
            name: tc.name,
            arguments: JSON.parse(tc.arguments) as Record<string, unknown>,
          };
        } catch {
          return {
            id: tc.id,
            name: tc.name,
            arguments: { _raw: tc.arguments },
          };
        }
      });
  }

  async listModels(): Promise<string[]> {
    return [];
  }

  override validateConfig(config: ProviderConfig): ProviderValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!config.apiKey && !configManager.env('AZURE_OPENAI_API_KEY')) {
      errors.push('AZURE_OPENAI_API_KEY is required');
    }
    if (!config.baseUrl && !configManager.env('AZURE_OPENAI_ENDPOINT')) {
      errors.push('AZURE_OPENAI_ENDPOINT is required');
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  private async sendRequest(
    messages: ChatMessage[],
    options?: ChatOptions,
    stream?: boolean
  ): Promise<ChatResponse> {
    const { apiKey, deployment, url } = this.resolveConnection();

    const requestBody = this.adapter.buildRequest({
      model: deployment,
      messages,
      tools: options?.tools,
      maxTokens: options?.maxTokens || 4096,
      temperature: options?.temperature,
      stream: stream || false,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify(requestBody),
      // 外部取消信号与请求超时任一触发即中断（CS01：与 chatStream 一致）
      signal: options?.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(180000)])
        : AbortSignal.timeout(180000),
    });

    if (!response.ok) {
      throw new AppError(
        `Azure OpenAI error: ${response.status} ${response.statusText}`,
        ErrorCategory.API,
        ErrorSeverity.HIGH,
        'API_ERROR',
        { status: response.status, statusText: response.statusText }
      );
    }

    const data = (await response.json()) as Record<string, unknown>;
    return this.adapter.toChatResponse(this.adapter.normalizeResponse(data));
  }
}
