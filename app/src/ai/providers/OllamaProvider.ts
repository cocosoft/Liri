/**
 * Ollama (Local) 提供商
 * Ollama /api/chat 格式
 */
import type {
  ChatMessage,
  ChatResponse,
  ParsedToolCall,
  ToolDefinition,
} from '../models/types';
import type {
  ProviderConfig,
  ProviderValidationResult,
  ThinkingProviderChunk,
} from './AIProvider';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { getLogger } from '@modules/monitoring';
import { configManager } from '@modules/config';
import { OllamaTransport } from '../transports/OllamaTransport';
import { TransportProviderAdapter } from '../transports/TransportProviderAdapter';
import { ALL_MODEL_CONFIGS, getModelsByProvider } from '../models/ModelConfigs';
import { BaseAIProvider, type BaseProviderOptions } from './BaseAIProvider';

const logger = getLogger('ai:ollama');

const DEFAULT_BASE_URL = 'http://localhost:11434';

export class OllamaProvider extends BaseAIProvider {
  private baseUrl: string;
  private timeout: number;
  private cachedModels: string[] | null = null;
  /** 模型列表缓存时间戳（TTL 过期后重新拉取，避免 pull/删除模型后列表永不刷新） */
  private cachedModelsAt = 0;
  private static readonly MODELS_TTL_MS = 30_000;

  /**
   * 初始化 Ollama Provider。
   * Ollama 为本地服务，无需 API Key。
   *
   * @param options - 基础选项
   * @param _extraConfig - 扩展配置
   */
  constructor(
    options: BaseProviderOptions,
    _extraConfig?: Record<string, unknown>
  ) {
    super(options, _extraConfig);

    this.baseUrl = (this.resolveBaseUrl() || DEFAULT_BASE_URL).replace(
      /\/+$/,
      ''
    );
    this.timeout = parseInt(configManager.env('OLLAMA_TIMEOUT') || '30000', 10);

    if (!this.transport) {
      this.transport = new TransportProviderAdapter(new OllamaTransport());
    }
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
    // 耗时统计：委托 BaseAIProvider.measureChat（2026-08-16）
    return BaseAIProvider.measureChat('Ollama', () =>
      this.chatInternal(messages, options)
    );
  }

  private async chatInternal(
    messages: ChatMessage[],
    options?: {
      tools?: ToolDefinition[];
      model?: string;
      maxTokens?: number;
      temperature?: number;
    }
  ): Promise<ChatResponse> {
    const model = await this.resolveModel('chat', options);
    const temperature = options?.temperature ?? 0.7;
    const maxTokens = options?.maxTokens || 2048;

    const requestBody = this.transport!.buildRequest({
      model,
      messages,
      tools: options?.tools,
      maxTokens,
      temperature,
      stream: false,
    });

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        throw new AppError(
          `Ollama chat failed (${response.status}): ${response.statusText}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }

      const data = (await response.json()) as Record<string, unknown>;
      return this.transport!.toChatResponse(
        this.transport!.normalizeResponse(data)
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        `Ollama chat error: ${(error as Error).message}`,
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
  ): AsyncGenerator<string | ThinkingProviderChunk, ChatResponse, unknown> {
    // 流式耗时统计：委托 BaseAIProvider.wrapChatStreamMeasure（2026-08-16）
    return yield* BaseAIProvider.wrapChatStreamMeasure(
      'Ollama',
      this.chatStreamInternal(messages, options)
    );
  }

  private async *chatStreamInternal(
    messages: ChatMessage[],
    options?: {
      tools?: ToolDefinition[];
      model?: string;
      maxTokens?: number;
      temperature?: number;
    }
  ): AsyncGenerator<string | ThinkingProviderChunk, ChatResponse, unknown> {
    const model = await this.resolveModel('chat', options);
    const temperature = options?.temperature ?? 0.7;
    const maxTokens = options?.maxTokens || 2048;

    // Y1 修复: 传递 tools 到请求体
    const requestBody = this.transport!.buildRequest({
      model,
      messages,
      tools: options?.tools,
      maxTokens,
      temperature,
      stream: true,
    });

    try {
      const response = await BaseAIProvider.fetchWithConnectionRetry(
        `${this.baseUrl}/api/chat`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(this.timeout * 2),
        }
      );

      if (!response.ok) {
        throw new AppError(
          `Ollama stream failed (${response.status}): ${response.statusText}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new AppError(
          'Ollama stream: no response body',
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }

      const decoder = new TextDecoder();
      let buffer = '';
      // Y4 修复: 累积完整内容
      let fullContent = '';
      let lastUsage: ChatResponse['usage'] | undefined;
      const pendingToolCalls = new Map<
        number,
        { id: string; name: string; arguments: string }
      >();
      let stopReason: 'stop' | 'tool_calls' | 'max_tokens' = 'stop';
      let toolCalls: ParsedToolCall[] = [];

      while (true) {
        const { done, value } = await this.readStreamChunkWithTimeout(reader);
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const parsed = JSON.parse(trimmed) as Record<string, unknown>;
            if (parsed.done) break;

            const message = parsed.message as
              | Record<string, unknown>
              | undefined;
            const content = message?.content as string | undefined;
            if (content) {
              fullContent += content;
              yield content;
            }

            // 解析 tool_calls（Ollama 0.3+ 支持）
            const streamToolCalls = message?.tool_calls as
              | Array<Record<string, unknown>>
              | undefined;
            if (streamToolCalls && streamToolCalls.length > 0) {
              stopReason = 'tool_calls';
              toolCalls = streamToolCalls.map((tc) => {
                const func = tc.function as Record<string, unknown> | undefined;
                return {
                  id: (tc.id as string) || `call_${Date.now()}`,
                  name: (func?.name as string) || 'unknown',
                  arguments: func?.arguments
                    ? ((): Record<string, unknown> => {
                        try {
                          return JSON.parse(func.arguments as string) as Record<
                            string,
                            unknown
                          >;
                        } catch {
                          return { _raw: func.arguments };
                        }
                      })()
                    : {},
                };
              });
            }
          } catch (err) {
            // skip malformed lines
          }
        }
      }

      return {
        content: fullContent,
        model,
        stop_reason: stopReason,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        usage: lastUsage,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        `Ollama stream error: ${(error as Error).message}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
  }

  async listModels(): Promise<string[]> {
    if (
      this.cachedModels &&
      Date.now() - this.cachedModelsAt < OllamaProvider.MODELS_TTL_MS
    ) {
      return this.cachedModels;
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });

      if (!response.ok) return [];

      const data = (await response.json()) as { models?: { name: string }[] };
      this.cachedModels = (data.models || []).map((m) => m.name);
      this.cachedModelsAt = Date.now();
      return this.cachedModels;
    } catch (err) {
      return [];
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch (err) {
      return false;
    }
  }

  async generate(
    prompt: string,
    options?: {
      model?: string;
      temperature?: number;
      maxTokens?: number;
    }
  ): Promise<{
    model: string;
    response: string;
    done: boolean;
    context?: number[];
    totalDuration?: number;
    loadDuration?: number;
    promptEvalCount?: number;
    evalCount?: number;
  }> {
    const model = await this.resolveModel('chat', options);
    const temperature = options?.temperature ?? 0.7;
    const maxTokens = options?.maxTokens || 2048;

    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
          options: {
            temperature,
            num_predict: maxTokens,
          },
        }),
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        throw new AppError(
          `Ollama generate failed (${response.status}): ${response.statusText}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }

      const data = (await response.json()) as Record<string, unknown>;

      return {
        model: (data.model as string) || model,
        response: (data.response as string) || '',
        done: (data.done as boolean) ?? true,
        context: data.context as number[] | undefined,
        totalDuration: data.total_duration as number | undefined,
        loadDuration: data.load_duration as number | undefined,
        promptEvalCount: data.prompt_eval_count as number | undefined,
        evalCount: data.eval_count as number | undefined,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        `Ollama generate error: ${(error as Error).message}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
  }

  override validateConfig(config: ProviderConfig): ProviderValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!config.baseUrl && !configManager.env('OLLAMA_BASE_URL')) {
      warnings.push(
        'No baseUrl configured, using default: ' + DEFAULT_BASE_URL
      );
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
}
