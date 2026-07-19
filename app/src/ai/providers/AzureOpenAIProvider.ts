/**
 * Azure OpenAI 提供商
 * 扩展 OpenAI 兼容 API，覆盖 Azure 端点
 */
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { configManager } from '@modules/config';
import type { ChatMessage, ChatResponse } from '../models/types';
import type {
  ProviderConfig,
  ProviderValidationResult,
  ChatOptions,
} from './AIProvider';
import { BaseAIProvider, type BaseProviderOptions } from './BaseAIProvider';
import { ChatCompletionsTransport } from '../transports/ChatCompletionsTransport';
import { TransportProviderAdapter } from '../transports/TransportProviderAdapter';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'ai\providers\AzureOpenAIProvider',
  level: LogLevel.INFO,
});

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
