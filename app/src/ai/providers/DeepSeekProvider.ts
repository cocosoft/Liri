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
import type { IToolExecutor, ToolRegistry } from '../interfaces/ToolExecutor';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { ChatCompletionsTransport } from '../transports/ChatCompletionsTransport';
import { TransportProviderAdapter } from '../transports/TransportProviderAdapter';
import { ALL_MODEL_CONFIGS, getModelsByProvider } from '../models/ModelConfigs';
import { ModelRegistry } from '../models/ModelRegistry';

const logger = new Logger({ level: LogLevel.INFO });

const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_MODEL = '';

export class DeepSeekProvider implements AIProvider {
  readonly id = 'deepseek';
  readonly displayName = 'DeepSeek';
  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;
  private toolRegistry: ToolRegistry | null = null;
  private toolExecutor: IToolExecutor | null = null;
  private readonly adapter: TransportProviderAdapter;

  /**
   * 初始化 Provider 实例，配置 API 密钥、基础 URL、默认模型及传输适配器。
   *
   * @param config - 提供者配置对象，包含可选的 apiKey、baseUrl 和 model 字段。
   */
  constructor(config: ProviderConfig) {
    const registry = ModelRegistry.getInstance();
    const providerCfg = registry.getProviderConfig('deepseek');

    this.apiKey =
      providerCfg?.apiKey ||
      config.apiKey ||
      process.env.DEEPSEEK_API_KEY ||
      '';

    this.baseUrl = (
      providerCfg?.baseUrl ||
      config.baseUrl ||
      process.env.DEEPSEEK_BASE_URL ||
      DEFAULT_BASE_URL
    ).replace(/\/+$/, '');

    // 设置默认模型，优先使用配置中的模型，否则使用默认模型
    this.defaultModel = (config.model as string) || DEFAULT_MODEL;

    // 初始化传输适配器，使用聊天完成传输协议
    this.adapter = new TransportProviderAdapter(new ChatCompletionsTransport());
  }

  setApiKey(key: string): void {
    if (key) {
      this.apiKey = key;
      logger.info('DeepSeek API key updated');
    }
  }

  /**
   * 设置工具注册表实例。
   * @param registry - 要设置的工具注册表实例，若为 null 则清除当前注册表。
   */
  setToolRegistry(registry: ToolRegistry | null): void {
    this.toolRegistry = registry;
  }

  setToolExecutor(executor: IToolExecutor | null): void {
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
    let lastUsage: ChatResponse['usage'] | undefined;

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

            // 提取 usage 字段（通常在流式响应的最后一个 chunk 中出现）
            const usage = parsed['usage'] as ChatResponse['usage'] | undefined;
            if (usage) {
              lastUsage = usage;
            }

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
        usage: lastUsage,
      };
    }

    return {
      content: fullContent,
      stop_reason: stopReason,
      usage: lastUsage,
    };
  }

  async listModels(): Promise<string[]> {
    return getModelsByProvider('deepseek').map(
      (key) => ALL_MODEL_CONFIGS[key].deepseek
    );
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
