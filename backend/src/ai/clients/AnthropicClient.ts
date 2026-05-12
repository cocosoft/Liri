//
/**
 * Anthropic API 客户端（基于CC源码 claude.ts 模式）
 * 扩展 LLMClient 基类，添加生产级功能
 */
import Anthropic from '@anthropic-ai/sdk';
import { LLMClient } from './LLMClient';
import type {
  ChatMessage,
  ChatResponse,
  ToolDefinition,
} from '../models/types';
import type { ThinkingConfig } from './thinking';
import {
  withRetry,
  is529Error,
  isTransientCapacityError,
  isStaleConnectionError,
  MAX_529_RETRIES,
  BASE_DELAY_MS,
  categorizeAPIError,
  type RetryConfig,
} from '@modules/query/withRetry';
import { feature } from '@modules/core';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

export type APIProvider = 'anthropic' | 'bedrock' | 'vertex' | 'custom';

export type CacheScope = 'global' | 'org';

export const BETA_HEADERS = {
  PROMPT_CACHING: 'prompt-caching-2024-07-24',
  STRUCTURED_OUTPUTS: 'structured-outputs-2024-08-01',
  FAST_MODE: 'fast-mode-2025-01-15',
  CONTEXT_1M: 'context-1m-2025-03-01',
  TASK_BUDGETS: 'task-budgets-2026-03-13',
} as const;

export class AnthropicClient extends LLMClient {
  private provider: APIProvider = 'anthropic';
  private retryConfig: RetryConfig;
  private consecutive529Errors: number = 0;
  private anthropic: Anthropic;

  constructor(config: any) {
    super(config);
    this.retryConfig = {
      maxRetries: 10,
      initialDelayMs: BASE_DELAY_MS,
      maxDelayMs: 60000,
      jitterFactor: 0.1,
    };
    this.anthropic = new Anthropic({
      apiKey: config.apiKey || process.env.ANTHROPIC_API_KEY || '',
      baseURL: config.baseUrl || 'https://api.anthropic.com',
      maxRetries: 2,
      timeout: config.timeout || 120000,
    });
  }

  getAPIProvider(): APIProvider {
    return this.provider;
  }

  setAPIProvider(provider: APIProvider): void {
    this.provider = provider;
  }

  supportsStructuredOutputs(model: string): boolean {
    return model.includes('claude-sonnet-4') || model.includes('opus-4');
  }

  getCacheScope(): CacheScope {
    return feature('KAIROS') ? 'org' : 'global';
  }

  async preconnect(): Promise<void> {
    this.retryConfig.maxRetries = 2;
    this.retryConfig.initialDelayMs = 100;
    try {
      const response = await fetch(
        this.config.baseUrl || 'https://api.anthropic.com',
        {
          method: 'HEAD',
          signal: AbortSignal.timeout(5000),
        }
      );
    } catch {
      // 预连接失败不影响主流程
    }
  }

  notifyCompaction(): void {
    this.consecutive529Errors = 0;
  }

  private getBetas(model: string): string[] {
    const betas: string[] = [BETA_HEADERS.PROMPT_CACHING];
    if (this.supportsStructuredOutputs(model)) {
      betas.push(BETA_HEADERS.STRUCTURED_OUTPUTS);
    }
    return betas;
  }

  async chat(
    messages: ChatMessage[],
    options?: {
      tools?: ToolDefinition[];
      model?: string;
      maxTokens?: number;
      temperature?: number;
      thinking?: ThinkingConfig;
    }
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
      (error, attempt, delay) => {
        if (is529Error(error)) {
          this.consecutive529Errors++;
        }
      }
    );
  }

  async *chatStream(
    messages: ChatMessage[],
    options?: {
      tools?: ToolDefinition[];
      model?: string;
      maxTokens?: number;
      temperature?: number;
      thinking?: ThinkingConfig;
    }
  ): AsyncGenerator<string, ChatResponse, unknown> {
    const model = options?.model || this.config.model || 'claude-sonnet-4-6';
    let finalResponse: ChatResponse = {
      content: '',
      model,
      stop_reason: 'stop',
      usage: {
        prompt_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
    };

    for await (const chunk of this.streamRequest(model, messages, options)) {
      finalResponse.content += chunk;
      yield chunk;
    }

    return finalResponse;
  }

  private async sendRequest(
    model: string,
    messages: ChatMessage[],
    options?: any
  ): Promise<ChatResponse> {
    const systemMessages = messages.filter((m) => m.role === 'system');
    const nonSystemMessages = messages.filter((m) => m.role !== 'system');

    const systemPrompt = systemMessages.map((m) => m.content).join('\n');

    const response = await this.anthropic.messages.create({
      model,
      max_tokens: options?.maxTokens || 4096,
      temperature: options?.temperature,
      system: systemPrompt || undefined,
      messages: nonSystemMessages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      tools: options?.tools?.map((t: any) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema || { type: 'object', properties: {} },
      })),
    });

    const content = response.content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('');

    const toolUseBlocks = response.content
      .filter((c: any) => c.type === 'tool_use')
      .map((c: any) => ({
        id: c.id,
        name: c.name,
        arguments: c.input || {},
      }));

    const stopReason =
      response.stop_reason === 'end_turn'
        ? 'stop'
        : response.stop_reason === 'tool_use'
          ? 'tool_calls'
          : response.stop_reason === 'max_tokens'
            ? 'max_tokens'
            : 'stop';

    return {
      content,
      model: response.model,
      stop_reason: stopReason,
      usage: {
        prompt_tokens: response.usage?.input_tokens || 0,
        cache_read_input_tokens:
          (response.usage as any)?.cache_read_input_tokens || 0,
        cache_creation_input_tokens:
          (response.usage as any)?.cache_creation_input_tokens || 0,
        completion_tokens: response.usage?.output_tokens || 0,
        total_tokens:
          (response.usage?.input_tokens || 0) +
          (response.usage?.output_tokens || 0),
      },
      tool_calls: toolUseBlocks.length > 0 ? toolUseBlocks : undefined,
    };
  }

  private async *streamRequest(
    model: string,
    messages: ChatMessage[],
    options?: any
  ): AsyncGenerator<string> {
    const systemMessages = messages.filter((m) => m.role === 'system');
    const nonSystemMessages = messages.filter((m) => m.role !== 'system');

    const systemPrompt = systemMessages.map((m) => m.content).join('\n');

    const stream = await this.anthropic.messages.create({
      model,
      max_tokens: options?.maxTokens || 4096,
      temperature: options?.temperature,
      system: systemPrompt || undefined,
      messages: nonSystemMessages.map((m: any) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      tools: options?.tools?.map((t: any) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema || { type: 'object', properties: {} },
      })),
      stream: true,
    });

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta?.type === 'text_delta'
      ) {
        yield event.delta.text;
      }
    }
  }
}
