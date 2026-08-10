/**
 * Anthropic (Claude) 提供商
 * 使用 Messages API + fetch，取代 @anthropic-ai/sdk
 */
import type {
  ChatMessage,
  ChatResponse,
  LLMConfig,
  ParsedToolCall,
} from '../models/types';
import type {
  ProviderConfig,
  ProviderValidationResult,
  ChatOptions,
  ThinkingProviderChunk,
  VisionAnalysisParams,
  VisionAnalysisResult,
} from './AIProvider';
import { BaseAIProvider, type BaseProviderOptions } from './BaseAIProvider';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { getLogger } from '@modules/monitoring';
import { configManager } from '@modules/config';
import { MessagesApiTransport } from '../transports/AnthropicMessagesTransport';
import { TransportProviderAdapter } from '../transports/TransportProviderAdapter';
import { ALL_MODEL_CONFIGS, getModelsByProvider } from '../models/ModelConfigs';

const logger = getLogger('ai:anthropic');

const BETA_HEADERS = {
  PROMPT_CACHING: 'prompt-caching-2024-07-24',
  STRUCTURED_OUTPUTS: 'structured-outputs-2024-08-01',
} as const;

export class AnthropicProvider extends BaseAIProvider {
  private config: LLMConfig;

  constructor(
    options: BaseProviderOptions,
    _extraConfig?: Record<string, unknown>
  ) {
    super(options, _extraConfig);

    const apiKey = this.resolveApiKey() || '';
    const baseUrl = (
      this.resolveBaseUrl() || 'https://api.anthropic.com'
    ).replace(/\/+$/, '');

    this.config = {
      apiKey,
      baseUrl,
      model: options.defaultModel || '',
      maxTokens: 4096,
      temperature: 1.0,
    };

    if (!this.transport) {
      this.transport = new TransportProviderAdapter(new MessagesApiTransport());
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
    const model =
      options?.model || this.config.model || (await this.resolveModel('chat'));

    return this.withRetry(async () => {
      return this.sendRequest(model, messages, options);
    });
  }

  async *chatStream(
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncGenerator<string | ThinkingProviderChunk, ChatResponse, unknown> {
    const model =
      options?.model || this.config.model || (await this.resolveModel('chat'));
    const apiKey = this.resolveApiKey() || this.config.apiKey || '';
    const baseUrl = (
      this.resolveBaseUrl() || 'https://api.anthropic.com'
    ).replace(/\/+$/, '');

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

    try {
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
          signal: AbortSignal.timeout(180000),
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
      // 流式 tool_use 累积（按 index 合并分片）
      const pendingToolCalls = new Map<
        number,
        { id: string; name: string; arguments: string }
      >();
      let stopReason: 'stop' | 'tool_calls' | 'max_tokens' = 'stop';
      let toolCalls: ParsedToolCall[] = [];
      let lastUsage: ChatResponse['usage'] | undefined;

      try {
        while (true) {
          const { done, value } = await this.readStreamChunkWithTimeout(reader);
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

                switch (type) {
                  case 'content_block_start': {
                    const contentBlock = (parsed.content_block || {}) as Record<
                      string,
                      unknown
                    >;
                    if (contentBlock.type === 'tool_use') {
                      const idx = (parsed.index as number) || 0;
                      pendingToolCalls.set(idx, {
                        id: (contentBlock.id as string) || '',
                        name: (contentBlock.name as string) || '',
                        arguments: '',
                      });
                    }
                    break;
                  }

                  case 'content_block_delta': {
                    const delta = (parsed.delta || {}) as Record<
                      string,
                      unknown
                    >;
                    const deltaType = delta.type as string | undefined;

                    if (deltaType === 'text_delta' && delta.text) {
                      fullContent += delta.text as string;
                      yield delta.text as string;
                    } else if (
                      deltaType === 'thinking_delta' &&
                      delta.thinking
                    ) {
                      yield {
                        type: 'thinking',
                        content: delta.thinking as string,
                      };
                    } else if (
                      deltaType === 'input_json_delta' &&
                      delta.partial_json
                    ) {
                      // Anthropic tool_use 参数累积
                      const idx = (parsed.index as number) || 0;
                      const pending = pendingToolCalls.get(idx);
                      if (pending) {
                        pending.arguments += delta.partial_json as string;
                      }
                    }
                    break;
                  }

                  case 'message_delta': {
                    const delta = (parsed.delta || {}) as Record<
                      string,
                      unknown
                    >;
                    const msgStopReason = delta.stop_reason as
                      | string
                      | undefined;

                    // tool_use 停止 → 组装 tool_calls
                    if (
                      msgStopReason === 'tool_use' &&
                      pendingToolCalls.size > 0
                    ) {
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
                    } else if (msgStopReason === 'max_tokens') {
                      stopReason = 'max_tokens';
                    }

                    // 用量
                    const usage = parsed.usage as
                      | Record<string, number>
                      | undefined;
                    if (usage) {
                      lastUsage = {
                        prompt_tokens: usage.input_tokens || 0,
                        completion_tokens: usage.output_tokens || 0,
                        total_tokens:
                          (usage.input_tokens || 0) +
                          (usage.output_tokens || 0),
                        cache_read_input_tokens:
                          usage.cache_read_input_tokens || 0,
                        cache_creation_input_tokens:
                          usage.cache_creation_input_tokens || 0,
                      };
                    }
                    break;
                  }

                  case 'message_stop':
                    // 流结束标记，无需额外处理
                    break;
                }
              } catch (err) {
                // JSON 解析失败，跳过该行
              }
            }
          }
        }

        return {
          content: fullContent,
          stop_reason: stopReason,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          usage: lastUsage || {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        };
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        `Anthropic stream failed: ${(error as Error).message}`,
        ErrorCategory.API,
        ErrorSeverity.HIGH,
        'API_ERROR'
      );
    }
  }

  /**
   * 视觉分析（Anthropic Messages API）
   */
  async analyzeImage(
    params: VisionAnalysisParams
  ): Promise<VisionAnalysisResult> {
    const startTime = Date.now();
    const model = params.model;

    const base64 = params.imageBuffer.toString('base64');
    const baseUrl = (
      this.resolveBaseUrl() || 'https://api.anthropic.com'
    ).replace(/\/+$/, '');
    const apiKey = this.resolveApiKey() || this.config.apiKey || '';

    const requestBody = {
      model,
      max_tokens: params.maxTokens ?? 4096,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: params.mimeType,
                data: base64,
              },
            },
            {
              type: 'text',
              text: params.prompt || '请详细描述这张图片的内容。',
            },
          ],
        },
      ],
    };

    try {
      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(120000),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        return {
          success: false,
          description: '',
          error: `Anthropic Vision error (${response.status}): ${errorBody}`,
          durationMs: Date.now() - startTime,
        };
      }

      const data = (await response.json()) as Record<string, unknown>;
      const content = (data.content as Array<Record<string, unknown>>) || [];
      const textBlocks = content.filter((c) => c.type === 'text');
      const description = textBlocks
        .map((c) => (c.text as string) || '')
        .join('\n');

      return {
        success: true,
        description,
        model,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        description: '',
        error: `Anthropic Vision request failed: ${errMsg}`,
        durationMs: Date.now() - startTime,
      };
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

    if (
      this.config.model?.includes('claude-sonnet-4') ||
      this.config.model?.includes('opus-4')
    ) {
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
    const baseUrl = (
      this.resolveBaseUrl() || 'https://api.anthropic.com'
    ).replace(/\/+$/, '');
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
