import Anthropic from '@anthropic-ai/sdk';
import type {
  ChatMessage,
  ChatResponse,
  ToolDefinition,
  LLMConfig,
} from '../models/types';
import type { ThinkingConfig } from '../clients/thinking';
import type {
  AIProvider,
  ProviderConfig,
  ProviderValidationResult,
  ChatOptions,
} from './AIProvider';
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
import {
  isCacheSupported,
  calculateBreakpoints,
  shouldPlaceSystemBreakpoint,
  shouldPlaceBreakpoint,
  shouldPlaceToolsBreakpoint,
  createCacheControl,
  DEFAULT_CACHE_CONFIG,
} from '../clients/PromptCacheConfig';

const logger = new Logger({ level: LogLevel.INFO });

const SUPPORTED_MODELS = [
  'claude-opus-4-6',
  'claude-opus-4-5-20251101',
  'claude-sonnet-4-6',
  'claude-sonnet-4-5-20250929',
  'claude-haiku-4-5-20251001',
  'claude-3-5-sonnet-20241022',
  'claude-3-5-haiku-20241022',
];

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
  private toolRegistry: unknown = null;
  private toolExecutor: unknown = null;

  constructor(config: ProviderConfig) {
    const apiKey =
      (config.apiKey as string) || process.env.ANTHROPIC_API_KEY || '';
    const baseUrl = (config.baseUrl as string) || 'https://api.anthropic.com';

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
  }

  setToolRegistry(registry: unknown): void {
    this.toolRegistry = registry;
  }

  setToolExecutor(executor: unknown): void {
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
    return [...SUPPORTED_MODELS];
  }

  validateConfig(config: ProviderConfig): ProviderValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!config.apiKey && !process.env.ANTHROPIC_API_KEY) {
      errors.push('API key is required (config.apiKey or ANTHROPIC_API_KEY)');
    }

    if (config.model && !SUPPORTED_MODELS.includes(config.model)) {
      warnings.push(
        `Unknown model: ${config.model}. Supported: ${SUPPORTED_MODELS.join(', ')}`
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
    const systemMessages = messages.filter((m) => m.role === 'system');
    const nonSystemMessages = messages.filter((m) => m.role !== 'system');
    const systemPrompt = systemMessages.map((m) => m.content).join('\n');

    const cacheSupported = isCacheSupported(model);
    const breakpoints = cacheSupported
      ? calculateBreakpoints(nonSystemMessages.length, DEFAULT_CACHE_CONFIG)
      : [];

    const systemBlock = systemPrompt
      ? [
          {
            type: 'text' as const,
            text: systemPrompt,
            ...(shouldPlaceSystemBreakpoint(breakpoints)
              ? { cache_control: createCacheControl() }
              : {}),
          },
        ]
      : undefined;

    const formattedMessages = nonSystemMessages.map((m, index) => ({
      role: m.role as 'user' | 'assistant',
      content: shouldPlaceBreakpoint(index, breakpoints)
        ? [
            {
              type: 'text' as const,
              text: m.content,
              cache_control: createCacheControl(),
            },
          ]
        : m.content,
    }));

    const formattedTools = options?.tools
      ? (options.tools as unknown as Anthropic.Tool[]).map((tool, index) => {
          const isLast =
            index === (options.tools as unknown as Anthropic.Tool[]).length - 1;
          if (isLast && shouldPlaceToolsBreakpoint(breakpoints)) {
            return { ...tool, cache_control: createCacheControl() };
          }
          return tool;
        })
      : undefined;

    const stream = (await this.anthropic.messages.create({
      model,
      max_tokens: options?.maxTokens || 4096,
      temperature: options?.temperature,
      system: systemBlock,
      messages: formattedMessages,
      tools: formattedTools,
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
    const systemMessages = messages.filter((m) => m.role === 'system');
    const nonSystemMessages = messages.filter((m) => m.role !== 'system');
    const systemPrompt = systemMessages.map((m) => m.content).join('\n');

    const cacheSupported = isCacheSupported(model);
    const breakpoints = cacheSupported
      ? calculateBreakpoints(nonSystemMessages.length, DEFAULT_CACHE_CONFIG)
      : [];

    const systemBlock = systemPrompt
      ? [
          {
            type: 'text' as const,
            text: systemPrompt,
            ...(shouldPlaceSystemBreakpoint(breakpoints)
              ? { cache_control: createCacheControl() }
              : {}),
          },
        ]
      : undefined;

    const formattedMessages = nonSystemMessages.map((m, index) => ({
      role: m.role as 'user' | 'assistant',
      content: shouldPlaceBreakpoint(index, breakpoints)
        ? [
            {
              type: 'text' as const,
              text: m.content,
              cache_control: createCacheControl(),
            },
          ]
        : m.content,
    }));

    const formattedTools = options?.tools
      ? (options.tools as unknown as Anthropic.Tool[]).map((tool, index) => {
          const isLast =
            index === (options.tools as unknown as Anthropic.Tool[]).length - 1;
          if (isLast && shouldPlaceToolsBreakpoint(breakpoints)) {
            return { ...tool, cache_control: createCacheControl() };
          }
          return tool;
        })
      : undefined;

    const response = (await this.anthropic.messages.create({
      model,
      max_tokens: options?.maxTokens || 4096,
      temperature: options?.temperature,
      system: systemBlock,
      messages: formattedMessages,
      tools: formattedTools,
    } as Anthropic.MessageCreateParams)) as unknown as {
      model: string;
      stop_reason: string;
      content: Array<{
        type: string;
        text?: string;
        id?: string;
        name?: string;
        input?: Record<string, unknown>;
      }>;
      usage?: {
        input_tokens: number;
        output_tokens: number;
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
      };
    };

    const contentBlocks = response.content;

    const content = contentBlocks
      .filter((c) => c.type === 'text')
      .map((c) => c.text || '')
      .join('');

    const toolUseBlocks = contentBlocks
      .filter((c) => c.type === 'tool_use')
      .map((c) => ({
        id: c.id as string,
        name: c.name as string,
        arguments: c.input || {},
      }));

    const rawUsage = response.usage;

    return {
      content,
      model: response.model,
      stop_reason:
        response.stop_reason === 'end_turn'
          ? 'stop'
          : response.stop_reason === 'tool_use'
            ? 'tool_calls'
            : response.stop_reason === 'max_tokens'
              ? 'max_tokens'
              : 'stop',
      usage: {
        prompt_tokens: rawUsage?.input_tokens || 0,
        cache_read_input_tokens: rawUsage?.cache_read_input_tokens || 0,
        cache_creation_input_tokens: rawUsage?.cache_creation_input_tokens || 0,
        completion_tokens: rawUsage?.output_tokens || 0,
        total_tokens:
          (rawUsage?.input_tokens || 0) + (rawUsage?.output_tokens || 0),
      },
      tool_calls: toolUseBlocks.length > 0 ? toolUseBlocks : undefined,
    };
  }
}
