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
    const model = await this.resolveModel('chat', options);

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

  /**
   * xAI Grok 图像生成（OpenAI 兼容 API）
   * 参照 openclaw extensions/xai/image-generation-provider.ts
   */
  async generateImage(
    params: import('./AIProvider').ImageGenerationParams
  ): Promise<import('./AIProvider').ImageGenerationResult> {
    const startTime = Date.now();
    const model = params.model || 'grok-imagine-image';
    const apiKey = this.resolveApiKey();

    if (!apiKey) {
      return {
        success: false,
        data: [],
        error: 'GROK_API_KEY 未配置',
        durationMs: 0,
      };
    }

    const body: Record<string, unknown> = {
      model,
      prompt: params.prompt,
      n: params.n ?? 1,
      response_format: 'b64_json',
    };

    if (params.size) {
      body.size = params.size;
    }

    try {
      const response = await fetch(`${this.baseUrl}/images/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120000),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        return {
          success: false,
          data: [],
          error: `Grok 图像生成 API 错误 (${response.status}): ${errorBody}`,
          durationMs: Date.now() - startTime,
        };
      }

      const data = (await response.json()) as Record<string, unknown>;
      const images = (data.data as Array<Record<string, string>>) || [];

      return {
        success: true,
        data: images.map((img: Record<string, string>) => ({
          url: img.url || `data:image/png;base64,${img.b64_json}`,
          b64_json: img.b64_json,
          alt: params.prompt,
        })),
        model,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        data: [],
        error: `Grok 图像生成失败: ${(error as Error).message}`,
        durationMs: Date.now() - startTime,
      };
    }
  }
}
