/**
 * Azure OpenAI 提供商
 * 扩展 OpenAI 兼容 API，覆盖 Azure 端点
 */
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import type { ChatMessage, ChatResponse } from '../models/types';
import type {
  AIProvider,
  ProviderConfig,
  ProviderValidationResult,
  ChatOptions,
} from './AIProvider';

export class AzureOpenAIProvider implements AIProvider {
  readonly id = 'azure-openai';
  readonly displayName = 'Azure OpenAI';
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = {
      apiVersion: '2024-02-15-preview',
      ...config,
    };
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
    return ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-35-turbo'];
  }

  validateConfig(config: ProviderConfig): ProviderValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!config.apiKey && !process.env['AZURE_OPENAI_API_KEY']) {
      errors.push('AZURE_OPENAI_API_KEY is required');
    }
    if (!config.baseUrl && !process.env['AZURE_OPENAI_ENDPOINT']) {
      errors.push('AZURE_OPENAI_ENDPOINT is required');
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  setToolRegistry(registry: unknown): void {}

  setToolExecutor(executor: unknown): void {}

  private async sendRequest(
    messages: ChatMessage[],
    options?: ChatOptions,
    stream?: boolean
  ): Promise<ChatResponse> {
    const apiKey =
      (this.config.apiKey as string) ||
      process.env['AZURE_OPENAI_API_KEY'] ||
      '';
    const endpoint =
      (this.config.baseUrl as string) ||
      process.env['AZURE_OPENAI_ENDPOINT'] ||
      '';
    const deployment = (this.config.deployment as string) || 'gpt-4o';
    const apiVersion =
      (this.config.apiVersion as string) || '2024-02-15-preview';

    const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

    const body = JSON.stringify({
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      max_tokens: options?.maxTokens || 4096,
      temperature: options?.temperature,
      stream: stream || false,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
      },
      body,
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

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
      model?: string;
    };

    const content = data.choices?.[0]?.message?.content || '';

    return {
      content,
      model: data.model || deployment,
      stop_reason: 'stop',
      usage: {
        prompt_tokens: data.usage?.prompt_tokens || 0,
        completion_tokens: data.usage?.completion_tokens || 0,
        total_tokens: data.usage?.total_tokens || 0,
      },
    };
  }
}
