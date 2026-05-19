/**
 * Moonshot AI 提供商（Kimi）
 * OpenAI 兼容 API
 */
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import type { ChatMessage, ChatResponse } from '../models/types';
import type {
  AIProvider,
  ProviderConfig,
  ProviderValidationResult,
  ChatOptions,
} from './AIProvider';
import { ChatCompletionsTransport } from '../transports/ChatCompletionsTransport';
import { TransportProviderAdapter } from '../transports/TransportProviderAdapter';

const SUPPORTED_MODELS = [
  'moonshot-v1-8k',
  'moonshot-v1-32k',
  'moonshot-v1-128k',
];

export class MoonshotProvider implements AIProvider {
  readonly id = 'moonshot';
  readonly displayName = 'Moonshot (Kimi)';
  private config: ProviderConfig;
  private readonly adapter: TransportProviderAdapter;

  constructor(config: ProviderConfig) {
    this.config = {
      baseUrl: 'https://api.moonshot.cn/v1',
      ...config,
    };
    this.adapter = new TransportProviderAdapter(new ChatCompletionsTransport());
  }

  async chat(
    messages: ChatMessage[],
    options?: ChatOptions
  ): Promise<ChatResponse> {
    return this.sendRequest(messages, options, false);
  }

  async *chatStream(
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncGenerator<string, ChatResponse, unknown> {
    const response = await this.sendRequest(messages, options, true);
    yield response.content;

    return response;
  }

  async listModels(): Promise<string[]> {
    return [...SUPPORTED_MODELS];
  }

  validateConfig(config: ProviderConfig): ProviderValidationResult {
    const errors: string[] = [];

    if (!config.apiKey && !process.env['MOONSHOT_API_KEY']) {
      errors.push('MOONSHOT_API_KEY is required');
    }

    return { valid: errors.length === 0, errors, warnings: [] };
  }

  private async sendRequest(
    messages: ChatMessage[],
    options?: ChatOptions,
    stream?: boolean
  ): Promise<ChatResponse> {
    const apiKey =
      (this.config.apiKey as string) || process.env['MOONSHOT_API_KEY'] || '';
    const baseUrl =
      (this.config.baseUrl as string) || 'https://api.moonshot.cn/v1';
    const model =
      options?.model || (this.config.model as string) || SUPPORTED_MODELS[1];

    const requestBody = this.adapter.buildRequest({
      model,
      messages,
      tools: options?.tools,
      maxTokens: options?.maxTokens || 4096,
      temperature: options?.temperature ?? 0.3,
      stream: stream || false,
    });

    const response = await fetch(`${baseUrl}/chat/completions`, {
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
    return this.adapter.toChatResponse(this.adapter.normalizeResponse(data));
  }
}
