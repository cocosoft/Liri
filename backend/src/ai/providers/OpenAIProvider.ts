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

const logger = new Logger({ level: LogLevel.INFO });

const SUPPORTED_MODELS = [
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4-turbo',
  'gpt-4',
  'gpt-3.5-turbo',
];

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

export class OpenAIProvider implements AIProvider {
  readonly id = 'openai';
  readonly displayName = 'OpenAI';
  private apiKey: string;
  private baseUrl: string;
  private readonly adapter: TransportProviderAdapter;

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY || '';
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
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
            const choice = (parsed.choices as Record<string, unknown>[])?.[0];
            const delta = choice?.delta as Record<string, unknown> | undefined;
            const content = delta?.content as string | undefined;
            if (content) {
              yield content;
            }
          } catch {
            // skip malformed SSE lines
          }
        }
      }

      return {
        content: '',
        model: options?.model || 'gpt-4o',
        stop_reason: 'stop',
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
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) return [...SUPPORTED_MODELS];

      const data = (await response.json()) as { data?: { id: string }[] };
      return (
        data.data?.map((m) => m.id).filter((id) => id.includes('gpt')) ?? [
          ...SUPPORTED_MODELS,
        ]
      );
    } catch {
      return [...SUPPORTED_MODELS];
    }
  }

  validateConfig(config: ProviderConfig): ProviderValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!config.apiKey && !process.env.OPENAI_API_KEY) {
      errors.push('API key is required (config.apiKey or OPENAI_API_KEY)');
    }

    if (config.model && !SUPPORTED_MODELS.includes(config.model)) {
      warnings.push(
        `Unknown model: ${config.model}. Supported: ${SUPPORTED_MODELS.join(', ')}`
      );
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
}
