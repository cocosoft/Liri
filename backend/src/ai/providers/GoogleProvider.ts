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

const logger = new Logger({ level: LogLevel.INFO });

const SUPPORTED_MODELS = [
  'gemini-2.5-pro',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-pro',
  'gemini-1.5-flash',
];

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

function mapToGeminiMessages(messages: ChatMessage[]): {
  contents: { role: string; parts: { text: string }[] }[];
  systemInstruction?: { parts: { text: string }[] };
} {
  const systemMessages = messages.filter((m) => m.role === 'system');
  const nonSystemMessages = messages.filter((m) => m.role !== 'system');

  const systemInstruction =
    systemMessages.length > 0
      ? { parts: systemMessages.map((m) => ({ text: m.content })) }
      : undefined;

  const contents = nonSystemMessages.map((msg) => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }],
  }));

  return { contents, systemInstruction };
}

function parseGeminiResponse(
  data: Record<string, unknown>,
  model: string
): ChatResponse {
  const candidate = (data.candidates as Record<string, unknown>[])?.[0];
  const content = candidate?.content as Record<string, unknown> | undefined;
  const parts = content?.parts as Record<string, unknown>[] | undefined;
  const text = parts?.map((p) => p.text as string).join('') ?? '';
  const finishReason = (candidate?.finishReason as string) ?? 'STOP';
  const usageMetadata = data.usageMetadata as
    | Record<string, number>
    | undefined;

  const stopReason =
    finishReason === 'STOP'
      ? 'stop'
      : finishReason === 'MAX_TOKENS'
        ? 'max_tokens'
        : 'stop';

  return {
    content: text,
    model: model,
    stop_reason: stopReason,
    usage: usageMetadata
      ? {
          prompt_tokens: usageMetadata.promptTokenCount ?? 0,
          completion_tokens: usageMetadata.candidatesTokenCount ?? 0,
          total_tokens: usageMetadata.totalTokenCount ?? 0,
        }
      : undefined,
  };
}

export class GoogleProvider implements AIProvider {
  readonly id = 'google';
  readonly displayName = 'Google Gemini';
  private apiKey: string;
  private baseUrl: string;

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey || process.env.GOOGLE_API_KEY || '';
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
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
    const { contents, systemInstruction } = mapToGeminiMessages(messages);

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: options?.maxTokens || 4096,
      },
    };

    if (options?.temperature !== undefined) {
      (body.generationConfig as Record<string, unknown>).temperature =
        options.temperature;
    }

    if (systemInstruction) {
      body.systemInstruction = systemInstruction;
    }

    const url = `${this.baseUrl}/models/${model}:generateContent?key=${this.apiKey}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
      return parseGeminiResponse(data, model);
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
    const { contents, systemInstruction } = mapToGeminiMessages(messages);

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: options?.maxTokens || 4096,
      },
    };

    if (options?.temperature !== undefined) {
      (body.generationConfig as Record<string, unknown>).temperature =
        options.temperature;
    }

    if (systemInstruction) {
      body.systemInstruction = systemInstruction;
    }

    const url = `${this.baseUrl}/models/${model}:streamGenerateContent?alt=sse&key=${this.apiKey}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
    try {
      const url = `${this.baseUrl}/models?key=${this.apiKey}&pageSize=100`;
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) return [...SUPPORTED_MODELS];

      const data = (await response.json()) as {
        models?: { name: string }[];
      };
      return (
        data.models
          ?.map((m) => m.name.replace('models/', ''))
          .filter((name) => name.includes('gemini')) ?? [...SUPPORTED_MODELS]
      );
    } catch {
      return [...SUPPORTED_MODELS];
    }
  }

  validateConfig(config: ProviderConfig): ProviderValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!config.apiKey && !process.env.GOOGLE_API_KEY) {
      errors.push('API key is required (config.apiKey or GOOGLE_API_KEY)');
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
