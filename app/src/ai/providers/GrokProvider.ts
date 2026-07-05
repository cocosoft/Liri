/**
 * Grok (X.AI) 提供商
 * OpenAI 兼容 API
 */
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { Logger, LogLevel } from '@modules/monitoring';
import { configManager } from '@modules/config';
import type { ChatMessage, ChatResponse } from '../models/types';
import type { ProviderConfig, ProviderValidationResult } from './AIProvider';
import { ChatCompletionsTransport } from '../transports/ChatCompletionsTransport';
import { TransportProviderAdapter } from '../transports/TransportProviderAdapter';
import { ALL_MODEL_CONFIGS, getModelsByProvider } from '../models/ModelConfigs';
import { BaseAIProvider, type BaseProviderOptions } from './BaseAIProvider';

const logger = new Logger({ module: 'ai:grok', level: LogLevel.INFO });

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
      // 使用 fetchWithConnectionRetry（基类已注入系统 CA 证书 dispatcher，解决 Windows SSL 证书问题）
      const response = await GrokProvider.fetchWithConnectionRetry(
        `${this.baseUrl}/images/generations`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(120000),
        },
        0 // 图片生成不自动重试（避免重复请求和重复计费）
      );

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
      const errorMessage = (error as Error).message || String(error);

      // 检测 SSL/TLS 证书错误，提供用户友好的解决建议
      const isSSLError =
        /certificate|ssl|tls|unable to verify/i.test(errorMessage);

      const userHint = isSSLError
        ? `SSL 证书验证失败。请尝试以下操作：\n` +
          `1. 设置环境变量 NODE_EXTRA_CA_CERTS 指向系统 CA 证书文件\n` +
          `   （如 Git\\mingw64\\ssl\\cert.pem 或 curl\\ca-bundle.crt）\n` +
          `2. 如在代理环境下使用，请确认代理证书已加入信任列表\n` +
          `原始错误: ${errorMessage}`
        : `Grok 图像生成失败: ${errorMessage}`;

      logger.warn('GrokProvider.generateImage() · 请求失败', {
        providerId: this.id,
        model,
        isSSLError,
        error: errorMessage,
      });

      return {
        success: false,
        data: [],
        error: userHint,
        durationMs: Date.now() - startTime,
      };
    }
  }
}
