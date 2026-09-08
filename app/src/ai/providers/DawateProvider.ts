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
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { BaseAIProvider, type BaseProviderOptions } from './BaseAIProvider';

/** 请求超时（毫秒）：与云端 Provider 缺省对齐（AI_MODEL_TIMEOUT_MS 默认 300s） */
const DEFAULT_TIMEOUT_MS = 300_000;
/** appKey 缓存时长（毫秒）：平台 appKey 有效期未知，取保守 50 分钟 */
const APPKEY_TTL_MS = 50 * 60_000;

interface DawateHeaders {
  appId?: string;
  agentId?: string;
}

function readHeaders(config?: Record<string, unknown>): DawateHeaders {
  const headers = (config?.['headers'] as Record<string, unknown>) ?? {};
  const pick = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim() ? v.trim() : undefined;
  return {
    appId: pick(headers['appId']),
    agentId: pick(headers['agentId']),
  };
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

  /** appKey 缓存 */
  private appKey: string | null = null;
  private appKeyExpiry = 0;

  /**
   * @param options 基础选项
   * @param extraConfig ProviderConfig（含 headers 里的 appId/agentId）
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

  /** 换取 appKey（带 TTL 缓存；失败抛 AppError 便于上层重试/降级） */
  private async ensureAppKey(): Promise<string> {
    if (this.appKey && this.appKeyExpiry > Date.now()) return this.appKey;
    if (!this.appId || !this.apiKey) {
      throw new AppError(
        '私有化部署未配置完整：需要 baseUrl + apiKey(appSecret) + headers.appId',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'dawate-config'
      );
    }
    const url = `${this.baseUrl}/knowledgeService/extSecret/generateAppKey`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: this.appId, appSecret: this.apiKey }),
        signal: this.resolveTimeoutSignal(),
      });
    } catch (error) {
      throw new AppError(
        `私有化部署换取 appKey 失败: ${(error as Error).message}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'dawate-appkey'
      );
    }
    if (!response.ok) {
      throw new AppError(
        `私有化部署换取 appKey HTTP ${response.status}: ${(
          await response.text().catch(() => '')
        ).slice(0, 300)}`,
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
      throw new AppError(
        '私有化部署换取 appKey 响应缺少 resultObject.appKey',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'dawate-appkey'
      );
    }
    this.appKey = key;
    this.appKeyExpiry = Date.now() + APPKEY_TTL_MS;
    return key;
  }

  private buildChatUrl(): string {
    return `${this.baseUrl}/knowledgeService/extChatApi/v3/chat`;
  }

  /** 流式请求（HTTP 层）→ 逐个 data: 行回调；返回累计正文 */
  private async *streamChat(
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncGenerator<string, void, unknown> {
    if (!this.agentId) {
      throw new AppError(
        '私有化部署未配置 agentId（headers 中）',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'dawate-config'
      );
    }
    const appKey = await this.ensureAppKey();
    const body: Record<string, unknown> = {
      agentId: this.agentId,
      messages: mapMessages(messages),
      ...(options?.maxTokens ? { max_tokens: options.maxTokens } : {}),
      ...(options?.temperature !== undefined
        ? { temperature: options.temperature }
        : {}),
    };

    let response: Response;
    try {
      response = await fetch(this.buildChatUrl(), {
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
      });
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
      throw new AppError(
        `私有化部署对话 HTTP ${response.status}: ${text.slice(0, 300)}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'dawate-chat'
      );
    }

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
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data.includes('[DONE]')) {
          finished = true;
          break;
        }
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(data) as Record<string, unknown>;
        } catch {
          continue; // 跳过畸形 SSE 行
        }
        const choice = (parsed.choices as Array<Record<string, unknown>>)?.[0];
        const delta = choice?.delta as Record<string, unknown> | undefined;
        if (!delta) continue;
        const cumulative = delta['content'];
        if (typeof cumulative !== 'string') continue;
        if (cumulative.length > fullContent.length) {
          const part = cumulative.slice(fullContent.length);
          fullContent = cumulative;
          if (part) yield part;
        }
      }
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
    if (!config.baseUrl)
      errors.push('缺少 baseUrl（私有化服务器地址，如 https://IP:5030）');
    if (!config.apiKey) errors.push('缺少 apiKey（填写平台 appSecret）');
    const headers = readHeaders(config);
    if (!headers.appId) errors.push('headers 缺少 appId');
    if (!headers.agentId) errors.push('headers 缺少 agentId');
    return {
      valid: errors.length === 0,
      errors,
      warnings: [],
    };
  }
}
