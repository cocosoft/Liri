/**
 * Azure OpenAI 提供商
 * 扩展 OpenAI 兼容 API，覆盖 Azure 端点
 */
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { configManager } from '@modules/config';
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

import { getLogger } from '@modules/monitoring';
const logger = getLogger('ai\providers\AzureOpenAIProvider');

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
    return BaseAIProvider.measureChat('AzureOpenAI', () =>
      this.sendRequest(messages, options, false)
    );
  }

  async *chatStream(
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncGenerator<string | ThinkingProviderChunk, ChatResponse, unknown> {
    // 流式耗时统计：委托 BaseAIProvider.wrapChatStreamMeasure（2026-08-16）
    return yield* BaseAIProvider.wrapChatStreamMeasure(
      'AzureOpenAI',
      this.chatStreamInternal(messages, options)
    );
  }

  private async *chatStreamInternal(
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncGenerator<string | ThinkingProviderChunk, ChatResponse, unknown> {
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

    const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

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
        signal: AbortSignal.timeout(180000),
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
      let fullContent = '';
      let lastUsage: ChatResponse['usage'] | undefined;
      const pendingToolCalls = new Map<
        number,
        { id: string; name: string; arguments: string }
      >();
      let stopReason: 'stop' | 'tool_calls' | 'max_tokens' = 'stop';
      let toolCalls: ParsedToolCall[] = [];

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
            const parsed = JSON.parse(data) as Record<string, unknown>;
            const usage = parsed['usage'] as ChatResponse['usage'] | undefined;
            if (usage) lastUsage = usage;

            const choice = (parsed.choices as Record<string, unknown>[])?.[0];
            const delta = choice?.delta as Record<string, unknown> | undefined;
            const finishReason = choice?.finish_reason as string | undefined;

            const reasoningContent = delta?.['reasoning_content'] as
              | string
              | undefined;
            if (reasoningContent) {
              yield { type: 'thinking', content: reasoningContent };
            }

            const content = delta?.content as string | undefined;
            if (content) {
              fullContent += content;
              yield content;
            }

            const streamToolCalls = delta?.tool_calls as
              | Array<Record<string, unknown>>
              | undefined;
            if (streamToolCalls) {
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
                  if (func.arguments)
                    pending.arguments += func.arguments as string;
                }
              }
            }

            if (finishReason === 'tool_calls' && pendingToolCalls.size > 0) {
              stopReason = 'tool_calls';
              toolCalls = Array.from(pendingToolCalls.entries())
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
            } else if (
              finishReason === 'max_tokens' ||
              finishReason === 'length'
            ) {
              stopReason = 'max_tokens';
            }
          } catch (err) {
            // skip malformed SSE lines
          }
        }
      }

      return {
        content: fullContent,
        model: deployment,
        stop_reason: stopReason,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        usage: lastUsage,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        `Azure OpenAI stream failed: ${(error as Error).message}`,
        ErrorCategory.API,
        ErrorSeverity.HIGH,
        'API_ERROR'
      );
    }
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

    const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

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
