/**
 * Moonshot AI 提供商（Kimi）
 * OpenAI 兼容 API
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
  ThinkingProviderChunk,
} from './AIProvider';
import { ChatCompletionsTransport } from '../transports/ChatCompletionsTransport';
import { TransportProviderAdapter } from '../transports/TransportProviderAdapter';
import { ALL_MODEL_CONFIGS, getModelsByProvider } from '../models/ModelConfigs';
import { BaseAIProvider, type BaseProviderOptions } from './BaseAIProvider';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'ai\providers\MoonshotProvider',
  level: LogLevel.INFO,
});

export class MoonshotProvider extends BaseAIProvider {
  private baseUrl: string;

  constructor(
    options: BaseProviderOptions,
    _extraConfig?: Record<string, unknown>
  ) {
    super(options, _extraConfig);

    this.baseUrl = (
      this.resolveBaseUrl() || 'https://api.moonshot.cn/v1'
    ).replace(/\/+$/, '');

    if (!this.transport) {
      this.transport = new TransportProviderAdapter(
        new ChatCompletionsTransport()
      );
    }
  }

  async chat(
    messages: ChatMessage[],
    options?: {
      tools?: import('../models/types').ToolDefinition[];
      model?: string;
      maxTokens?: number;
      temperature?: number;
    }
  ): Promise<ChatResponse> {
    return this.sendRequest(messages, options, false);
  }

  async *chatStream(
    messages: ChatMessage[],
    options?: {
      tools?: import('../models/types').ToolDefinition[];
      model?: string;
      maxTokens?: number;
      temperature?: number;
    }
  ): AsyncGenerator<string | ThinkingProviderChunk, ChatResponse, unknown> {
    const apiKey =
      this.resolveApiKey() || configManager.env('MOONSHOT_API_KEY') || '';
    const model = await this.resolveModel('chat', options);

    const requestBody = this.transport!.buildRequest({
      model,
      messages,
      tools: options?.tools,
      maxTokens: options?.maxTokens || 4096,
      temperature: options?.temperature ?? 0.3,
      stream: true,
    });

    try {
      const response = await MoonshotProvider.fetchWithConnectionRetry(
        `${this.baseUrl}/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(180000),
        }
      );

      if (!response.ok) {
        const errorBody = await response.text();
        throw new AppError(
          `Moonshot stream error (${response.status}): ${errorBody}`,
          ErrorCategory.API,
          ErrorSeverity.HIGH,
          'API_ERROR'
        );
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new AppError(
          'Moonshot stream: no response body',
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
        const { done, value } = await reader.read();
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
        model,
        stop_reason: stopReason,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        usage: lastUsage,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        `Moonshot stream failed: ${(error as Error).message}`,
        ErrorCategory.API,
        ErrorSeverity.HIGH,
        'API_ERROR'
      );
    }
  }

  async listModels(): Promise<string[]> {
    return getModelsByProvider('moonshot').map(
      (key) => ALL_MODEL_CONFIGS[key].moonshot
    );
  }

  override validateConfig(config: ProviderConfig): ProviderValidationResult {
    const errors: string[] = [];

    if (!config.apiKey && !configManager.env('MOONSHOT_API_KEY')) {
      errors.push('MOONSHOT_API_KEY is required');
    }

    return { valid: errors.length === 0, errors, warnings: [] };
  }

  private async sendRequest(
    messages: ChatMessage[],
    options?: {
      tools?: import('../models/types').ToolDefinition[];
      model?: string;
      maxTokens?: number;
      temperature?: number;
    },
    stream?: boolean
  ): Promise<ChatResponse> {
    const apiKey =
      this.resolveApiKey() || configManager.env('MOONSHOT_API_KEY') || '';
    const model = await this.resolveModel('chat', options);

    const requestBody = this.transport!.buildRequest({
      model,
      messages,
      tools: options?.tools,
      maxTokens: options?.maxTokens || 4096,
      temperature: options?.temperature ?? 0.3,
      stream: stream || false,
    });

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new AppError(
        `Moonshot API error: ${response.status} ${response.statusText}`,
        ErrorCategory.API,
        ErrorSeverity.HIGH,
        'API_ERROR',
        { status: response.status, statusText: response.statusText }
      );
    }

    const data = (await response.json()) as Record<string, unknown>;
    return this.transport!.toChatResponse(
      this.transport!.normalizeResponse(data)
    );
  }
}
