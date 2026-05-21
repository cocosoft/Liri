/**
 * DeepSeek AI Provider
 * 真实 API 调用 — 从 clients/DeepSeekClient.ts 迁移
 */

import type {
  ChatMessage,
  ChatResponse,
  ToolDefinition,
} from '../models/types';
import type {
  ChatOptions,
  AIProvider,
  ProviderConfig,
  ProviderValidationResult,
} from './AIProvider';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { ChatCompletionsTransport } from '../transports/ChatCompletionsTransport';
import { TransportProviderAdapter } from '../transports/TransportProviderAdapter';

const logger = new Logger({ level: LogLevel.INFO });

const SUPPORTED_MODELS = ['deepseek-chat', 'deepseek-reasoner'];
const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-chat';

export class DeepSeekProvider implements AIProvider {
  readonly id = 'deepseek';
  readonly displayName = 'DeepSeek';
  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;
  private toolRegistry: unknown = null;
  private toolExecutor: unknown = null;
  private readonly adapter: TransportProviderAdapter;

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey || process.env.DEEPSEEK_API_KEY || '';
    this.baseUrl = (
      config.baseUrl ||
      process.env.DEEPSEEK_BASE_URL ||
      DEFAULT_BASE_URL
    ).replace(/\/+$/, '');
    this.defaultModel = (config.model as string) || DEFAULT_MODEL;
    this.adapter = new TransportProviderAdapter(new ChatCompletionsTransport());
  }

  setToolRegistry(registry: unknown): void {
    this.toolRegistry = registry;
  }

  setToolExecutor(executor: unknown): void {
    this.toolExecutor = executor;
  }

  supportsThinking(_model: string): boolean {
    return false;
  }

  async chat(
    messages: ChatMessage[],
    options?: ChatOptions
  ): Promise<ChatResponse> {
    const model = options?.model || this.defaultModel;

    const requestBody = this.adapter.buildRequest({
      model,
      messages,
      tools: options?.tools,
      maxTokens: options?.maxTokens || 4096,
      temperature: options?.temperature ?? 0.7,
    });

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new AppError(
        `DeepSeek API error: ${response.status} - ${errorText}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const data = (await response.json()) as Record<string, unknown>;
    return this.adapter.toChatResponse(this.adapter.normalizeResponse(data));
  }

  async *chatStream(
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncGenerator<string, ChatResponse, unknown> {
    const model = options?.model || this.defaultModel;

    const requestBody = this.adapter.buildRequest({
      model,
      messages,
      tools: options?.tools,
      maxTokens: options?.maxTokens || 4096,
      temperature: options?.temperature ?? 0.7,
      stream: true,
    });

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new AppError(
        `DeepSeek API error: ${response.status} - ${errorText}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    if (!response.body) {
      throw new AppError(
        'Response body is null',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';
    let stopReason: 'stop' | 'tool_calls' | 'max_tokens' = 'stop';
    // 流式 tool_calls 按 index 累积: {arguments 为累积字符串}
    const pendingToolCalls: Map<
      number,
      { id: string; name: string; arguments: string }
    > = new Map();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk
          .split('\n')
          .filter((line) => line.startsWith('data: '));

        for (const line of lines) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data) as Record<string, unknown>;
            const choices = parsed['choices'] as
              | Array<Record<string, unknown>>
              | undefined;
            const choice = choices?.[0];
            if (!choice) continue;

            // 检测 finish_reason
            const finishReason = choice['finish_reason'] as string | undefined;
            if (finishReason === 'tool_calls') {
              stopReason = 'tool_calls';
            } else if (finishReason === 'max_tokens') {
              stopReason = 'max_tokens';
            }

            const delta = choice['delta'] as
              | Record<string, unknown>
              | undefined;
            if (!delta) continue;

            // 处理文本内容
            const content = delta?.['content'] as string | undefined;
            if (content) {
              fullContent += content;
              yield content;
            }

            // 处理流式 tool_calls
            const streamToolCalls = delta?.['tool_calls'] as
              | Array<Record<string, unknown>>
              | undefined;
            if (streamToolCalls) {
              for (const tc of streamToolCalls) {
                const idx = tc['index'] as number;
                let pending = pendingToolCalls.get(idx);
                if (!pending) {
                  pending = { id: '', name: '', arguments: '' };
                  pendingToolCalls.set(idx, pending);
                }
                // id 和 name 只在首帧出现
                if (tc['id']) {
                  pending.id = tc['id'] as string;
                }
                const func = tc['function'] as
                  | Record<string, unknown>
                  | undefined;
                if (func) {
                  if (func['name']) {
                    pending.name = func['name'] as string;
                  }
                  if (func['arguments']) {
                    pending.arguments += func['arguments'] as string;
                  }
                }
              }
            }
          } catch {
            // 跳过解析失败的行
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // 组装 tool_calls 返回（若存在）
    if (stopReason === 'tool_calls' && pendingToolCalls.size > 0) {
      const toolCalls = Array.from(pendingToolCalls.entries())
        .sort(([a], [b]) => a - b)
        .map(([_, tc]) => {
          let parsedArgs: Record<string, unknown> = {};
          try {
            parsedArgs = JSON.parse(tc.arguments) as Record<string, unknown>;
          } catch {
            parsedArgs = { _raw: tc.arguments };
          }
          return {
            id: tc.id,
            name: tc.name,
            arguments: parsedArgs,
          };
        });
      return {
        content: fullContent,
        stop_reason: 'tool_calls',
        tool_calls: toolCalls,
      };
    }

    return { content: fullContent, stop_reason: stopReason };
  }

  async listModels(): Promise<string[]> {
    return [...SUPPORTED_MODELS];
  }

  validateConfig(config: ProviderConfig): ProviderValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!this.apiKey && !config.apiKey && !process.env.DEEPSEEK_API_KEY) {
      errors.push('API key is required (config.apiKey or DEEPSEEK_API_KEY)');
    }
    return { valid: errors.length === 0, errors, warnings };
  }
}
