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
 * StabilityProvider — Stability AI 图像生成 Provider
 *
 * 提供 Stability AI 的图像生成能力，支持 SD3、SDXL 等模型。
 * 纯生图 Provider，chat/chatStream 方法抛 NOT_SUPPORTED。
 *
 * API: https://api.stability.ai/v2beta/stable-image/generate/
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
import { Logger, LogLevel } from '@modules/monitoring';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

const logger = new Logger({
  level: LogLevel.INFO,
  module: 'ai:stability-provider',
});

/** Stability AI 支持的模型 */
const STABILITY_MODELS = [
  { id: 'stable-diffusion-3.5-large', displayName: 'SD 3.5 Large' },
  { id: 'stable-diffusion-3.5-medium', displayName: 'SD 3.5 Medium' },
  { id: 'sd3.5-large-turbo', displayName: 'SD 3.5 Large Turbo' },
  { id: 'sd3.5-medium', displayName: 'SD 3.5 Medium' },
  { id: 'core', displayName: 'Stable Image Core' },
  { id: 'ultra', displayName: 'Stable Image Ultra' },
];

export class StabilityProvider extends BaseAIProvider {
  private apiKey: string | null = null;

  constructor(options: BaseProviderOptions) {
    super(options);
  }

  // ----- AIProvider 必需方法 -----

  async chat(
    _messages: ChatMessage[],
    _options?: ChatOptions
  ): Promise<ChatResponse> {
    throw new AppError(
      'Stability AI 仅支持图像生成，不支持文本对话',
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
      'Stability AI 仅支持图像生成，不支持文本对话',
      ErrorCategory.OPERATION,
      ErrorSeverity.MEDIUM,
      'NOT_SUPPORTED'
    );
  }

  async listModels(): Promise<string[]> {
    return STABILITY_MODELS.map((m) => m.id);
  }

  override validateConfig(_config: ProviderConfig): ProviderValidationResult {
    return { valid: true, errors: [], warnings: [] };
  }

  override setApiKey(key: string): void {
    this.apiKey = key;
  }

  // ----- 图像生成 -----

  /**
   * Stability AI 图像生成
   * POST https://api.stability.ai/v2beta/stable-image/generate/{model}
   * multipart/form-data 提交
   */
  async generateImage(
    params: ImageGenerationParams
  ): Promise<ImageGenerationResult> {
    const startTime = Date.now();
    const modelId =
      params.model || this.options.defaultModel || 'stable-diffusion-3.5-large';

    const apiKey = this.apiKey || process.env['STABILITY_API_KEY'];
    if (!apiKey) {
      return {
        success: false,
        data: [],
        error:
          'STABILITY_API_KEY 未配置。请在环境变量中设置或通过模型管理 UI 配置。',
        durationMs: 0,
      };
    }

    logger.info('StabilityProvider.generateImage()', {
      model: modelId,
      prompt: params.prompt.slice(0, 80),
      size: params.size,
    });

    // 构建 multipart/form-data
    const formData = new FormData();
    formData.append('prompt', params.prompt);
    formData.append('output_format', params.format || 'png');

    // 负面提示词（Stability AI 原生支持）
    if (params.negativePrompt) {
      formData.append('negative_prompt', params.negativePrompt);
    }

    // 纵横比或尺寸
    if (params.size) {
      const [w, h] = params.size.split('x').map(Number);
      if (w && h) {
        formData.append('aspect_ratio', `${w}:${h}`);
      }
    }

    try {
      const response = await fetch(
        `https://api.stability.ai/v2beta/stable-image/generate/${modelId}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: 'application/json',
          },
          body: formData,
          signal: AbortSignal.timeout(120000),
        }
      );

      if (!response.ok) {
        const errorBody = await response.text();
        return {
          success: false,
          data: [],
          error: `Stability AI API 错误 (${response.status}): ${errorBody}`,
          durationMs: Date.now() - startTime,
        };
      }

      const data = (await response.json()) as Record<string, unknown>;

      // Stability 响应格式: { image: "...", finish_reason: "SUCCESS" }
      const base64Image = data.image as string | undefined;
      if (base64Image) {
        return {
          success: true,
          data: [
            {
              url: `data:image/${params.format || 'png'};base64,${base64Image}`,
              b64_json: base64Image,
              alt: params.prompt,
            },
          ],
          model: modelId,
          durationMs: Date.now() - startTime,
        };
      }

      // 某些端点返回 URL
      const imageUrl = data.url as string | undefined;
      if (imageUrl) {
        return {
          success: true,
          data: [{ url: imageUrl, alt: params.prompt }],
          model: modelId,
          durationMs: Date.now() - startTime,
        };
      }

      return {
        success: false,
        data: [],
        error: 'Stability AI 返回格式异常：缺少 image 字段',
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        data: [],
        error: `Stability AI 图像生成失败: ${(error as Error).message}`,
        durationMs: Date.now() - startTime,
      };
    }
  }
}
