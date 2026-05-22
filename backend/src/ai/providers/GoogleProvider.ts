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
import { GeminiTransport } from '../transports/GeminiTransport';
import { TransportProviderAdapter } from '../transports/TransportProviderAdapter';
import { ALL_MODEL_CONFIGS, getModelsByProvider } from '../models/ModelConfigs';

const logger = new Logger({ level: LogLevel.INFO });

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export class GoogleProvider implements AIProvider {
  readonly id = 'google';
  readonly displayName = 'Google Gemini';
  private apiKey: string;
  private baseUrl: string;
  private readonly adapter: TransportProviderAdapter;

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey || process.env.GOOGLE_API_KEY || '';
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.adapter = new TransportProviderAdapter(new GeminiTransport());
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
    const model = options?.model || 'gemini-2.0-flash';
    const { systemPrompt } = this.adapter.splitMessages(messages);

    const requestBody = this.adapter.buildRequest({
      model,
      messages,
      tools: options?.tools,
      systemPrompt,
      maxTokens: options?.maxTokens || 4096,
      temperature: options?.temperature,
    });

    const url = `${this.baseUrl}/models/${model}:generateContent?key=${this.apiKey}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(120000),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new AppError(
          `Gemini API error (${response.status}): ${errorBody}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }

      const data = (await response.json()) as Record<string, unknown>;
      return this.adapter.toChatResponse(
        this.adapter.normalizeResponse(data),
        model
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        `Gemini chat failed: ${(error as Error).message}`,
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
    const model = options?.model || 'gemini-2.0-flash';
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

    const url = `${this.baseUrl}/models/${model}:streamGenerateContent?alt=sse&key=${this.apiKey}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(180000),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new AppError(
          `Gemini stream error (${response.status}): ${errorBody}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new AppError(
          'Gemini stream: no response body',
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

          const jsonStr = trimmed.slice(6);
          try {
            const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
            const candidate = (
              parsed.candidates as Record<string, unknown>[]
            )?.[0];
            const content = candidate?.content as
              | Record<string, unknown>
              | undefined;
            const parts = content?.parts as
              | Record<string, unknown>[]
              | undefined;
            const text = parts?.map((p) => p.text as string).join('') ?? '';
            if (text) {
              yield text;
            }
          } catch {
            // skip malformed SSE lines
          }
        }
      }

      return {
        content: '',
        model,
        stop_reason: 'stop',
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        `Gemini stream error: ${(error as Error).message}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
  }

  async listModels(): Promise<string[]> {
    const supportedModels = getModelsByProvider('google').map(
      (key) => ALL_MODEL_CONFIGS[key].google
    );
    try {
      const url = `${this.baseUrl}/models?key=${this.apiKey}&pageSize=100`;
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) return supportedModels;

      const data = (await response.json()) as {
        models?: { name: string }[];
      };
      return (
        data.models
          ?.map((m) => m.name.replace('models/', ''))
          .filter((name) => name.includes('gemini')) ?? supportedModels
      );
    } catch {
      return supportedModels;
    }
  }

  validateConfig(config: ProviderConfig): ProviderValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!config.apiKey && !process.env.GOOGLE_API_KEY) {
      errors.push('API key is required (config.apiKey or GOOGLE_API_KEY)');
    }

    const supportedModels = getModelsByProvider('google').map(
      (key) => ALL_MODEL_CONFIGS[key].google
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
}
