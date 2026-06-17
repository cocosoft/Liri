/**
 * Ollama (Local) 提供商
 * Ollama /api/chat 格式
 */
import type {
  ChatMessage,
  ChatResponse,
  ToolDefinition,
} from '../models/types';
import type { ProviderConfig, ProviderValidationResult } from './AIProvider';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { configManager } from '@modules/config';
import { OllamaTransport } from '../transports/OllamaTransport';
import { TransportProviderAdapter } from '../transports/TransportProviderAdapter';
import { ALL_MODEL_CONFIGS, getModelsByProvider } from '../models/ModelConfigs';
import { BaseAIProvider, type BaseProviderOptions } from './BaseAIProvider';

const logger = new Logger({ level: LogLevel.INFO });

const DEFAULT_BASE_URL = 'http://localhost:11434';

export class OllamaProvider extends BaseAIProvider {
  private baseUrl: string;
  private timeout: number;
  private cachedModels: string[] | null = null;

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
    const model = this.resolveModel('chat', options);
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
  ): AsyncGenerator<string, ChatResponse, unknown> {
    const model = this.resolveModel('chat', options);
    const temperature = options?.temperature ?? 0.7;
    const maxTokens = options?.maxTokens || 2048;

    const requestBody = this.transport!.buildRequest({
      model,
      messages,
      maxTokens,
      temperature,
      stream: true,
    });

    try {
      // 使用带连接重试的 fetch，应对 API 网关偶发断连
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

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const parsed = JSON.parse(trimmed) as Record<string, unknown>;
            const message = parsed.message as
              | Record<string, unknown>
              | undefined;
            const content = message?.content as string;
            if (content) {
              yield content;
            }
            if (parsed.done) break;
          } catch {
            // skip malformed lines
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
        `Ollama stream error: ${(error as Error).message}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
  }

  async listModels(): Promise<string[]> {
    if (this.cachedModels) return this.cachedModels;

    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });

      if (!response.ok) return [];

      const data = (await response.json()) as { models?: { name: string }[] };
      this.cachedModels = (data.models || []).map((m) => m.name);
      return this.cachedModels;
    } catch {
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
    } catch {
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
    const model = this.resolveModel('chat', options);
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
