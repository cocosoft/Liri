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
 * OpenAICodexProvider — 无 API Key 生图 Provider
 *
 * 通过 ChatGPT/Codex OAuth 令牌调 Codex Responses API 的 image_generation 工具，
 * 无需单独申请 OpenAI API Key。适合 ChatGPT Plus/Pro 订阅用户。
 *
 * 参照：
 * - hermes plugins/image_gen/openai-codex/__init__.py
 * - openclaw extensions/openai/image-generation-provider.ts (Codex OAuth 双路径)
 */

import { BaseAIProvider, type BaseProviderOptions } from './BaseAIProvider';
import type { ChatMessage, ChatResponse } from '../models/types';
import type {
  ChatOptions,
  ThinkingProviderChunk,
  ProviderConfig,
  ProviderValidationResult,
  ImageGenerationParams,
  ImageGenerationResult,
} from './AIProvider';
import { getLogger } from '@modules/monitoring';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

const logger = getLogger('ai:codex-provider');

export class OpenAICodexProvider extends BaseAIProvider {
  private accessToken: string | null = null;

  constructor(options: BaseProviderOptions) {
    super(options);
  }

  // ----- AIProvider 必需方法 -----

  async chat(
    _messages: ChatMessage[],
    _options?: ChatOptions
  ): Promise<ChatResponse> {
    throw new AppError(
      'OpenAI Codex 仅支持图像生成，不支持文本对话。请使用标准 OpenAI Provider 进行对话。',
      ErrorCategory.OPERATION,
      ErrorSeverity.MEDIUM,
      'NOT_SUPPORTED'
    );
  }

  async *chatStream(
    _messages: ChatMessage[],
    _options?: ChatOptions
  ): AsyncGenerator<string | ThinkingProviderChunk, ChatResponse, unknown> {
    throw new AppError(
      'OpenAI Codex 仅支持图像生成，不支持文本对话',
      ErrorCategory.OPERATION,
      ErrorSeverity.MEDIUM,
      'NOT_SUPPORTED'
    );
  }

  async listModels(): Promise<string[]> {
    return ['gpt-image-2', 'gpt-image-1.5'];
  }

  override validateConfig(_config: ProviderConfig): ProviderValidationResult {
    // Codex Provider 使用 OAuth 令牌而非 API Key
    if (!this.accessToken) {
      return {
        valid: false,
        errors: ['未配置 ChatGPT 会话令牌。请先完成 OAuth 认证。'],
        warnings: [],
      };
    }
    return { valid: true, errors: [], warnings: [] };
  }

  override setApiKey(key: string): void {
    this.accessToken = key;
  }

  // ----- 图像生成 -----

  /**
   * 通过 Codex Responses API 生成图片（无 API Key 方案）
   *
   * POST https://api.openai.com/v1/responses
   * 使用 gpt-image-2 模型 + image_generation tool
   * 参照 openclaw 的 SSE 流式读取
   */
  async generateImage(
    params: ImageGenerationParams
  ): Promise<ImageGenerationResult> {
    const startTime = Date.now();
    const model = params.model || 'gpt-image-2';

    if (!this.accessToken) {
      return {
        success: false,
        data: [],
        error: '未配置 ChatGPT 会话令牌。请在模型管理中设置 Codex 访问令牌。',
        durationMs: 0,
      };
    }

    logger.info('OpenAICodexProvider.generateImage()', {
      model,
      prompt: params.prompt.slice(0, 80),
      size: params.size,
    });

    const body: Record<string, unknown> = {
      model,
      input: params.prompt,
      tools: [
        {
          type: 'image_generation' as const,
        },
      ],
      tool_choice: {
        type: 'image_generation' as const,
      },
    };

    // 品质档位
    if (params.quality) {
      body.quality = params.quality === 'hd' ? 'high' : 'medium';
    }

    // 尺寸
    if (params.size) {
      body.size = params.size;
    }

    // 生成数量
    if (params.n && params.n > 1) {
      body.n = params.n;
    }

    try {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.accessToken}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180000),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        const errLower = errorBody.toLowerCase();

        // 令牌过期提示
        if (errLower.includes('unauthorized') || errLower.includes('token')) {
          return {
            success: false,
            data: [],
            error: 'ChatGPT 会话令牌已过期，请重新完成 OAuth 认证。',
            durationMs: Date.now() - startTime,
          };
        }

        return {
          success: false,
          data: [],
          error: `Codex API 错误 (${response.status}): ${errorBody}`,
          durationMs: Date.now() - startTime,
        };
      }

      const data = (await response.json()) as Record<string, unknown>;

      // Codex Responses API 返回格式:
      // { output: [{ type: "image_generation", image_url: "...", ... }] }
      const output = data.output as Array<Record<string, unknown>> | undefined;

      if (!output || output.length === 0) {
        return {
          success: false,
          data: [],
          error: 'Codex 返回空结果',
          durationMs: Date.now() - startTime,
        };
      }

      const images: Array<{ url: string; alt: string }> = [];

      for (const item of output) {
        if (item.type === 'image_generation' || item.type === 'image') {
          const imageUrl = item.image_url as string;
          if (imageUrl) {
            images.push({ url: imageUrl, alt: params.prompt });
          }
        }
      }

      if (images.length === 0) {
        return {
          success: false,
          data: [],
          error: 'Codex 响应中未找到图片',
          durationMs: Date.now() - startTime,
        };
      }

      return {
        success: true,
        data: images,
        model: model,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        data: [],
        error: `Codex 图像生成失败: ${(error as Error).message}`,
        durationMs: Date.now() - startTime,
      };
    }
  }
}
