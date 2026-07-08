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
 * FALProvider — FAL.ai 图像生成 Provider
 *
 * 提供 FAL.ai 的图像生成能力，支持 FLUX、Z-Image、Ideogram、Recraft 等多款模型。
 * 纯生图 Provider，chat/chatStream 方法抛 NOT_SUPPORTED。
 *
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
import { randomUUID } from 'crypto';

const logger = new Logger({ level: LogLevel.INFO, module: 'ai:fal-provider' });

/** FAL 模型配置（参照 hermes FAL_MODELS） */
interface FALModelConfig {
  id: string;
  displayName: string;
  /** 支持的尺寸规格 */
  sizes?: string[];
  /** 是否支持 Clarity Upscaler */
  upscale?: boolean;
  /** 参数白名单 — 每个模型只发送其实际支持的参数 */
  supports: string[];
}

/** FAL.ai 支持的生图模型 */
const FAL_MODELS: FALModelConfig[] = [
  {
    id: 'fal-ai/flux/dev',
    displayName: 'FLUX.1 [dev]',
    sizes: ['square_hd', 'landscape_4_3', 'portrait_4_3'],
    supports: [
      'prompt',
      'image_size',
      'num_images',
      'seed',
      'enable_safety_checker',
    ],
  },
  {
    id: 'fal-ai/flux-pro/v1.5',
    displayName: 'FLUX.1 [pro]',
    sizes: ['square_hd', 'landscape_4_3', 'portrait_4_3'],
    upscale: true,
    supports: [
      'prompt',
      'image_size',
      'num_images',
      'seed',
      'enable_safety_checker',
    ],
  },
  {
    id: 'fal-ai/flux-klein/v9',
    displayName: 'FLUX.2 Klein 9B',
    sizes: ['square_hd', 'landscape_4_3', 'portrait_4_3'],
    supports: ['prompt', 'image_size', 'num_images', 'seed'],
  },
  {
    id: 'fal-ai/z-image-turbo',
    displayName: 'Z-Image Turbo',
    sizes: ['square_hd', 'landscape_4_3', 'portrait_4_3'],
    supports: ['prompt', 'image_size', 'num_images', 'seed'],
  },
  {
    id: 'fal-ai/ideogram/v3',
    displayName: 'Ideogram V3',
    sizes: ['square_hd', 'landscape_4_3', 'portrait_4_3'],
    supports: ['prompt', 'image_size', 'num_images', 'seed'],
  },
  {
    id: 'fal-ai/recraft-v4-pro',
    displayName: 'Recraft V4 Pro',
    sizes: ['square_hd', 'landscape_4_3', 'portrait_4_3'],
    supports: ['prompt', 'image_size', 'num_images', 'seed', 'style'],
  },
];

export class FALProvider extends BaseAIProvider {
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
      'FAL.ai 仅支持图像生成，不支持文本对话',
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
      'FAL.ai 仅支持图像生成，不支持文本对话',
      ErrorCategory.OPERATION,
      ErrorSeverity.MEDIUM,
      'NOT_SUPPORTED'
    );
  }

  async listModels(): Promise<string[]> {
    return FAL_MODELS.map((m) => m.id);
  }

  override validateConfig(_config: ProviderConfig): ProviderValidationResult {
    return { valid: true, errors: [], warnings: [] };
  }

  override setApiKey(key: string): void {
    this.apiKey = key;
  }

  // ----- 图像生成 -----

  /**
   * FAL.ai 图像生成
   * POST https://fal.run/{model_id}
   * 参照 hermes 的 supports 白名单模式
   */
  async generateImage(
    params: ImageGenerationParams
  ): Promise<ImageGenerationResult> {
    const startTime = Date.now();
    const modelId =
      params.model || this.options.defaultModel || 'fal-ai/flux/dev';
    const modelConfig = FAL_MODELS.find((m) => m.id === modelId);

    const apiKey = this.apiKey || this.resolveApiKey();
    if (!apiKey) {
      return {
        success: false,
        data: [],
        error:
          'FAL_API_KEY 未配置。请在环境变量中设置 FAL_API_KEY 或通过模型管理 UI 配置。',
        durationMs: 0,
      };
    }

    logger.info('FALProvider.generateImage()', {
      model: modelId,
      prompt: params.prompt.slice(0, 80),
      size: params.size,
    });

    // 构建请求体 — 只包含模型支持的白名单参数
    const body: Record<string, unknown> = {
      prompt: params.prompt,
      image_size: params.size || 'square_hd',
      num_images: params.n ?? 1,
    };

    // 添加 seed 如果模型支持（幂等 key 策略的补充）
    if (modelConfig?.supports.includes('seed')) {
      body.seed = Math.floor(Math.random() * 2147483647);
    }

    try {
      const response = await fetch(`https://fal.run/${modelId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Key ${apiKey}`,
          'x-idempotency-key': randomUUID(),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120000),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        return {
          success: false,
          data: [],
          error: `FAL.ai API 错误 (${response.status}): ${errorBody}`,
          durationMs: Date.now() - startTime,
        };
      }

      const data = (await response.json()) as Record<string, unknown>;

      // FAL 响应格式: { images: [{ url: string, content_type: string, width: number, height: number }] }
      const images = (data.images as Array<Record<string, unknown>>) || [];
      const resultImages = images.map((img: Record<string, unknown>) => ({
        url: (img.url as string) || '',
        alt: params.prompt,
      }));

      // 如果该模型支持 upscale，自动调用 Clarity Upscaler
      if (
        modelConfig?.upscale &&
        resultImages.length > 0 &&
        resultImages[0].url
      ) {
        const upscaledUrl = await this.upscaleImage(
          resultImages[0].url,
          apiKey
        );
        if (upscaledUrl) {
          resultImages[0] = { ...resultImages[0], url: upscaledUrl };
        }
      }

      return {
        success: true,
        data: resultImages,
        model: modelId,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        data: [],
        error: `FAL.ai 图像生成失败: ${(error as Error).message}`,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /** 调用 FAL Clarity Upscaler 进行 2x 超分 */
  private async upscaleImage(
    imageUrl: string,
    apiKey: string
  ): Promise<string | null> {
    try {
      logger.info('FALProvider · 调用 Clarity Upscaler', {
        imageUrl: imageUrl.slice(0, 60),
      });

      const response = await fetch('https://fal.run/fal-ai/clarity-upscaler', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Key ${apiKey}`,
          'x-idempotency-key': randomUUID(),
        },
        body: JSON.stringify({
          image_url: imageUrl,
          upscale_factor: 2,
        }),
        signal: AbortSignal.timeout(120000),
      });

      if (!response.ok) {
        logger.warn('FALProvider · Clarity Upscaler 失败', {
          status: response.status,
        });
        return null;
      }

      const data = (await response.json()) as Record<string, unknown>;
      const images = (data.images as Array<Record<string, unknown>>) || [];
      return (images[0]?.url as string) || null;
    } catch (error) {
      logger.warn('FALProvider · Clarity Upscaler 异常', {
        error: (error as Error).message,
      });
      return null;
    }
  }

  /** 解析 API Key（优先注入的 → 环境变量） */
  override resolveApiKey(): string | undefined {
    if (this.apiKey) return this.apiKey;

    for (const envKey of ['FAL_API_KEY', 'FAL_KEY']) {
      const val = process.env[envKey];
      if (val) return val;
    }
    return undefined;
  }
}
