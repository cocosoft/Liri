/**
 * Grok (X.AI) 提供商
 * OpenAI 兼容 API
 */
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { configManager } from '@modules/config';
import type { ChatMessage, ChatResponse } from '../models/types';
import type { ProviderConfig, ProviderValidationResult } from './AIProvider';
import { ChatCompletionsTransport } from '../transports/ChatCompletionsTransport';
import { TransportProviderAdapter } from '../transports/TransportProviderAdapter';
import { ALL_MODEL_CONFIGS, getModelsByProvider } from '../models/ModelConfigs';
import { BaseAIProvider, type BaseProviderOptions } from './BaseAIProvider';

export class GrokProvider extends BaseAIProvider {
  private baseUrl: string;

  constructor(
    options: BaseProviderOptions,
    _extraConfig?: Record<string, unknown>
  ) {
    super(options, _extraConfig);

    this.baseUrl = (this.resolveBaseUrl() || 'https://api.x.ai/v1').replace(
      /\/+$/,
      ''
    );

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
  ): AsyncGenerator<string, ChatResponse, unknown> {
    const response = await this.sendRequest(messages, options, true);
    yield response.content;

    return response;
  }

  async listModels(): Promise<string[]> {
    return getModelsByProvider('grok').map(
      (key) => ALL_MODEL_CONFIGS[key].grok
    );
  }

  override validateConfig(config: ProviderConfig): ProviderValidationResult {
    const errors: string[] = [];

    if (!config.apiKey && !configManager.env('GROK_API_KEY')) {
      errors.push('GROK_API_KEY is required');
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
      this.resolveApiKey() || configManager.env('GROK_API_KEY') || '';
    const model = this.resolveModel('chat', options);

    const requestBody = this.transport!.buildRequest({
      model,
      messages,
      tools: options?.tools,
      maxTokens: options?.maxTokens || 4096,
      temperature: options?.temperature,
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
        `Grok API error: ${response.status} ${response.statusText}`,
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
