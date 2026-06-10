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
  ToolDefinition,
} from '../models/types';
import type { ProviderConfig, ProviderValidationResult, ThinkingProviderChunk } from './AIProvider';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { configManager } from '@modules/config';
import { ChatCompletionsTransport } from '../transports/ChatCompletionsTransport';
import { TransportProviderAdapter } from '../transports/TransportProviderAdapter';
import { ALL_MODEL_CONFIGS, getModelsByProvider } from '../models/ModelConfigs';
import {
  BaseAIProvider,
  type BaseProviderOptions,
} from './BaseAIProvider';

const logger = new Logger({ level: LogLevel.INFO });

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

export class OpenAIProvider extends BaseAIProvider {
  private apiKey: string;
  private baseUrl: string;

  /**
   * 初始化 OpenAI Provider。
   * 构造函数回退链：DB 持久化 > 环境变量。
   *
   * @param options - 基础选项（providerId, displayName, defaultBaseUrl, envApiKey, defaultModel 等）
   * @param _extraConfig - 扩展配置（保留接口一致）
   */
  constructor(options: BaseProviderOptions, _extraConfig?: Record<string, unknown>) {
    super(options, _extraConfig);

    this.apiKey = this.resolveApiKey() || '';
    this.baseUrl = (this.resolveBaseUrl() || DEFAULT_BASE_URL).replace(/\/+$/, '');

    if (!this.transport) {
      this.transport = new TransportProviderAdapter(new ChatCompletionsTransport());
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
        signal: AbortSignal.timeout(120000),
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
      return this.transport!.toChatResponse(this.transport!.normalizeResponse(data));
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
    const model = this.resolveModel('chat', options);
    const requestBody = this.transport!.buildRequest({
      model,
      messages,
      tools: options?.tools,
      maxTokens: options?.maxTokens || 4096,
      temperature: options?.temperature,
      stream: true,
    });

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(180000),
      });

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
      let fullContent = '';
      let lastUsage:
        | import('@modules/ai/models/types').ChatResponse['usage']
        | undefined;

      while (true) {
        const { done, value } = await reader.read();
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
            const delta = choice?.delta as Record<string, unknown> | undefined;

            // 处理推理内容（OpenAI o1/o3 的 reasoning_content 字段）
            const reasoningContent = delta?.['reasoning_content'] as string | undefined;
            if (reasoningContent) {
              yield { type: 'thinking', content: reasoningContent };
            }

            const content = delta?.content as string | undefined;
            if (content) {
              fullContent += content;
              yield content;
            }
          } catch {
            // skip malformed SSE lines
          }
        }
      }

      return {
        content: fullContent,
        model,
        stop_reason: 'stop',
        usage: lastUsage,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        `OpenAI stream failed: ${(error as Error).message}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
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
    } catch {
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

    const body: Record<string, unknown> = {
      model: 'dall-e-3',
      prompt: params.prompt,
      n: params.n ?? 1,
      size: params.size ?? '1024x1024',
      quality: params.quality ?? 'standard',
      style: params.style ?? 'vivid',
      response_format: 'b64_json',
    };

    if (body.quality === 'hd' && body.size === '1024x1024') {
      body.size = '1792x1024';
    }

    try {
      const response = await fetch(`${this.baseUrl}/images/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120000),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        return {
          success: false,
          data: [],
          error: `DALL-E API error (${response.status}): ${errorBody}`,
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
        model: 'dall-e-3',
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        data: [],
        error: `DALL-E generation failed: ${(error as Error).message}`,
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
      model: '',
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
}
