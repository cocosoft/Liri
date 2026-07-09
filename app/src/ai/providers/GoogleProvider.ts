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
 * Google Gemini Provider
 *
 * 使用 GeminiTransport，通过 std/fetch 直连 Google Generative Language API，
 * URL 格式为 `${baseUrl}/models/${model}:generateContent?key=${apiKey}`，
 * 支持 Vision 图片分析。
 */

import type {
  ChatMessage,
  ChatResponse,
  ToolDefinition,
} from '../models/types';
import type { ProviderConfig, ProviderValidationResult } from './AIProvider';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { Logger, LogLevel } from '@modules/monitoring';
import { configManager } from '@modules/config';
import { GeminiTransport } from '../transports/GeminiTransport';
import { TransportProviderAdapter } from '../transports/TransportProviderAdapter';
import { ALL_MODEL_CONFIGS, getModelsByProvider } from '../models/ModelConfigs';
import { BaseAIProvider, type BaseProviderOptions } from './BaseAIProvider';

const logger = new Logger({ module: 'ai:google', level: LogLevel.INFO });

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export class GoogleProvider extends BaseAIProvider {
  private apiKey: string;
  private baseUrl: string;

  /**
   * 初始化 Google Gemini Provider。
   * 构造函数回退链：DB 持久化 > 环境变量。
   *
   * @param options - 基础选项
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
      this.transport = new TransportProviderAdapter(new GeminiTransport());
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
    const model = await this.resolveModel('chat', options);
    const { systemPrompt } = this.transport!.splitMessages(messages);

    const requestBody = this.transport!.buildRequest({
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
      return this.transport!.toChatResponse(
        this.transport!.normalizeResponse(data),
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
    const model = await this.resolveModel('chat', options);
    const { systemPrompt } = this.transport!.splitMessages(messages);

    const requestBody = this.transport!.buildRequest({
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
      // 使用带连接重试的 fetch，应对 Provider API 网关偶发断连
      const response = await BaseAIProvider.fetchWithConnectionRetry(url, {
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

  override validateConfig(config: ProviderConfig): ProviderValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!config.apiKey && !configManager.env('GOOGLE_API_KEY')) {
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

  /**
   * Gemini Vision 图片分析
   * 走 generateContent API 的 inlineData
   */
  async analyzeImage(
    params: import('./AIProvider').VisionAnalysisParams
  ): Promise<import('./AIProvider').VisionAnalysisResult> {
    const startTime = Date.now();
    const base64 = params.imageBuffer.toString('base64');

    const requestBody = {
      contents: [
        {
          parts: [
            { text: params.prompt || 'Describe this image in detail.' },
            {
              inline_data: {
                mime_type: params.mimeType,
                data: base64,
              },
            },
          ],
        },
      ],
    };

    const model = params.model;
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
        return {
          success: false,
          description: '',
          error: `Gemini Vision error (${response.status}): ${errorBody}`,
          durationMs: Date.now() - startTime,
        };
      }

      const data = (await response.json()) as Record<string, unknown>;
      const candidate = (
        data.candidates as Array<Record<string, unknown>>
      )?.[0];
      const content = candidate?.content as Record<string, unknown> | undefined;
      const parts = content?.parts as
        | Array<Record<string, unknown>>
        | undefined;
      const text =
        parts
          ?.map((p) => p.text as string)
          .filter(Boolean)
          .join('') || '';

      return {
        success: true,
        description: text,
        model,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        description: '',
        error: `Gemini Vision failed: ${(error as Error).message}`,
        durationMs: Date.now() - startTime,
      };
    }
  }
}
