/**
 * Anthropic (Claude) 提供商
 * 使用 Messages API + fetch，取代 @anthropic-ai/sdk
 */
import type { ChatMessage, ChatResponse, LLMConfig } from '../models/types';
import type {
  ProviderConfig,
  ProviderValidationResult,
  ChatOptions,
  ThinkingProviderChunk,
} from './AIProvider';
import {
  BaseAIProvider,
  type BaseProviderOptions,
} from './BaseAIProvider';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { configManager } from '@modules/config';
import { MessagesApiTransport } from '../transports/AnthropicMessagesTransport';
import { TransportProviderAdapter } from '../transports/TransportProviderAdapter';
import { ALL_MODEL_CONFIGS, getModelsByProvider } from '../models/ModelConfigs';

const logger = new Logger({ level: LogLevel.INFO });

const BETA_HEADERS = {
  PROMPT_CACHING: 'prompt-caching-2024-07-24',
  STRUCTURED_OUTPUTS: 'structured-outputs-2024-08-01',
} as const;

export class AnthropicProvider extends BaseAIProvider {
  private config: LLMConfig;

  constructor(options: BaseProviderOptions, _extraConfig?: Record<string, unknown>) {
    super(options, _extraConfig);

    const apiKey = this.resolveApiKey() || '';
    const baseUrl = (this.resolveBaseUrl() || 'https://api.anthropic.com').replace(/\/+$/, '');

    this.config = {
      apiKey,
      baseUrl,
      model: options.defaultModel || '',
      maxTokens: 4096,
      temperature: 1.0,
    };

    if (!this.transport) {
      this.transport = new TransportProviderAdapter(
        new MessagesApiTransport()
      );
    }
  }

  /**
   * 判断指定模型是否支持 thinking。
   */
  override supportsThinking(model: string): boolean {
    return (
      model.includes('claude-sonnet-4') ||
      model.includes('opus-4') ||
      model.includes('haiku-4')
    );
  }

  /**
   * 判断指定模型是否支持结构化输出。
   */
  override supportsStructuredOutputs(model: string): boolean {
    return model.includes('claude-sonnet-4') || model.includes('opus-4');
  }

  async listModels(): Promise<string[]> {
    return getModelsByProvider('firstParty').map(
      (key) => ALL_MODEL_CONFIGS[key].firstParty
    );
  }

  override validateConfig(config: ProviderConfig): ProviderValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!config.apiKey && !configManager.env('ANTHROPIC_API_KEY')) {
      errors.push('API key is required (config.apiKey or ANTHROPIC_API_KEY)');
    }

    const supportedModels = getModelsByProvider('firstParty').map(
      (key) => ALL_MODEL_CONFIGS[key].firstParty
    );
    if (config.model && !supportedModels.includes(config.model)) {
      warnings.push(
        `Unknown model: ${config.model}. Supported: ${supportedModels.join(', ')}`
      );
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  async chat(
    messages: ChatMessage[],
    options?: ChatOptions
  ): Promise<ChatResponse> {
    const model = options?.model || this.config.model || this.resolveModel('chat');

    return this.withRetry(async () => {
      return this.sendRequest(model, messages, options);
    });
  }

  async *chatStream(
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncGenerator<string | ThinkingProviderChunk, ChatResponse, unknown> {
    const model = options?.model || this.config.model || this.resolveModel('chat');
    const apiKey = this.resolveApiKey() || this.config.apiKey || '';
    const baseUrl = (this.resolveBaseUrl() || 'https://api.anthropic.com').replace(/\/+$/, '');

    const { systemPrompt } = this.transport!.splitMessages(messages);

    const requestBody = this.transport!.buildRequest({
      model,
      messages,
      tools: options?.tools,
      systemPrompt,
      maxTokens: options?.maxTokens || 4096,
      temperature: options?.temperature,
      stream: true,
    });

    // 使用带连接重试的 fetch，应对 Provider API 网关偶发断连
    const response = await BaseAIProvider.fetchWithConnectionRetry(
      `${baseUrl}/v1/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(requestBody),
      }
    );

    if (!response.ok) {
      throw new AppError(
        `Anthropic API error: ${response.status} ${response.statusText}`,
        ErrorCategory.API,
        ErrorSeverity.HIGH,
        'API_ERROR',
        { status: response.status, statusText: response.statusText }
      );
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new AppError(
        'Anthropic stream: no response body',
        ErrorCategory.API,
        ErrorSeverity.HIGH,
        'API_ERROR'
      );
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent = '';
    let fullContent = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (!data) continue;

            try {
              const parsed = JSON.parse(data) as Record<string, unknown>;
              const type = parsed.type as string;

              // content_block_delta → text 或 thinking
              if (type === 'content_block_delta') {
                const delta = (parsed.delta || {}) as Record<string, unknown>;
                const deltaType = delta.type as string | undefined;

                if (deltaType === 'text_delta' && delta.text) {
                  fullContent += delta.text as string;
                  yield delta.text as string;
                } else if (deltaType === 'thinking_delta' && delta.thinking) {
                  yield { type: 'thinking', content: delta.thinking as string };
                }
              }
            } catch {
              // JSON 解析失败，跳过该行
            }
          }
        }
      }

      return {
        content: fullContent,
        stop_reason: 'stop',
        usage: {
          prompt_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        },
      };
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * 构建 Anthropic Messages API 的通用请求头。
   */
  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': this.resolveApiKey() || this.config.apiKey || '',
      'anthropic-version': '2023-06-01',
    };

    if (this.config.model?.includes('claude-sonnet-4') || this.config.model?.includes('opus-4')) {
      headers['anthropic-beta'] = BETA_HEADERS.STRUCTURED_OUTPUTS;
    }

    return headers;
  }

  /**
   * 发送非流式请求。
   */
  private async sendRequest(
    model: string,
    messages: ChatMessage[],
    options?: ChatOptions
  ): Promise<ChatResponse> {
    const baseUrl = (this.resolveBaseUrl() || 'https://api.anthropic.com').replace(/\/+$/, '');
    const { systemPrompt } = this.transport!.splitMessages(messages);

    const requestBody = this.transport!.buildRequest({
      model,
      messages,
      tools: options?.tools,
      systemPrompt,
      maxTokens: options?.maxTokens || 4096,
      temperature: options?.temperature,
    });

    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new AppError(
        `Anthropic API error: ${response.status} ${response.statusText}`,
        ErrorCategory.API,
        ErrorSeverity.HIGH,
        'API_ERROR',
        { status: response.status, statusText: response.statusText }
      );
    }

    const data = (await response.json()) as Record<string, unknown>;
    return this.transport!.toChatResponse(
      this.transport!.normalizeResponse(data),
      model
    );
  }
}
