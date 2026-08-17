// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * OpenAI Provider
 *
 * 使用 ChatCompletionsTransport（OpenAI 兼容格式），
 * 通过 std/fetch 直连 API，支持 DALL-E 图像生成和 Vision 图片分析。
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
  RerankRequest,
  RerankResult,
  ThinkingProviderChunk,
  VideoGenerationParams,
  VideoGenerationResult,
} from './AIProvider';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { getLogger } from '@modules/monitoring';
import { configManager } from '@modules/config';
import { ChatCompletionsTransport } from '../transports/ChatCompletionsTransport';
import { TransportProviderAdapter } from '../transports/TransportProviderAdapter';
import { ALL_MODEL_CONFIGS, getModelsByProvider } from '../models/ModelConfigs';
import { BaseAIProvider, type BaseProviderOptions } from './BaseAIProvider';
import { randomUUID } from 'crypto';

const logger = getLogger('ai:openai');

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

/**
 * 模型请求超时（毫秒）。
 * 中断治理（2026-08-15）：Trace 实证 Kimi-K2.6 等长任务推理多次撞上固定 120s 超时
 * （请求耗时 120028ms/120009ms 顶满上限）被截断，导致执行中断、会话 paused。
 * 默认提升到 300s，可通过环境变量 AI_MODEL_TIMEOUT_MS 覆盖。
 */
function resolveModelTimeoutMs(): number {
  const raw = configManager.env('AI_MODEL_TIMEOUT_MS');
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 300_000;
}

/**
 * 提取 fetch 底层连接错误的 cause（undici/Bun 将 DNS/连接错误包装为
 * TypeError("Was there a typo in the url or port?")，真实原因在 cause 中：
 * code=ENOTFOUND/ECONNREFUSED/EAI_AGAIN/ETIMEDOUT 等，附 hostname/port）。
 * 用于把不可诊断的通用消息转换为可执行提示（2026-08-17 排查 DeepSeek 断连）。
 */
interface FetchCause {
  code: string;
  hostname: string;
  port: number;
}

function extractFetchCause(error: unknown): FetchCause | null {
  const cause = (error as { cause?: unknown } | null)?.cause;
  if (!cause || typeof cause !== 'object') return null;
  const c = cause as { code?: string; hostname?: string; port?: number };
  if (!c.code) return null;
  return { code: c.code, hostname: c.hostname ?? '', port: c.port ?? 0 };
}

/** 将 fetch cause 映射为可执行的中文诊断提示（附 host/port） */
function describeFetchError(cause: FetchCause, url: string): string {
  const host =
    cause.hostname ||
    (() => {
      try {
        return new URL(url).host;
      } catch {
        return url;
      }
    })();
  const port = cause.port ? `:${cause.port}` : '';

  switch (cause.code) {
    case 'ENOTFOUND':
      return `DNS 解析失败（${host}${port} 无法解析）。请检查：
1. 域名/地址拼写是否正确（当前: ${host}）
2. 本机网络能否访问该地址（是否需要代理）
3. 本机 DNS 是否正常`;
    case 'EAI_AGAIN':
      return `DNS 临时解析失败（${host}${port}），网络可能波动，请稍后重试`;
    case 'ECONNREFUSED':
      return `连接被拒绝（${host}${port}）。请检查：
1. 端口是否正确（当前: ${port || '(默认端口)'}）
2. 目标服务是否在运行
3. 是否有防火墙/代理拦截`;
    case 'ETIMEDOUT':
    case 'UND_ERR_CONNECT_TIMEOUT':
      return `连接超时（${host}${port}）。请检查网络连通性或代理配置`;
    default:
      return `网络连接失败（${host}${port}, ${cause.code}）`;
  }
}

export class OpenAIProvider extends BaseAIProvider {
  private apiKey: string;
  /** baseUrl 供子类（如 LlamaCppProvider）访问 */
  protected baseUrl: string;

  /** 获取服务端 baseUrl（供精确 tokenize 等本地服务探测使用） */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * 初始化 OpenAI Provider。
   * 构造函数回退链：DB 持久化 > 环境变量。
   *
   * @param options - 基础选项（providerId, displayName, defaultBaseUrl, envApiKey, defaultModel 等）
   * @param _extraConfig - 扩展配置（保留接口一致）
   */
  constructor(
    options: BaseProviderOptions,
    _extraConfig?: Record<string, unknown>
  ) {
    super(options, _extraConfig);

    this.apiKey = this.resolveApiKey() || '';
    this.baseUrl = (this.resolveBaseUrl() || DEFAULT_BASE_URL).replace(
      /\/+$/,
      ''
    );

    if (!this.transport) {
      this.transport = new TransportProviderAdapter(
        new ChatCompletionsTransport()
      );
    }
  }

  /** 运行时更新 API Key（供 ProviderSyncService 从 DB 同步后注入） */
  override setApiKey(key: string): void {
    this.apiKey = key || '';
  }

  /**
   * 重排序（OpenAI/Cohere 兼容 rerank API）
   *
   * 供 KnowledgeRouter 检索后二次精排；SiliconFlow 等平台已支持 /rerank 端点。
   * 模型名由调用方通过 modelRouter.resolve('reranking') 解析后传入 request.model。
   */
  async rerank(request: RerankRequest): Promise<RerankResult> {
    if (!this.apiKey) {
      throw new AppError(
        'Rerank 需要 API Key，当前 Provider 未配置',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
    if (!request.model) {
      throw new AppError(
        'Rerank 需要 model 参数（由任务分工 reranking 配置解析）',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const res = await fetch(`${this.baseUrl}/rerank`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model,
        query: request.query,
        documents: request.documents,
        top_n: request.topN,
        return_documents: request.returnDocuments,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new AppError(
        `Rerank API 调用失败: ${res.status} ${res.statusText} ${errText.slice(0, 200)}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const json = (await res.json()) as {
      results?: Array<{
        index?: number;
        relevance_score?: number;
        document?: string;
      }>;
      usage?: { total_tokens?: number };
    };

    return {
      results: (json.results ?? []).map((r) => ({
        index: r.index ?? 0,
        relevanceScore: r.relevance_score ?? 0,
        document: r.document,
      })),
      model: request.model,
      usage: { totalTokens: json.usage?.total_tokens ?? 0 },
    };
  }

  async chat(
    messages: ChatMessage[],
    options?: {
      tools?: ToolDefinition[];
      model?: string;
      maxTokens?: number;
      temperature?: number;
      /** P0 压缩超时治理：外部取消信号（压缩超时真正中断请求，消灭僵尸压缩） */
      signal?: AbortSignal;
    }
  ): Promise<ChatResponse> {
    // 耗时统计：委托 BaseAIProvider.measureChat（2026-08-16）
    return BaseAIProvider.measureChat('OpenAI', () =>
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
      /** P0 压缩超时治理：外部取消信号（压缩超时真正中断请求，消灭僵尸压缩） */
      signal?: AbortSignal;
    }
  ): Promise<ChatResponse> {
    const model = await this.resolveModel('chat', options);
    const requestBody = this.transport!.buildRequest({
      model,
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
        signal: options?.signal
          ? // 外部取消信号（压缩超时）与模型请求超时任一触发即中断
            AbortSignal.any([
              options.signal,
              AbortSignal.timeout(resolveModelTimeoutMs()),
            ])
          : AbortSignal.timeout(resolveModelTimeoutMs()),
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
      return this.transport!.toChatResponse(
        this.transport!.normalizeResponse(data)
      );
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
  ): AsyncGenerator<string | ThinkingProviderChunk, ChatResponse, unknown> {
    // 流式耗时统计：委托 BaseAIProvider.wrapChatStreamMeasure（2026-08-16）
    return yield* BaseAIProvider.wrapChatStreamMeasure(
      'OpenAI',
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
    const requestBody = this.transport!.buildRequest({
      model,
      messages,
      tools: options?.tools,
      maxTokens: options?.maxTokens || 4096,
      temperature: options?.temperature,
      stream: true,
    });

    // 流式断连自动重试（2026-08-17）：Bun fetch 在流式读取中 socket 被对端关闭
    // （"The socket connection was closed unexpectedly"）且尚未产出任何内容时，
    // 重新发起请求一次——LLM 无状态，重发安全；已产出内容时不重试避免重复输出。
    // 与 BaseAIProvider.fetchWithConnectionRetry 的连接级重试（最多 2 次）叠加。
    const MAX_STREAM_ATTEMPTS = 2;
    for (let attempt = 0; attempt < MAX_STREAM_ATTEMPTS; attempt++) {
      let fullContent = '';
      try {
        // 使用带连接重试的 fetch，应对 Provider API 网关偶发断连
        const response = await BaseAIProvider.fetchWithConnectionRetry(
          `${this.baseUrl}/chat/completions`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(requestBody),
            signal: AbortSignal.timeout(resolveModelTimeoutMs()),
          }
        );

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
        let lastUsage:
          | import('@modules/ai/models/types').ChatResponse['usage']
          | undefined;
        // 流式 tool_calls 累积（按 index 合并分片）
        const pendingToolCalls = new Map<
          number,
          { id: string; name: string; arguments: string }
        >();
        let stopReason: 'stop' | 'tool_calls' | 'max_tokens' = 'stop';
        let toolCalls: ParsedToolCall[] = [];

        // P2-13 修复：reader.read() 无数据超时（60s），防止 Provider 流挂起导致
        // streamMessage 卡在 await gen.next()、会话互斥锁（SimpleMutex）永久不释放。
        // 统一走 BaseAIProvider.readStreamChunkWithTimeout。
        while (true) {
          const { done, value } = await this.readStreamChunkWithTimeout(reader);
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

              // 提取 usage 字段（通常在流式响应的最后一个 chunk 中出现）
              const usage = parsed['usage'] as
                | import('@modules/ai/models/types').ChatResponse['usage']
                | undefined;
              if (usage) {
                lastUsage = usage;
              }

              const choice = (parsed.choices as Record<string, unknown>[])?.[0];
              const delta = choice?.delta as
                | Record<string, unknown>
                | undefined;
              const finishReason = choice?.finish_reason as string | undefined;

              // 处理推理内容（OpenAI o1/o3 的 reasoning_content 字段）
              const reasoningContent = delta?.['reasoning_content'] as
                | string
                | undefined;
              if (reasoningContent) {
                yield { type: 'thinking', content: reasoningContent };
              }

              const content = delta?.content as string | undefined;
              if (content) {
                fullContent += content;
                yield content;
              }

              // 流式 tool_calls 累积（按 index 合并分片）
              const streamToolCalls = delta?.tool_calls as
                | Array<Record<string, unknown>>
                | undefined;
              if (streamToolCalls) {
                for (const tc of streamToolCalls) {
                  const idx = tc.index as number;
                  const func = tc.function as
                    | Record<string, unknown>
                    | undefined;

                  let pending = pendingToolCalls.get(idx);
                  if (!pending) {
                    pending = { id: '', name: '', arguments: '' };
                    pendingToolCalls.set(idx, pending);
                  }
                  if (tc.id) pending.id = tc.id as string;
                  if (func) {
                    if (func.name) pending.name = func.name as string;
                    if (func.arguments)
                      pending.arguments += func.arguments as string;
                  }
                }
              }

              // 记录 finish_reason，处理 tool_calls 完成
              if (finishReason === 'tool_calls' && pendingToolCalls.size > 0) {
                stopReason = 'tool_calls';
                toolCalls = Array.from(pendingToolCalls.entries())
                  .sort(([a], [b]) => a - b)
                  .map(([_, tc]) => {
                    try {
                      return {
                        id: tc.id,
                        name: tc.name,
                        arguments: JSON.parse(tc.arguments) as Record<
                          string,
                          unknown
                        >,
                      };
                    } catch {
                      return {
                        id: tc.id,
                        name: tc.name,
                        arguments: { _raw: tc.arguments },
                      };
                    }
                  });
              } else if (
                finishReason === 'max_tokens' ||
                finishReason === 'length'
              ) {
                stopReason = 'max_tokens';
              }
            } catch (err) {
              // skip malformed SSE lines
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
        const errorMessage = (error as Error).message || String(error);
        // 提取 fetch 底层 cause（ENOTFOUND/ECONNREFUSED/EAI_AGAIN 等）：
        // undici/Bun 只给 "Was there a typo in the url or port?" 通用消息，
        // 真实原因（DNS/端口/超时）藏在 TypeError.cause 里，需展开为可执行提示。
        const fetchCause = extractFetchCause(error);
        const diagnostic = fetchCause
          ? describeFetchError(fetchCause, `${this.baseUrl}/chat/completions`)
          : errorMessage;
        // socket 被对端关闭且尚未产出内容：重试整个请求（attempt 0 → 1）
        const isSocketClosed =
          /socket.*(closed|reset)|connection.*(closed|reset)/i.test(
            errorMessage
          );
        if (
          attempt < MAX_STREAM_ATTEMPTS - 1 &&
          isSocketClosed &&
          fullContent.length === 0
        ) {
          logger.warn('流式请求连接中断（首块前），重试请求', {
            providerId: this.id,
            attempt: attempt + 1,
            error: errorMessage,
          });
          continue;
        }

        // SSL/TLS 证书错误检测（与 generateImage L567-577 保持一致，CS01 归一化）：
        // 这类错误是环境问题（系统 CA 信任库 / 代理 MITM 证书），错误消息附带
        // 可执行的修复提示，便于用户自诊断（NODE_EXTRA_CA_CERTS / 代理证书信任）。
        const isSSLError = /certificate|ssl|tls|unable to verify/i.test(
          errorMessage
        );
        logger.warn('OpenAIProvider.stream() · 请求失败', {
          providerId: this.id,
          isSSLError,
          error: errorMessage,
          fetchCauseCode: fetchCause?.code,
          fetchCauseHost: fetchCause?.hostname,
          fetchCausePort: fetchCause?.port,
          attempt: attempt + 1,
        });
        const userHint = isSSLError
          ? `SSL 证书验证失败。请尝试以下操作：\n` +
            `1. 设置环境变量 NODE_EXTRA_CA_CERTS 指向系统 CA 证书文件\n` +
            `   （如 Git\\mingw64\\ssl\\cert.pem 或 curl\\ca-bundle.crt）\n` +
            `2. 如在代理环境下使用，请确认代理证书已加入信任列表\n` +
            `原始错误: ${errorMessage}`
          : diagnostic;
        // 诊断增强：错误消息附带 Provider 标识与端点 host，便于定位是哪个供应商/网关
        throw new AppError(
          `OpenAI stream failed: ${userHint}（Provider: ${this.id} / ${this.endpointHost()}）`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }
    }

    // 循环内必然 return 或 throw，此行为类型收窄兜底
    throw new AppError(
      'OpenAI stream failed: 重试后仍失败',
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      '1000'
    );
  }

  /**
   * 端点 host 摘要（脱敏：仅 host，不含路径/query/密钥），供错误诊断提示使用
   */
  private endpointHost(): string {
    try {
      return new URL(this.baseUrl).host;
    } catch {
      return this.baseUrl;
    }
  }

  async listModels(): Promise<string[]> {
    const supportedModels = getModelsByProvider('openai').map(
      (key) => ALL_MODEL_CONFIGS[key].openai
    );
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) return supportedModels;

      const data = (await response.json()) as { data?: { id: string }[] };
      return (
        data.data?.map((m) => m.id).filter((id) => id.includes('gpt')) ??
        supportedModels
      );
    } catch (err) {
      return supportedModels;
    }
  }

  override validateConfig(config: ProviderConfig): ProviderValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!config.apiKey && !configManager.env('OPENAI_API_KEY')) {
      errors.push('API key is required (config.apiKey or OPENAI_API_KEY)');
    }

    const supportedModels = getModelsByProvider('openai').map(
      (key) => ALL_MODEL_CONFIGS[key].openai
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

  /**
   * OpenAI DALL-E 3 图像生成
   * 走 /v1/images/generations 端点
   */
  async generateImage(
    params: import('./AIProvider').ImageGenerationParams
  ): Promise<import('./AIProvider').ImageGenerationResult> {
    const startTime = Date.now();
    // 模型来源：调用方传入 > modelRouter 配置 > 报错
    let model = params.model || this.options.defaultModel;

    // P3-2: 透明背景自动路由 — gpt-image-2 不支持透明背景，自动切换为 gpt-image-1.5
    if (
      params.format === 'png' &&
      params.quality === 'standard' &&
      model === 'gpt-image-2' &&
      (params as unknown as Record<string, unknown>).background ===
        'transparent'
    ) {
      logger.info('OpenAIProvider.generateImage() · 透明背景自动路由', {
        from: model,
        to: 'gpt-image-1.5',
      });
      model = 'gpt-image-1.5';
    }

    if (!model) {
      logger.warn('OpenAIProvider.generateImage() · 未配置生图模型', {
        providerId: this.id,
        hasDefaultModel: !!this.options.defaultModel,
      });
      return {
        success: false,
        data: [],
        error:
          'No image generation model configured. Please set a model in model management.',
        durationMs: 0,
      };
    }

    logger.info('OpenAIProvider.generateImage()', {
      providerId: this.id,
      model,
      baseUrl: this.baseUrl,
      prompt: params.prompt.slice(0, 50),
      size: params.size,
    });

    const body: Record<string, unknown> = {
      model,
      prompt: params.prompt,
      n: params.n ?? 1,
      size: params.size ?? '1024x1024',
    };

    // DALL-E 专有参数（仅当模型名匹配 dall-e 时附加）
    if (model.toLowerCase().startsWith('dall-e')) {
      body.quality = params.quality ?? 'standard';
      body.style = params.style ?? 'vivid';
      body.response_format = 'b64_json';
      if (body.quality === 'hd' && body.size === '1024x1024') {
        body.size = '1792x1024';
      }
    }

    try {
      // 使用 fetchWithConnectionRetry（基类已注入系统 CA 证书 dispatcher，解决 Windows SSL 证书问题）
      const response = await OpenAIProvider.fetchWithConnectionRetry(
        `${this.baseUrl}/images/generations`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(120000),
        },
        0 // 图片生成不自动重试（避免重复请求和重复计费）
      );

      if (!response.ok) {
        const errorBody = await response.text();
        return {
          success: false,
          data: [],
          error: `Image generation API error (${response.status}): ${errorBody}`,
          durationMs: Date.now() - startTime,
        };
      }

      const data = (await response.json()) as Record<string, unknown>;
      const images = (data.data as Array<Record<string, string>>) || [];

      return {
        success: true,
        data: images.map((img: Record<string, string>) => ({
          url: img.url || `data:image/png;base64,${img.b64_json}`,
          b64_json: img.b64_json,
          alt: params.prompt,
        })),
        model: model,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = (error as Error).message || String(error);

      // 检测 SSL/TLS 证书错误，提供用户友好的解决建议
      const isSSLError = /certificate|ssl|tls|unable to verify/i.test(
        errorMessage
      );

      const userHint = isSSLError
        ? `SSL 证书验证失败。请尝试以下操作：\n` +
          `1. 设置环境变量 NODE_EXTRA_CA_CERTS 指向系统 CA 证书文件\n` +
          `   （如 Git\\mingw64\\ssl\\cert.pem 或 curl\\ca-bundle.crt）\n` +
          `2. 如在代理环境下使用，请确认代理证书已加入信任列表\n` +
          `原始错误: ${errorMessage}`
        : `Image generation failed: ${errorMessage}`;

      logger.warn('OpenAIProvider.generateImage() · 请求失败', {
        providerId: this.id,
        model,
        isSSLError,
        error: errorMessage,
      });

      return {
        success: false,
        data: [],
        error: userHint,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * OpenAI Vision 图片分析
   * 直接构造 chat/completions 多模态请求
   */
  async analyzeImage(
    params: import('./AIProvider').VisionAnalysisParams
  ): Promise<import('./AIProvider').VisionAnalysisResult> {
    const startTime = Date.now();
    const base64 = params.imageBuffer.toString('base64');
    const dataUrl = `data:${params.mimeType};base64,${base64}`;

    const requestBody = {
      model: params.model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: params.prompt || '请详细描述这张图片的内容。',
            },
            {
              type: 'image_url',
              image_url: {
                url: dataUrl,
                detail: params.detail || 'auto',
              },
            },
          ],
        },
      ],
      max_tokens: params.maxTokens ?? 1024,
    };

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
        return {
          success: false,
          description: '',
          error: `OpenAI Vision error (${response.status}): ${errorBody}`,
          durationMs: Date.now() - startTime,
        };
      }

      const data = (await response.json()) as Record<string, unknown>;
      const choice = (data.choices as Array<Record<string, unknown>>)?.[0];
      const message = choice?.message as Record<string, unknown> | undefined;
      const content = message?.content as string | undefined;

      return {
        success: true,
        description: content || '',
        model: '',
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        description: '',
        error: `OpenAI Vision failed: ${(error as Error).message}`,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * 视频生成（异步提交 + 轮询）
   *
   * 双路径支持：
   *   - SiliconFlow：POST /v1/video/submit → POST /v1/video/status
   *   - OpenAI 兼容：POST /video/generations → GET /video/generations/{taskId}
   */
  async generateVideo(
    params: VideoGenerationParams
  ): Promise<VideoGenerationResult> {
    const startTime = Date.now();
    const model = params.model || this.options.defaultModel || '';

    if (!model) {
      return {
        success: false,
        data: [],
        error: '未配置视频生成模型',
        durationMs: 0,
      };
    }

    if (!this.apiKey) {
      return {
        success: false,
        data: [],
        error: 'API Key 未配置',
        durationMs: 0,
      };
    }

    const isSiliconFlow = this.baseUrl.includes('api.siliconflow.cn');

    logger.info('OpenAIProvider.generateVideo()', {
      providerId: this.id,
      model,
      baseUrl: this.baseUrl,
      isSiliconFlow,
      prompt: params.prompt.slice(0, 80),
    });

    if (isSiliconFlow) {
      return this.generateVideoSiliconFlow(params, model, startTime);
    }

    return this.generateVideoOpenAI(params, model, startTime);
  }

  /** SiliconFlow 视频生成：POST /v1/video/submit → POST /v1/video/status */
  private async generateVideoSiliconFlow(
    params: VideoGenerationParams,
    model: string,
    startTime: number
  ): Promise<VideoGenerationResult> {
    const body: Record<string, unknown> = {
      model,
      prompt: params.prompt,
    };
    // 图生视频：优先用外部 URL；如果 imageUrl 是 localhost 且 imagePath 存在，转 base64
    if (params.imageUrl) {
      if (
        params.imageUrl.includes('localhost') ||
        params.imageUrl.includes('127.0.0.1')
      ) {
        if (params.imagePath) {
          const file = Bun.file(params.imagePath);
          const buffer = Buffer.from(await file.arrayBuffer());
          const ext = params.imagePath.split('.').pop()?.toLowerCase() || 'png';
          const mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
          body.image_url = `data:${mimeType};base64,${buffer.toString('base64')}`;
          logger.info('OpenAIProvider . localhost URL → base64', {
            path: params.imagePath,
            mimeType,
            sizeKb: Math.round(buffer.length / 1024),
          });
        }
        // 无 imagePath 则跳过图片（降级为文生视频）
      } else {
        body.image_url = params.imageUrl;
      }
    }
    if (params.seed !== undefined) body.seed = params.seed;

    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    };

    try {
      // 1. 提交任务
      let submitRes: Response;
      try {
        submitRes = await fetch(`${this.baseUrl}/video/submit`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(60000),
        });
      } catch (submitErr) {
        return {
          success: false,
          data: [],
          error: `SiliconFlow 视频提交网络异常: ${(submitErr as Error).message}`,
          durationMs: Date.now() - startTime,
        };
      }

      if (!submitRes.ok) {
        const errorBody = await submitRes.text();
        return {
          success: false,
          data: [],
          error: `SiliconFlow 视频提交失败 (${submitRes.status}): ${errorBody}`,
          durationMs: Date.now() - startTime,
        };
      }

      const submitData = (await submitRes.json()) as Record<string, unknown>;
      const requestId = submitData.requestId as string | undefined;

      if (!requestId) {
        return {
          success: false,
          data: [],
          error: `SiliconFlow 视频提交: 未返回 requestId, 响应: ${JSON.stringify(submitData)}`,
          durationMs: Date.now() - startTime,
        };
      }

      logger.info('SiliconFlow 视频任务已提交', { requestId, model });

      // 2. 轮询状态
      // Wan2.2-I2V-A14B 等大模型需 15-25 分钟，设置 30 分钟超时
      const MAX_POLL_TIME = 30 * 60 * 1000;
      let pollInterval = 3000;
      let lastLogTime = startTime;
      let videoUrl = '';

      while (Date.now() - startTime < MAX_POLL_TIME) {
        await new Promise((r) => setTimeout(r, pollInterval));
        pollInterval = Math.min(pollInterval * 1.3, 15000);

        // 每 2 分钟输出一次轮询进度日志
        const elapsed = Date.now() - startTime;
        if (elapsed - lastLogTime >= 2 * 60 * 1000) {
          lastLogTime = elapsed;
          logger.info('SiliconFlow 视频生成轮询中...', {
            requestId,
            elapsedMinutes: Math.round(elapsed / 60000),
          });
        }

        // 单次状态查询（超时或网络异常不崩溃，继续重试）
        let statusRes: Response;
        try {
          statusRes = await fetch(`${this.baseUrl}/video/status`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ requestId }),
            signal: AbortSignal.timeout(15000),
          });
        } catch (err) {
          logger.warn('SiliconFlow 视频状态查询网络异常，继续重试', {
            requestId,
            elapsedMinutes: Math.round((Date.now() - startTime) / 60000),
          });
          continue;
        }

        if (!statusRes.ok) {
          if (statusRes.status === 429) {
            await new Promise((r) => setTimeout(r, 10000));
            continue;
          }
          logger.warn('SiliconFlow 视频状态查询失败', {
            status: statusRes.status,
            requestId,
          });
          continue;
        }

        const statusData = (await statusRes.json()) as Record<string, unknown>;
        const state = statusData.status as string;

        if (state === 'Succeed') {
          const results = statusData.results as
            | Record<string, unknown>
            | undefined;
          const videos = results?.videos as
            | Array<Record<string, unknown>>
            | undefined;
          if (videos?.[0]?.url) {
            videoUrl = videos[0].url as string;
          }
          break;
        }

        if (state === 'Failed') {
          return {
            success: false,
            data: [],
            error: `SiliconFlow 视频生成失败: ${JSON.stringify(statusData.reason || statusData)}`,
            durationMs: Date.now() - startTime,
          };
        }

        // InQueue / InProgress — 继续轮询
      }

      if (!videoUrl) {
        return {
          success: false,
          data: [],
          error: `SiliconFlow 视频生成超时（超过 ${MAX_POLL_TIME / 60000} 分钟）`,
          durationMs: Date.now() - startTime,
        };
      }

      // 3. 下载视频内容（带鉴权 header）
      let videoBuffer: Buffer | undefined;
      try {
        const downloadRes = await fetch(videoUrl, {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
          signal: AbortSignal.timeout(300000),
        });
        if (downloadRes.ok) {
          const arrayBuf = await downloadRes.arrayBuffer();
          videoBuffer = Buffer.from(arrayBuf);
          logger.info('SiliconFlow 视频已下载', {
            requestId,
            sizeKb: Math.round(videoBuffer.length / 1024),
          });
        } else {
          logger.warn('SiliconFlow 视频下载失败', {
            requestId,
            status: downloadRes.status,
            statusText: downloadRes.statusText,
          });
        }
      } catch (downloadErr) {
        logger.warn('SiliconFlow 视频下载异常', {
          requestId,
          error: String(downloadErr),
        });
        // 下载失败不阻塞，仍返回 URL（buildToolResult 会回退到 fetch URL）
      }

      return {
        success: true,
        data: [{ url: videoUrl }],
        videoBuffer,
        durationMs: Date.now() - startTime,
        model,
      };
    } catch (error) {
      return {
        success: false,
        data: [],
        error: `SiliconFlow 视频生成异常: ${(error as Error).message}`,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /** OpenAI 兼容视频生成：POST /video/generations → GET /video/generations/{taskId} */
  private async generateVideoOpenAI(
    params: VideoGenerationParams,
    model: string,
    startTime: number
  ): Promise<VideoGenerationResult> {
    const body: Record<string, unknown> = {
      model,
      prompt: params.prompt,
    };
    if (params.imageUrl) {
      if (
        params.imageUrl.includes('localhost') ||
        params.imageUrl.includes('127.0.0.1')
      ) {
        if (params.imagePath) {
          const file = Bun.file(params.imagePath);
          const buffer = Buffer.from(await file.arrayBuffer());
          const ext = params.imagePath.split('.').pop()?.toLowerCase() || 'png';
          const mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
          body.image_url = `data:${mimeType};base64,${buffer.toString('base64')}`;
        }
      } else {
        body.image_url = params.imageUrl;
      }
    }
    if (params.duration) body.duration = params.duration;
    if (params.aspectRatio) body.aspect_ratio = params.aspectRatio;
    if (params.negativePrompt) body.negative_prompt = params.negativePrompt;
    if (params.seed !== undefined) body.seed = params.seed;
    if (params.n) body.n = params.n;

    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    };

    try {
      const submitRes = await fetch(`${this.baseUrl}/video/generations`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });

      if (!submitRes.ok) {
        const errorBody = await submitRes.text();
        return {
          success: false,
          data: [],
          error: `视频生成 API 错误 (${submitRes.status}): ${errorBody}`,
          durationMs: Date.now() - startTime,
        };
      }

      const submitData = (await submitRes.json()) as Record<string, unknown>;
      const taskId = (submitData.id ||
        submitData.task_id ||
        submitData.request_id) as string | undefined;

      if (!taskId) {
        const videoUrl = extractVideoUrl(submitData);
        if (videoUrl) {
          return {
            success: true,
            data: [{ url: videoUrl }],
            durationMs: Date.now() - startTime,
            model,
          };
        }
        return {
          success: false,
          data: [],
          error: '视频生成: 未返回任务 ID',
          durationMs: Date.now() - startTime,
        };
      }

      const statusUrl = `${this.baseUrl}/video/generations/${taskId}`;
      const MAX_POLL_TIME = 5 * 60 * 1000;
      let pollInterval = 2000;
      let videoUrl = '';

      while (Date.now() - startTime < MAX_POLL_TIME) {
        await new Promise((r) => setTimeout(r, pollInterval));
        pollInterval = Math.min(pollInterval * 1.5, 10000);

        const statusRes = await fetch(statusUrl, {
          headers,
          signal: AbortSignal.timeout(15000),
        });

        if (!statusRes.ok) {
          if (statusRes.status === 429) {
            await new Promise((r) => setTimeout(r, 10000));
            continue;
          }
          continue;
        }

        const status = (await statusRes.json()) as Record<string, unknown>;
        const state = (status.status || status.state) as string;

        if (
          state === 'completed' ||
          state === 'succeeded' ||
          state === 'COMPLETED'
        ) {
          videoUrl = extractVideoUrl(status);
          break;
        }
        if (state === 'failed' || state === 'FAILED' || state === 'error') {
          return {
            success: false,
            data: [],
            error: `视频生成失败: ${JSON.stringify(status.error || status.message || status)}`,
            durationMs: Date.now() - startTime,
          };
        }
      }

      if (!videoUrl) {
        return {
          success: false,
          data: [],
          error: '视频生成超时（超过 5 分钟）',
          durationMs: Date.now() - startTime,
        };
      }

      // 下载视频内容（带鉴权 header）
      let videoBuffer: Buffer | undefined;
      try {
        const downloadRes = await fetch(videoUrl, {
          headers: { Authorization: `Bearer ${this.apiKey}` },
          signal: AbortSignal.timeout(300000),
        });
        if (downloadRes.ok) {
          const arrayBuf = await downloadRes.arrayBuffer();
          videoBuffer = Buffer.from(arrayBuf);
        }
      } catch (err) {
        // 下载失败不阻塞
      }

      return {
        success: true,
        data: [{ url: videoUrl }],
        videoBuffer,
        durationMs: Date.now() - startTime,
        model,
      };
    } catch (error) {
      return {
        success: false,
        data: [],
        error: `视频生成失败: ${(error as Error).message}`,
        durationMs: Date.now() - startTime,
      };
    }
  }
}

/** 从多种响应格式中提取视频 URL */
function extractVideoUrl(data: Record<string, unknown>): string {
  // 常见格式: { video: { url: "..." } }
  const video = data.video as Record<string, unknown> | undefined;
  if (video?.url) return video.url as string;

  // { output: { video: "..." } }
  const output = data.output as Record<string, unknown> | undefined;
  if (output?.video) return output.video as string;
  if (output?.url) return output.url as string;

  // { data: [{ url: "..." }] }
  const dataArr = data.data as Array<Record<string, unknown>> | undefined;
  if (dataArr?.[0]?.url) return dataArr[0].url as string;

  // { result: { video: { url: "..." } } }
  const result = data.result as Record<string, unknown> | undefined;
  if (result?.video) {
    const rv = result.video as Record<string, unknown>;
    if (rv.url) return rv.url as string;
  }

  // { url: "..." }
  if (data.url) return data.url as string;

  return '';
}
