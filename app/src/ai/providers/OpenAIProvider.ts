import type {
  ChatMessage,
  ChatResponse,
  ToolDefinition,
} from '../models/types';
import {
  type AIProvider,
  type ProviderConfig,
  type ProviderValidationResult,
} from './AIProvider';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { ChatCompletionsTransport } from '../transports/ChatCompletionsTransport';
import { TransportProviderAdapter } from '../transports/TransportProviderAdapter';
import { ALL_MODEL_CONFIGS, getModelsByProvider } from '../models/ModelConfigs';
import { ModelRegistry } from '../models/ModelRegistry';

const logger = new Logger({ level: LogLevel.INFO });

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

export class OpenAIProvider implements AIProvider {
  readonly id = 'openai';
  readonly displayName = 'OpenAI';
  private apiKey: string;
  private baseUrl: string;
  private readonly adapter: TransportProviderAdapter;

  constructor(config: ProviderConfig) {
    const registry = ModelRegistry.getInstance();
    const providerCfg = registry.getProviderConfig('openai');

    this.apiKey =
      providerCfg?.apiKey || config.apiKey || process.env.OPENAI_API_KEY || '';
    this.baseUrl = (
      providerCfg?.baseUrl ||
      config.baseUrl ||
      DEFAULT_BASE_URL
    ).replace(/\/+$/, '');
    this.adapter = new TransportProviderAdapter(new ChatCompletionsTransport());
  }

  async chat(
    messages: ChatMessage[],
    options?: {
      tools?: ToolDefinition[];
      model?: string;
      maxTokens?: number;
      temperature?: number;
    }
  ): Promise<ChatResponse> {
    const requestBody = this.adapter.buildRequest({
      model: options?.model || 'gpt-4o',
      messages,
      tools: options?.tools,
      maxTokens: options?.maxTokens || 4096,
      temperature: options?.temperature,
    });

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(120000),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new AppError(
          `OpenAI API error (${response.status}): ${errorBody}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }

      const data = (await response.json()) as Record<string, unknown>;
      return this.adapter.toChatResponse(this.adapter.normalizeResponse(data));
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        `OpenAI chat failed: ${(error as Error).message}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
  }

  async *chatStream(
    messages: ChatMessage[],
    options?: {
      tools?: ToolDefinition[];
      model?: string;
      maxTokens?: number;
      temperature?: number;
    }
  ): AsyncGenerator<string, ChatResponse, unknown> {
    const requestBody = this.adapter.buildRequest({
      model: options?.model || 'gpt-4o',
      messages,
      tools: options?.tools,
      maxTokens: options?.maxTokens || 4096,
      temperature: options?.temperature,
      stream: true,
    });

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(180000),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new AppError(
          `OpenAI stream error (${response.status}): ${errorBody}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new AppError(
          'OpenAI stream: no response body',
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';
      let lastUsage:
        | import('@modules/ai/models/types').ChatResponse['usage']
        | undefined;

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

            // 提取 usage 字段（通常在流式响应的最后一个 chunk 中出现）
            const usage = parsed['usage'] as
              | import('@modules/ai/models/types').ChatResponse['usage']
              | undefined;
            if (usage) {
              lastUsage = usage;
            }

            const choice = (parsed.choices as Record<string, unknown>[])?.[0];
            const delta = choice?.delta as Record<string, unknown> | undefined;
            const content = delta?.content as string | undefined;
            if (content) {
              fullContent += content;
              yield content;
            }
          } catch {
            // skip malformed SSE lines
          }
        }
      }

      return {
        content: fullContent,
        model: options?.model || 'gpt-4o',
        stop_reason: 'stop',
        usage: lastUsage,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        `OpenAI stream failed: ${(error as Error).message}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
  }

  async listModels(): Promise<string[]> {
    const supportedModels = getModelsByProvider('openai').map(
      (key) => ALL_MODEL_CONFIGS[key].openai
    );
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) return supportedModels;

      const data = (await response.json()) as { data?: { id: string }[] };
      return (
        data.data?.map((m) => m.id).filter((id) => id.includes('gpt')) ??
        supportedModels
      );
    } catch {
      return supportedModels;
    }
  }

  validateConfig(config: ProviderConfig): ProviderValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!config.apiKey && !process.env.OPENAI_API_KEY) {
      errors.push('API key is required (config.apiKey or OPENAI_API_KEY)');
    }

    const supportedModels = getModelsByProvider('openai').map(
      (key) => ALL_MODEL_CONFIGS[key].openai
    );
    if (config.model && !supportedModels.includes(config.model)) {
      warnings.push(
        `Unknown model: ${config.model}. Supported: ${supportedModels.join(', ')}`
      );
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * OpenAI DALL-E 3 图像生成
   * 走 /v1/images/generations 端点
   */
  async generateImage(
    params: import('./AIProvider').ImageGenerationParams
  ): Promise<import('./AIProvider').ImageGenerationResult> {
    const startTime = Date.now();

    const body: Record<string, unknown> = {
      model: 'dall-e-3',
      prompt: params.prompt,
      n: params.n ?? 1,
      size: params.size ?? '1024x1024',
      quality: params.quality ?? 'standard',
      style: params.style ?? 'vivid',
      response_format: 'b64_json',
    };

    if (body.quality === 'hd' && body.size === '1024x1024') {
      body.size = '1792x1024';
    }

    try {
      const response = await fetch(`${this.baseUrl}/images/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120000),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        return {
          success: false,
          data: [],
          error: `DALL-E API error (${response.status}): ${errorBody}`,
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
        model: 'dall-e-3',
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        data: [],
        error: `DALL-E generation failed: ${(error as Error).message}`,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * OpenAI Vision 图片分析
   * 直接构造 chat/completions 多模态请求
   */
  async analyzeImage(
    params: import('./AIProvider').VisionAnalysisParams
  ): Promise<import('./AIProvider').VisionAnalysisResult> {
    const startTime = Date.now();
    const base64 = params.imageBuffer.toString('base64');
    const dataUrl = `data:${params.mimeType};base64,${base64}`;

    const requestBody = {
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: params.prompt || '请详细描述这张图片的内容。',
            },
            {
              type: 'image_url',
              image_url: {
                url: dataUrl,
                detail: params.detail || 'auto',
              },
            },
          ],
        },
      ],
      max_tokens: params.maxTokens ?? 1024,
    };

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(120000),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        return {
          success: false,
          description: '',
          error: `OpenAI Vision error (${response.status}): ${errorBody}`,
          durationMs: Date.now() - startTime,
        };
      }

      const data = (await response.json()) as Record<string, unknown>;
      const choice = (data.choices as Array<Record<string, unknown>>)?.[0];
      const message = choice?.message as Record<string, unknown> | undefined;
      const content = message?.content as string | undefined;

      return {
        success: true,
        description: content || '',
        model: 'gpt-4o',
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        description: '',
        error: `OpenAI Vision failed: ${(error as Error).message}`,
        durationMs: Date.now() - startTime,
      };
    }
  }
}
