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
  private cachedModels: string[] | null = null;
  /** 模型列表缓存时间戳（TTL 过期后重新拉取，避免 pull/删除模型后列表永不刷新） */
  private cachedModelsAt = 0;
  private static readonly MODELS_TTL_MS = 30_000;
  /**
   * 已确认不支持工具调用的模型（内存缓存，带 TTL）：此类模型发送 tools 必返回
   * 400 "does not support tools"，命中后直接剥掉 tools 请求，避免每次先失败一次再回退。
   * 值=加入时间戳，TTL 过期后重新探测（模型 pull 更新后能力可能变化）。
   */
  private noToolSupportModels = new Map<string, number>();
  /** 工具不支持缓存有效期（对齐 LlamaCppProvider 的 TOOL_SUPPORT_CACHE_TTL_MS） */
  private static readonly TOOL_SUPPORT_CACHE_TTL_MS = 60_000;

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

  /** 判定 Ollama 400 错误体是否因模型不支持工具调用（"does not support tools"） */
  private isToolUnsupportedError(status: number, body: string): boolean {
    return status === 400 && /does not support tools/i.test(body);
  }

  /**
   * 本地推理超时（毫秒）。
   * 15GB CPU 模型首 token 需数秒~数十秒（warm 后 6.5s，长上下文更久），
   * 原默认 30s（流式 60s）在冷启动/长上下文下会误超时（对齐 LlamaCppProvider 的 600s）。
   * 优先沿用 OLLAMA_TIMEOUT，其次 AI_MODEL_TIMEOUT_MS，默认 600s（10 分钟）。
   */
  protected resolveRequestTimeoutMs(): number {
    const raw =
      configManager.env('OLLAMA_TIMEOUT') ??
      configManager.env('AI_MODEL_TIMEOUT_MS');
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 600_000;
  }

  /** 缓存中是否标记该模型不支持工具调用（TTL 内有效） */
  private isToolUnsupportedCached(model: string): boolean {
    const addedAt = this.noToolSupportModels.get(model);
    if (addedAt === undefined) return false;
    if (Date.now() - addedAt >= OllamaProvider.TOOL_SUPPORT_CACHE_TTL_MS) {
      this.noToolSupportModels.delete(model);
      return false;
    }
    return true;
  }

  /** 记录模型不支持工具调用（TTL 过期后自动失效） */
  private markToolUnsupported(model: string): void {
    this.noToolSupportModels.set(model, Date.now());
  }

  /**
   * 裁剪不支持工具调用的模型：命中缓存后返回 undefined（请求不带 tools）。
   * 未命中缓存或未传 tools 时原样透传。
   */
  private stripUnsupportedTools(
    model: string,
    tools?: ToolDefinition[]
  ): ToolDefinition[] | undefined {
    if (tools && this.isToolUnsupportedCached(model)) {
      return undefined;
    }
    return tools;
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
    const tools = this.stripUnsupportedTools(model, options?.tools);

    const requestBody = this.transport!.buildRequest({
      model,
      messages,
      tools,
      maxTokens,
      temperature,
      stream: false,
    });

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(this.resolveRequestTimeoutMs()),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        // 模型不支持工具调用（400 "does not support tools"）：记录并降级为无 tools 重试一次
        if (tools && this.isToolUnsupportedError(response.status, errorBody)) {
          this.markToolUnsupported(model);
          logger.warn('Ollama 模型不支持工具调用，回退为无 tools 请求', {
            model,
            error: errorBody.slice(0, 200),
          });
          return this.chatInternal(messages, { ...options, tools: undefined });
        }
        // 读取 body 暴露真实错误（原实现仅 statusText，掩盖 "does not support tools" 等详情）
        throw new AppError(
          `Ollama chat failed (${response.status}): ${errorBody || response.statusText}`,
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
    const tools = this.stripUnsupportedTools(model, options?.tools);

    // Y1 修复: 传递 tools 到请求体
    const requestBody = this.transport!.buildRequest({
      model,
      messages,
      tools,
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
          signal: AbortSignal.timeout(this.resolveRequestTimeoutMs()),
        }
      );

      if (!response.ok) {
        const errorBody = await response.text();
        // 模型不支持工具调用（400 "does not support tools"）：记录并降级为无 tools 重试一次
        if (tools && this.isToolUnsupportedError(response.status, errorBody)) {
          this.markToolUnsupported(model);
          logger.warn('Ollama 模型不支持工具调用，回退为无 tools 流式请求', {
            model,
            error: errorBody.slice(0, 200),
          });
          return yield* this.chatStreamInternal(messages, {
            ...options,
            tools: undefined,
          });
        }
        // 读取 body 暴露真实错误（原实现仅 statusText，掩盖 "does not support tools" 等详情）
        throw new AppError(
          `Ollama stream failed (${response.status}): ${errorBody || response.statusText}`,
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

  /**
   * 静态探测模型能力（Ollama GET /api/show）：
   *  - tool_use: 聊天模板含工具槽位（{{.Tools}}/{{.ToolCalls}}/tool_calls 关键字）
   *    —— 实测 qwen3.6-27b 模板无工具槽位 → false，与实际 400 "does not support tools" 一致
   *  - vision: projector_info 存在（多模态投影器存在即支持图像输入）
   * 免费、毫秒级、不消耗推理资源；探测失败返回 unknown（不阻断）。
   */
  async probeCapabilities(model: string): Promise<{
    tool_use: boolean | 'unknown';
    vision: boolean | 'unknown';
  }> {
    try {
      const response = await fetch(`${this.baseUrl}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        logger.debug('Ollama /api/show 探测失败', {
          model,
          status: response.status,
        });
        return { tool_use: 'unknown', vision: 'unknown' };
      }
      const data = (await response.json()) as {
        template?: string;
        projector_info?: unknown;
      };
      const template = data.template || '';
      // 聊天模板含工具变量引用（{{.Tools}} / {{- if .Tools }} / {{.ToolCalls}}）
      // 或 tool_calls 关键字即支持工具调用（工具调用能力由模板决定）
      const toolUse = /\{\{[^}]*\.Tools?\b[^}]*\}\}|ToolCalls|tool_calls/i.test(
        template
      );
      const vision =
        data.projector_info !== undefined && data.projector_info !== null;
      logger.info('Ollama /api/show 能力探测完成', {
        model,
        toolUse,
        vision,
      });
      return { tool_use: toolUse, vision };
    } catch (err) {
      logger.debug('Ollama /api/show 探测异常，按 unknown 处理', {
        model,
        error: String(err),
      });
      return { tool_use: 'unknown', vision: 'unknown' };
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
        signal: AbortSignal.timeout(this.resolveRequestTimeoutMs()),
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
