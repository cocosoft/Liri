/**
 * Grok (X.AI) 提供商
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
import type { IToolExecutor, ToolRegistry } from '../interfaces/ToolExecutor';
import { ChatCompletionsTransport } from '../transports/ChatCompletionsTransport';
import { TransportProviderAdapter } from '../transports/TransportProviderAdapter';
import { ALL_MODEL_CONFIGS, getModelsByProvider } from '../models/ModelConfigs';
import { ModelRegistry } from '../models/ModelRegistry';

export class GrokProvider implements AIProvider {
  readonly id = 'grok';
  readonly displayName = 'Grok (X.AI)';
  private config: ProviderConfig;
  private readonly adapter: TransportProviderAdapter;

  constructor(config: ProviderConfig) {
    const registry = ModelRegistry.getInstance();
    const providerCfg = registry.getProviderConfig('grok');

    this.config = {
      baseUrl: 'https://api.x.ai/v1',
      ...(providerCfg
        ? { baseUrl: providerCfg.baseUrl, apiKey: providerCfg.apiKey }
        : {}),
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
    return getModelsByProvider('grok').map(
      (key) => ALL_MODEL_CONFIGS[key].grok
    );
  }

  validateConfig(config: ProviderConfig): ProviderValidationResult {
    const errors: string[] = [];

    if (!config.apiKey && !process.env['GROK_API_KEY']) {
      errors.push('GROK_API_KEY is required');
    }

    return { valid: errors.length === 0, errors, warnings: [] };
  }

  setToolRegistry(registry: ToolRegistry | null): void {}

  setToolExecutor(executor: IToolExecutor | null): void {}

  private async sendRequest(
    messages: ChatMessage[],
    options?: ChatOptions,
    stream?: boolean
  ): Promise<ChatResponse> {
    const apiKey =
      (this.config.apiKey as string) || process.env['GROK_API_KEY'] || '';
    const baseUrl = (this.config.baseUrl as string) || 'https://api.x.ai/v1';
    const grokModels = getModelsByProvider('grok').map(
      (key) => ALL_MODEL_CONFIGS[key].grok
    );
    const model =
      options?.model || (this.config.model as string) || grokModels[1];

    const requestBody = this.adapter.buildRequest({
      model,
      messages,
      tools: options?.tools,
      maxTokens: options?.maxTokens || 4096,
      temperature: options?.temperature,
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
        `Grok API error: ${response.status} ${response.statusText}`,
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
