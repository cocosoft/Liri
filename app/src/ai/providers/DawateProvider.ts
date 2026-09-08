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
 * DawateProvider — 私有化部署"智能体平台"适配器
 *
 * 协议（参考对接样例脚本）：
 *   1. 换 key：POST {baseUrl}/knowledgeService/extSecret/generateAppKey
 *      body { appId, appSecret } → resultObject.appKey（缓存，避免每次调用换取）
 *   2. 对话：POST {baseUrl}/knowledgeService/extChatApi/v3/chat
 *      headers { Content-Type, appId, appKey }
 *      body   { agentId, messages:[{role,content}], max_tokens? }
 *      SSE 流式，data: {...}，choices[0].delta.content（服务端按全量累计下发，
 *      用长度增量切分，兼容"全量 vs 增量"两种实现）
 *
 * 凭据约定（供应商配置，DB 唯一事实来源，无环境变量回退）：
 *   baseUrl   = https://<私有化服务器>:<端口>（如 https://10.10.65.104:5030）
 *   apiKey    = appSecret（智能体平台应用密钥）
 *   headers   = {"appId":"<应用ID>","agentId":"<智能体ID>"}（JSON 存 ai_providers.headers）
 *   可选 headers.insecureSkipVerify=true：服务器为自签/私有根证书且本机无信任锚时，
 *   对私有化请求跳过 TLS 证书校验（仅限可信内网，默认关闭）。
 *
 * 说明：平台为纯对话 Agent，不支持工具调用/多模态；模型=智能体（agentId），
 * 模型列表在模型管理中手工录入即可（无远端 models 枚举端点）。
 */

import type { ChatMessage, ChatResponse } from '../models/types';
import type {
  ChatOptions,
  ProviderConfig,
  ProviderValidationResult,
  ThinkingProviderChunk,
} from './AIProvider';
import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@modules/error';
import { BaseAIProvider, type BaseProviderOptions } from './BaseAIProvider';
import { getLogger, getOTelTracing } from '@modules/monitoring';
import { SpanStatusCode } from '@opentelemetry/api';

const logger = getLogger('ai:provider:dawate');

/** 请求超时（毫秒）：与云端 Provider 缺省对齐（AI_MODEL_TIMEOUT_MS 默认 300s） */
const DEFAULT_TIMEOUT_MS = 300_000;
/** appKey 缓存时长（毫秒）：平台 appKey 有效期未知，取保守 50 分钟 */
const APPKEY_TTL_MS = 50 * 60_000;

/** 全程调试：DAWATE_DEBUG=1 时逐 data: 行打印（含正文），便于内网全面排查 */
function dawateDebugEnabled(): boolean {
  return process.env.DAWATE_DEBUG === '1';
}

function maskSecret(value?: string): string {
  if (!value) return '(empty)';
  if (value.length <= 8) return '***';
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

interface DawateHeaders {
  appId?: string;
  agentId?: string;
  /** 内网私有化专用：true 时对私有化服务器跳过 TLS 证书校验（默认 false，须显式配置） */
  insecureSkipVerify?: boolean;
}

function pickBool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true' || s === '1' || s === 'yes') return true;
    if (s === 'false' || s === '0' || s === 'no') return false;
  }
  return undefined;
}

function readHeaders(config?: Record<string, unknown>): DawateHeaders {
  const headers = (config?.['headers'] as Record<string, unknown>) ?? {};
  const pick = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim() ? v.trim() : undefined;
  return {
    appId: pick(headers['appId']),
    agentId: pick(headers['agentId']),
    insecureSkipVerify: pickBool(headers['insecureSkipVerify']),
  };
}

/**
 * 内网私有化专用：在 fetch 选项中附加 Bun 的 `tls.rejectUnauthorized=false`，
 * 用于服务器使用自签/私有根证书且无信任锚的场景。默认关闭（insecure=false 时原样返回）。
 */
function buildFetchInit(base: RequestInit, insecure: boolean): RequestInit {
  if (!insecure) return base;
  return { ...base, tls: { rejectUnauthorized: false } } as RequestInit;
}

/** 把 Liri 消息列表映射为平台 user/assistant 交替文本消息 */
function mapMessages(messages: ChatMessage[]): Array<{
  role: 'user' | 'assistant';
  content: string;
}> {
  const out: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const m of messages) {
    const content = typeof m.content === 'string' ? m.content : '';
    if (!content.trim()) continue;
    // 平台仅接受 user/assistant；system/tool 等角色降级为 user 防拒
    out.push({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content,
    });
  }
  return out;
}

export class DawateProvider extends BaseAIProvider {
  private apiKey: string;
  private baseUrl: string;
  private appId: string;
  private agentId: string;
  /** 内网私有化专用：跳过 TLS 证书校验（来自 headers.insecureSkipVerify，默认 false） */
  private insecureSkipVerify: boolean;

  /** appKey 缓存 */
  private appKey: string | null = null;
  private appKeyExpiry = 0;

  /**
   * @param options 基础选项
   * @param extraConfig ProviderConfig（含 headers 里的 appId/agentId/insecureSkipVerify）
   */
  constructor(
    options: BaseProviderOptions,
    extraConfig?: Record<string, unknown>
  ) {
    super(options, extraConfig);
    const headers = readHeaders(extraConfig);
    const cfg = (extraConfig ?? {}) as ProviderConfig;
    this.appId = headers.appId || '';
    this.agentId = headers.agentId || '';
    this.insecureSkipVerify = headers.insecureSkipVerify === true;
    // DB 未覆盖（如直接实例化/测试）时从 extraConfig 回退；覆盖时以实例属性为准
    this.apiKey =
      (typeof cfg.apiKey === 'string' ? cfg.apiKey : '') ||
      this.resolveApiKey() ||
      '';
    const baseUrl =
      typeof cfg.baseUrl === 'string' && cfg.baseUrl
        ? cfg.baseUrl
        : this.resolveBaseUrl() || '';
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  /** 运行时更新 appSecret（ProviderSyncService 从 DB 同步后注入） */
  override setApiKey(key: string): void {
    this.apiKey = key || '';
    // 凭据变化 → 强制重换 appKey
    this.appKey = null;
  }

  private resolveTimeoutSignal(
    external?: AbortSignal
  ): AbortSignal | undefined {
    const timeout = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
    return external ? AbortSignal.any([external, timeout]) : timeout;
  }

  /**
   * 换取 appKey（带 TTL 缓存；失败抛 AppError 便于上层重试/降级）。
   *
   * 观测：OTel span `DawateProvider.ensureAppKey`（缓存命中/换取耗时/掩码 key 属性），
   * 异常仅标记 span 并原样上抛，统一由调用方（chat 边界）经 handleError 记录。
   */
  private async ensureAppKey(): Promise<string> {
    const otel = getOTelTracing();
    const span = otel.startSpan('DawateProvider.ensureAppKey');
    const started = Date.now();
    try {
      span.setAttribute('appId', this.appId);
      span.setAttribute('baseUrl', this.baseUrl);

      if (this.appKey && this.appKeyExpiry > Date.now()) {
        span.setAttribute('cacheHit', true);
        span.setAttribute('ttlLeftMs', this.appKeyExpiry - Date.now());
        otel.recordEvent(span, 'appkey.cache_hit', {
          ttlLeftMs: this.appKeyExpiry - Date.now(),
        });
        span.setStatus({ code: SpanStatusCode.OK });
        return this.appKey;
      }

      span.setAttribute('cacheHit', false);
      span.setAttribute('reason', this.appKey ? 'expired' : 'first');
      if (!this.appId || !this.apiKey) {
        throw new AppError(
          '私有化部署未配置完整：需要 baseUrl + apiKey(appSecret) + headers.appId',
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          'dawate-config'
        );
      }
      span.setAttribute('appSecretMasked', maskSecret(this.apiKey));

      const url = `${this.baseUrl}/knowledgeService/extSecret/generateAppKey`;
      let response: Response;
      try {
        response = await BaseAIProvider.fetchWithConnectionRetry(
          url,
          buildFetchInit(
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                appId: this.appId,
                appSecret: this.apiKey,
              }),
              signal: this.resolveTimeoutSignal(),
            },
            this.insecureSkipVerify
          )
        );
      } catch (error) {
        throw new AppError(
          `私有化部署换取 appKey 失败: ${(error as Error).message}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          'dawate-appkey'
        );
      }
      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        span.setAttribute('httpStatus', response.status);
        span.setAttribute('bodyTail', bodyText.slice(0, 300));
        throw new AppError(
          `私有化部署换取 appKey HTTP ${response.status}: ${bodyText.slice(0, 300)}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          'dawate-appkey'
        );
      }
      let data: Record<string, unknown>;
      try {
        data = (await response.json()) as Record<string, unknown>;
      } catch {
        throw new AppError(
          '私有化部署换取 appKey 响应非 JSON',
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          'dawate-appkey'
        );
      }
      const resultObject = data?.['resultObject'] as
        | Record<string, unknown>
        | undefined;
      const key = resultObject?.['appKey'];
      if (typeof key !== 'string' || !key) {
        span.setAttribute(
          'responseBodyTail',
          JSON.stringify(data).slice(0, 300)
        );
        throw new AppError(
          '私有化部署换取 appKey 响应缺少 resultObject.appKey',
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          'dawate-appkey'
        );
      }
      this.appKey = key;
      this.appKeyExpiry = Date.now() + APPKEY_TTL_MS;
      span.setAttribute('keyMasked', maskSecret(key));
      span.setAttribute('ttlMs', APPKEY_TTL_MS);
      span.setAttribute('elapsedMs', Date.now() - started);
      otel.recordEvent(span, 'appkey.exchanged', {
        elapsedMs: Date.now() - started,
        status: response.status,
        keyMasked: maskSecret(key),
      });
      span.setStatus({ code: SpanStatusCode.OK });
      logger.info('私有化部署 appKey 换取成功', {
        elapsedMs: Date.now() - started,
        keyMasked: maskSecret(key),
        ttlMs: APPKEY_TTL_MS,
        status: response.status,
      });
      return key;
    } catch (error) {
      span.setAttribute('elapsedMs', Date.now() - started);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      span.end();
    }
  }

  private buildChatUrl(): string {
    return `${this.baseUrl}/knowledgeService/extChatApi/v3/chat`;
  }

  /**
   * 流式请求（HTTP 层）→ 逐个 data: 行回调；返回累计正文。
   *
   * 观测（统一基础设施）：整个请求包在 OTel span `DawateProvider.chat` 内，
   * 关键节点以 span 事件/属性落盘（发请求、TTFB、首增量、[DONE]、汇总），
   * 异常路径标记 span ERROR 后经 handleError 统一记录（日志 + 内存追踪 + 事件发布），
   * 再上抛交由上层重试/降级。SSE 原始帧仅在 DAWATE_DEBUG=1 时打印（防生产刷屏）。
   */
  private async *streamChat(
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncGenerator<string, void, unknown> {
    const otel = getOTelTracing();
    const span = otel.startSpan('DawateProvider.chat');
    const started = Date.now();
    const requestId = `dawate_${Date.now().toString(36)}_${Math.floor(
      Math.random() * 1e6
    ).toString(36)}`;
    const debug = dawateDebugEnabled();
    const mappedMessages = mapMessages(messages);

    span.setAttribute('requestId', requestId);
    span.setAttribute('agentId', this.agentId);
    span.setAttribute('appId', this.appId);
    span.setAttribute('baseUrl', this.baseUrl);
    span.setAttribute('messageCount', mappedMessages.length);
    span.setAttribute(
      'inputChars',
      mappedMessages.reduce((n, m) => n + m.content.length, 0)
    );
    if (options?.maxTokens !== undefined) {
      span.setAttribute('maxTokens', options.maxTokens);
    }
    if (options?.temperature !== undefined) {
      span.setAttribute('temperature', options.temperature);
    }

    try {
      if (!this.agentId) {
        throw new AppError(
          '私有化部署未配置 agentId（headers 中）',
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          'dawate-config'
        );
      }

      logger.info('chat 开始', {
        requestId,
        agentId: this.agentId,
        appId: this.appId,
        baseUrl: this.baseUrl,
        messageCount: mappedMessages.length,
        inputChars: mappedMessages.reduce((n, m) => n + m.content.length, 0),
        maxTokens: options?.maxTokens,
        temperature: options?.temperature,
      });

      const appKey = await this.ensureAppKey();
      const body: Record<string, unknown> = {
        agentId: this.agentId,
        messages: mappedMessages,
        ...(options?.maxTokens ? { max_tokens: options.maxTokens } : {}),
        ...(options?.temperature !== undefined
          ? { temperature: options.temperature }
          : {}),
      };

      const chatUrl = this.buildChatUrl();
      let response: Response;
      try {
        const bodyBytes = JSON.stringify(body).length;
        span.setAttribute('appKeyMasked', maskSecret(appKey));
        otel.recordEvent(span, 'chat.send', {
          bodyBytes,
          appKeyMasked: maskSecret(appKey),
        });
        logger.info('chat 请求发出', {
          requestId,
          url: chatUrl,
          bodyBytes,
          appKeyMasked: maskSecret(appKey),
        });
        response = await BaseAIProvider.fetchWithConnectionRetry(
          chatUrl,
          buildFetchInit(
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                appId: this.appId,
                appKey,
              },
              body: JSON.stringify(body),
              signal: options?.signal
                ? AbortSignal.any([
                    options.signal,
                    AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
                  ])
                : AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
            },
            this.insecureSkipVerify
          )
        );
      } catch (error) {
        throw new AppError(
          `私有化部署调用失败: ${(error as Error).message}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          'dawate-chat'
        );
      }
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        span.setAttribute('httpStatus', response.status);
        span.setAttribute('bodyTail', text.slice(0, 500));
        throw new AppError(
          `私有化部署对话 HTTP ${response.status}: ${text.slice(0, 300)}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          'dawate-chat'
        );
      }
      span.setAttribute('httpStatus', response.status);
      otel.recordEvent(span, 'chat.response', {
        status: response.status,
        ttfbMs: Date.now() - started,
      });
      logger.info('chat 响应头就绪', {
        requestId,
        status: response.status,
        ttfbMs: Date.now() - started,
        contentType: response.headers.get('content-type') ?? '',
      });

      const reader = response.body?.getReader();
      if (!reader) {
        throw new AppError(
          '私有化部署对话无响应体',
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          'dawate-chat'
        );
      }
      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';
      let finished = false;
      let sseLineCount = 0;
      let skippedMalformed = 0;
      let firstChunkAtMs: number | null = null;
      let lastYieldAt = Date.now();

      while (!finished) {
        let chunk: { done: boolean; value?: Uint8Array };
        try {
          chunk = await reader.read();
        } catch (error) {
          throw new AppError(
            `私有化部署流式读取失败: ${(error as Error).message}`,
            ErrorCategory.EXECUTION,
            ErrorSeverity.HIGH,
            'dawate-chat'
          );
        }
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) {
            if (debug && trimmed) {
              logger.info('SSE 忽略行', {
                requestId,
                line: trimmed.slice(0, 300),
              });
            }
            continue;
          }
          const data = trimmed.slice(6);
          if (data.includes('[DONE]')) {
            finished = true;
            otel.recordEvent(span, 'sse.done', {
              elapsedMs: Date.now() - started,
              sseLineCount,
              fullChars: fullContent.length,
            });
            logger.info('SSE [DONE] 收到', {
              requestId,
              elapsedMs: Date.now() - started,
              sseLineCount,
              fullChars: fullContent.length,
            });
            break;
          }
          if (debug) {
            logger.info('SSE 原始帧', { requestId, data: data.slice(0, 2000) });
          }
          sseLineCount++;
          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(data) as Record<string, unknown>;
          } catch {
            skippedMalformed++;
            logger.warn('SSE 畸形 JSON 行', {
              requestId,
              rawTail: data.slice(0, 500),
            });
            continue;
          }
          const choice = (
            parsed.choices as Array<Record<string, unknown>>
          )?.[0];
          const delta = choice?.delta as Record<string, unknown> | undefined;
          if (!delta) continue;
          const cumulative = delta['content'];
          if (typeof cumulative !== 'string') continue;
          if (cumulative.length > fullContent.length) {
            const part = cumulative.slice(fullContent.length);
            fullContent = cumulative;
            if (firstChunkAtMs === null) {
              firstChunkAtMs = Date.now();
              otel.recordEvent(span, 'sse.first_content', {
                ttfbMs: firstChunkAtMs - started,
                partChars: part.length,
              });
              logger.info('首个内容增量到达', {
                requestId,
                firstChunkTtfbMs: firstChunkAtMs - started,
                partChars: part.length,
              });
            }
            if (part) {
              const now = Date.now();
              if (now - lastYieldAt >= 10_000) {
                logger.info('流式输出进行中', {
                  requestId,
                  sinceStartMs: now - started,
                  totalChars: fullContent.length,
                  sseLineCount,
                  lastIntervalMs: now - lastYieldAt,
                });
                lastYieldAt = now;
              }
              yield part;
            }
          }
        }
      }

      span.setAttribute('sseLineCount', sseLineCount);
      span.setAttribute('skippedMalformed', skippedMalformed);
      span.setAttribute('fullChars', fullContent.length);
      span.setAttribute('finishedByDone', finished);
      otel.recordEvent(span, 'chat.finished', {
        elapsedMs: Date.now() - started,
        sseLineCount,
        skippedMalformed,
        fullChars: fullContent.length,
        finishedByDone: finished,
      });
      logger.info('chat 流结束', {
        requestId,
        elapsedMs: Date.now() - started,
        sseLineCount,
        skippedMalformed,
        fullChars: fullContent.length,
        finishedByDone: finished,
        endedEmpty: !finished && fullContent.length === 0,
      });
      if (!finished && fullContent.length === 0) {
        logger.warn('chat 连接正常结束但无任何内容（可能智能体未回复）', {
          requestId,
          elapsedMs: Date.now() - started,
          sseLineCount,
        });
      }
      span.setStatus({ code: SpanStatusCode.OK });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      span.setAttribute('elapsedMs', Date.now() - started);
      otel.recordError(span, err);
      // 统一错误处理：日志记录 + 内存追踪 + 高严重级事件发布；随后上抛供上层重试/降级
      await handleError(error, {
        module: 'ai:provider:dawate',
        action: 'chat',
      });
      throw err;
    } finally {
      span.setAttribute('elapsedMs', Date.now() - started);
      span.end();
    }
  }

  /** 非流式：内部把流式输出汇聚为完整响应 */
  private async chatInternal(
    messages: ChatMessage[],
    options?: ChatOptions
  ): Promise<ChatResponse> {
    let content = '';
    for await (const part of this.streamChat(messages, options)) {
      content += part;
    }
    if (!content) {
      throw new AppError(
        '私有化部署返回为空（智能体未回复）',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'dawate-empty'
      );
    }
    return {
      content,
      model: options?.model || this.agentId,
      stop_reason: 'stop',
    };
  }

  async chat(
    messages: ChatMessage[],
    options?: ChatOptions
  ): Promise<ChatResponse> {
    return this.chatInternal(messages, options);
  }

  async *chatStream(
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncGenerator<string | ThinkingProviderChunk, ChatResponse, unknown> {
    let content = '';
    for await (const part of this.streamChat(messages, options)) {
      content += part;
      yield part;
    }
    if (!content) {
      throw new AppError(
        '私有化部署返回为空（智能体未回复）',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'dawate-empty'
      );
    }
    return {
      content,
      model: options?.model || this.agentId,
      stop_reason: 'stop',
    };
  }

  /** 私有化平台无远端模型枚举 → 空（模型在模型管理中手工录入） */
  override async listModels(): Promise<string[]> {
    return [];
  }

  override validateConfig(config: ProviderConfig): ProviderValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!config.baseUrl)
      errors.push('缺少 baseUrl（私有化服务器地址，如 https://IP:5030）');
    if (!config.apiKey) errors.push('缺少 apiKey（填写平台 appSecret）');
    const headers = readHeaders(config);
    if (!headers.appId) errors.push('headers 缺少 appId');
    if (!headers.agentId) errors.push('headers 缺少 agentId');
    if (headers.insecureSkipVerify) {
      warnings.push(
        '已开启「跳过 TLS 证书校验」（headers.insecureSkipVerify=true），仅建议在可信内网使用'
      );
    }
    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * 内网连通性测试：调用 generateAppKey 换取 appKey（200 且返回 appKey 即通）。
   * 用于「测试连接」按钮，不入库、不改状态；复用与 ensureAppKey 相同的端点语义。
   * 放类内以便复用基类带系统 CA 证书注入的 fetchWithConnectionRetry；
   * cfg.insecureSkipVerify=true 时对私有化服务器跳过 TLS 证书校验。
   */
  static async testConnection(cfg: {
    baseUrl?: string;
    appId?: string;
    appSecret?: string;
    timeoutMs?: number;
    insecureSkipVerify?: boolean;
  }): Promise<{
    ok: boolean;
    latencyMs: number;
    status?: number;
    error?: string;
  }> {
    const otel = getOTelTracing();
    const span = otel.startSpan('DawateProvider.testConnection');
    const started = Date.now();
    const timeoutMs = cfg.timeoutMs ?? 8000;
    const pick = (v: unknown): string | undefined =>
      typeof v === 'string' && v.trim() ? v.trim() : undefined;
    const baseUrl = pick(cfg.baseUrl);
    const appId = pick(cfg.appId);
    const appSecret = pick(cfg.appSecret);
    span.setAttribute('baseUrl', baseUrl ?? '');
    span.setAttribute('appId', appId ?? '');
    span.setAttribute('hasAppSecret', Boolean(appSecret));
    span.setAttribute('insecureSkipVerify', cfg.insecureSkipVerify === true);

    let result: {
      ok: boolean;
      latencyMs: number;
      status?: number;
      error?: string;
    };

    try {
      if (!baseUrl || !appId || !appSecret) {
        result = {
          ok: false,
          latencyMs: Date.now() - started,
          error: '缺少 baseUrl / appId / appSecret，无法测试',
        };
      } else {
        const url = `${baseUrl.replace(/\/+$/, '')}/knowledgeService/extSecret/generateAppKey`;
        // 探测请求只发一次（maxRetries=0），复用基类系统 CA 证书注入
        const response = await BaseAIProvider.fetchWithConnectionRetry(
          url,
          buildFetchInit(
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ appId, appSecret }),
              signal: AbortSignal.timeout(timeoutMs),
            },
            cfg.insecureSkipVerify === true
          ),
          0
        );
        const latencyMs = Date.now() - started;
        span.setAttribute('httpStatus', response.status);
        if (!response.ok) {
          const text = await response.text().catch(() => '');
          result = {
            ok: false,
            latencyMs,
            status: response.status,
            error: `HTTP ${response.status}: ${text.slice(0, 200)}`,
          };
        } else {
          const data = (await response.json().catch(() => null)) as Record<
            string,
            unknown
          > | null;
          const resultObject = data?.['resultObject'] as
            | Record<string, unknown>
            | undefined;
          const appKey = pick(resultObject?.['appKey']);
          if (!appKey) {
            const resultMsg = pick(data?.['resultMsg']);
            result = {
              ok: false,
              latencyMs,
              status: 200,
              error: resultMsg
                ? `认证失败：${resultMsg}`
                : '响应缺少 resultObject.appKey',
            };
          } else {
            result = { ok: true, latencyMs, status: 200 };
          }
        }
      }
    } catch (err) {
      const latencyMs = Date.now() - started;
      const message = err instanceof Error ? err.message : String(err);
      result = {
        ok: false,
        latencyMs,
        error: /timed out|aborted/i.test(message)
          ? `连接超时（${timeoutMs}ms，请确认在内网环境）`
          : `网络错误：${message}`,
      };
    }

    span.setAttribute('elapsedMs', result.latencyMs);
    span.setStatus({
      code: result.ok ? SpanStatusCode.OK : SpanStatusCode.ERROR,
      message: result.ok ? undefined : result.error,
    });
    if (result.ok) {
      logger.info('私有化部署测试连接通过', {
        baseUrl: baseUrl ?? '',
        latencyMs: result.latencyMs,
        status: result.status,
      });
    } else {
      logger.warn('私有化部署测试连接失败', {
        baseUrl: baseUrl ?? '',
        latencyMs: result.latencyMs,
        status: result.status,
        error: result.error,
      });
    }
    span.end();
    return result;
  }
}

/**
 * 内网连通性测试（模块级便捷入口，委托 DawateProvider.testConnection，
 * 以复用基类系统 CA 证书注入的 fetch）。保留导出名，调用方无需改动。
 */
export function testDawateConnection(cfg: {
  baseUrl?: string;
  appId?: string;
  appSecret?: string;
  timeoutMs?: number;
  insecureSkipVerify?: boolean;
}): Promise<{
  ok: boolean;
  latencyMs: number;
  status?: number;
  error?: string;
}> {
  return DawateProvider.testConnection(cfg);
}
