import Anthropic from '@anthropic-ai/sdk';
import type { ChatMessage, ChatResponse, LLMConfig } from '../models/types';
import type { ThinkingConfig } from '../clients/thinking';
import type {
  AIProvider,
  ProviderConfig,
  ProviderValidationResult,
  ChatOptions,
} from './AIProvider';
import type { IToolExecutor, ToolRegistry } from '../interfaces/ToolExecutor';
import {
  withRetry,
  is529Error,
  MAX_529_RETRIES,
  BASE_DELAY_MS,
  type RetryConfig,
} from '@modules/query/withRetry';
import { feature } from '@modules/core';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { AnthropicMessagesTransport } from '../transports/AnthropicMessagesTransport';
import { TransportProviderAdapter } from '../transports/TransportProviderAdapter';
import { ALL_MODEL_CONFIGS, getModelsByProvider } from '../models/ModelConfigs';
import { ModelRegistry } from '../models/ModelRegistry';

const logger = new Logger({ level: LogLevel.INFO });

const BETA_HEADERS = {
  PROMPT_CACHING: 'prompt-caching-2024-07-24',
  STRUCTURED_OUTPUTS: 'structured-outputs-2024-08-01',
} as const;

export class AnthropicProvider implements AIProvider {
  readonly id = 'anthropic';
  readonly displayName = 'Anthropic Claude';
  private anthropic: Anthropic;
  private config: LLMConfig;
  private retryConfig: RetryConfig;
  private consecutive529Errors = 0;
  private toolRegistry: ToolRegistry | null = null;
  private toolExecutor: IToolExecutor | null = null;
  private readonly adapter: TransportProviderAdapter;

  constructor(config: ProviderConfig) {
    const registry = ModelRegistry.getInstance();
    const providerCfg = registry.getProviderConfig('anthropic');

    const apiKey =
      providerCfg?.apiKey || (config.apiKey as string) || process.env.ANTHROPIC_API_KEY || '';
    const baseUrl = (providerCfg?.baseUrl || config.baseUrl as string) || 'https://api.anthropic.com';

    this.config = {
      apiKey,
      baseUrl,
      model: (config.model as string) || 'claude-sonnet-4-6',
      maxTokens: (config.maxTokens as number) || 4096,
      temperature: (config.temperature as number) || 1.0,
    };

    this.retryConfig = {
      maxRetries: 10,
      initialDelayMs: BASE_DELAY_MS,
      maxDelayMs: 60000,
      jitterFactor: 0.1,
    };

    this.anthropic = new Anthropic({
      apiKey: apiKey || undefined,
      baseURL: baseUrl,
      maxRetries: 2,
      timeout: (config.timeout as number) || 120000,
    });

    this.adapter = new TransportProviderAdapter(
      new AnthropicMessagesTransport()
    );
  }

  setToolRegistry(registry: ToolRegistry | null): void {
    this.toolRegistry = registry;
  }

  setToolExecutor(executor: IToolExecutor | null): void {
    this.toolExecutor = executor;
  }

  supportsThinking(model: string): boolean {
    return (
      model.includes('claude-sonnet-4') ||
      model.includes('opus-4') ||
      model.includes('haiku-4')
    );
  }

  supportsStructuredOutputs(model: string): boolean {
    return model.includes('claude-sonnet-4') || model.includes('opus-4');
  }

  async preconnect(): Promise<void> {
    try {
      await fetch(this.config.baseUrl || 'https://api.anthropic.com', {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // 预连接失败不影响主流程
    }
  }

  notifyCompaction(): void {
    this.consecutive529Errors = 0;
  }

  async listModels(): Promise<string[]> {
    return getModelsByProvider('firstParty').map(
      (key) => ALL_MODEL_CONFIGS[key].firstParty
    );
  }

  validateConfig(config: ProviderConfig): ProviderValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!config.apiKey && !process.env.ANTHROPIC_API_KEY) {
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
    const model = options?.model || this.config.model || 'claude-sonnet-4-6';

    return withRetry(
      async () => {
        if (this.consecutive529Errors >= MAX_529_RETRIES) {
          this.consecutive529Errors = 0;
          throw new AppError(
            '529 overload: max retries exceeded',
            ErrorCategory.EXECUTION,
            ErrorSeverity.HIGH,
            '1000'
          );
        }
        const result = await this.sendRequest(model, messages, options);
        this.consecutive529Errors = 0;
        return result;
      },
      this.retryConfig,
      (_error, _attempt, _delay) => {
        if (is529Error(_error)) {
          this.consecutive529Errors++;
        }
      }
    );
  }

  async *chatStream(
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncGenerator<string, ChatResponse, unknown> {
    const model = options?.model || this.config.model || 'claude-sonnet-4-6';
    const { systemPrompt } = this.adapter.splitMessages(messages);

    const requestBody = this.adapter.buildRequest({
      model,
      messages,
      tools: options?.tools,
      systemPrompt,
      maxTokens: options?.maxTokens || 4096,
      temperature: options?.temperature,
      stream: true,
    });

    const stream = (await this.anthropic.messages.create({
      ...requestBody,
      stream: true,
    } as Anthropic.MessageCreateParams)) as unknown as AsyncIterable<{
      type: string;
      delta?: { type: string; text: string };
    }>;

    let fullContent = '';

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta?.type === 'text_delta'
      ) {
        fullContent += event.delta.text;
        yield event.delta.text;
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
  }

  private async sendRequest(
    model: string,
    messages: ChatMessage[],
    options?: ChatOptions
  ): Promise<ChatResponse> {
    const { systemPrompt } = this.adapter.splitMessages(messages);

    const requestBody = this.adapter.buildRequest({
      model,
      messages,
      tools: options?.tools,
      systemPrompt,
      maxTokens: options?.maxTokens || 4096,
      temperature: options?.temperature,
    });

    const response = (await this.anthropic.messages.create(
      requestBody as unknown as Anthropic.MessageCreateParams
    )) as unknown as Record<string, unknown>;

    return this.adapter.toChatResponse(
      this.adapter.normalizeResponse(response),
      model
    );
  }
}
