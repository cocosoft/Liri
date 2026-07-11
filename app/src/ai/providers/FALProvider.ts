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
  VideoGenerationParams,
  VideoGenerationResult,
} from './AIProvider';
import { Logger, LogLevel } from '@modules/monitoring';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { randomUUID } from 'crypto';
import { normalizeByCaps } from '../../core/media-generation/index.js';

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

/** FAL 视频模型配置（扩展支持 capabilities） */
interface FALVideoModelConfig extends FALModelConfig {
  capabilities: {
    durations: number[];
    aspectRatios: string[];
  };
}

/** FAL.ai 支持的视频生成模型（含能力声明） */
const FAL_VIDEO_MODELS: FALVideoModelConfig[] = [
  {
    id: 'fal-ai/kling-video/v2.1',
    displayName: 'Kling 2.1',
    supports: [
      'prompt',
      'image_url',
      'duration',
      'aspect_ratio',
      'seed',
      'negative_prompt',
    ],
    capabilities: { durations: [5, 10], aspectRatios: ['16:9', '9:16', '1:1'] },
  },
  {
    id: 'fal-ai/kling-video/v1.6',
    displayName: 'Kling 1.6',
    supports: [
      'prompt',
      'image_url',
      'duration',
      'aspect_ratio',
      'seed',
      'negative_prompt',
    ],
    capabilities: { durations: [5, 10], aspectRatios: ['16:9', '9:16', '1:1'] },
  },
  {
    id: 'fal-ai/minimax/video-01-live',
    displayName: 'MiniMax 海螺',
    supports: ['prompt', 'image_url', 'duration', 'aspect_ratio'],
    capabilities: { durations: [5, 10], aspectRatios: ['16:9', '9:16', '1:1'] },
  },
  {
    id: 'fal-ai/runway-gen4',
    displayName: 'Runway Gen-4',
    supports: ['prompt', 'image_url', 'duration', 'aspect_ratio', 'seed'],
    capabilities: { durations: [10], aspectRatios: ['16:9', '9:16'] },
  },
  {
    id: 'fal-ai/runway-gen3/turbo',
    displayName: 'Runway Gen-3 Turbo',
    supports: ['prompt', 'image_url', 'duration', 'aspect_ratio', 'seed'],
    capabilities: { durations: [10], aspectRatios: ['16:9', '9:16'] },
  },
  {
    id: 'fal-ai/veo3',
    displayName: 'Google Veo 3',
    supports: ['prompt', 'duration'],
    capabilities: { durations: [8, 15], aspectRatios: ['16:9'] },
  },
  {
    id: 'fal-ai/haiper-video',
    displayName: 'Haiper Video',
    supports: ['prompt', 'image_url', 'duration'],
    capabilities: { durations: [2, 4, 6], aspectRatios: ['16:9', '9:16'] },
  },
  {
    id: 'fal-ai/hunyuan-video',
    displayName: '混元视频',
    supports: ['prompt', 'image_url', 'duration'],
    capabilities: { durations: [5], aspectRatios: ['16:9'] },
  },
  {
    id: 'fal-ai/wan-video/v2.2',
    displayName: '通义万相 WAN 2.2',
    supports: ['prompt', 'image_url', 'duration', 'aspect_ratio'],
    capabilities: { durations: [5], aspectRatios: ['16:9', '9:16'] },
  },
  {
    id: 'fal-ai/mochi-v1',
    displayName: 'Mochi 1',
    supports: ['prompt', 'duration'],
    capabilities: { durations: [5], aspectRatios: ['16:9'] },
  },
];

/** 将本地图片上传到 FAL /files 获取可访问 URL */
async function uploadImageToFAL(
  imagePath: string,
  apiKey: string
): Promise<string | null> {
  try {
    const file = Bun.file(imagePath);
    const buffer = await file.arrayBuffer();
    const ext = imagePath.split('.').pop()?.toLowerCase() || 'png';
    const mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    const blob = new Blob([buffer], { type: mimeType });
    const formData = new FormData();
    formData.append(
      'file',
      blob,
      imagePath.split(/[/\\]/).pop() || 'image.png'
    );

    const uploadRes = await fetch('https://fal.run/files', {
      method: 'POST',
      headers: { Authorization: `Key ${apiKey}` },
      body: formData,
      signal: AbortSignal.timeout(30000),
    });

    if (!uploadRes.ok) {
      logger.warn('FALProvider . 图片上传失败', { status: uploadRes.status });
      return null;
    }

    const uploadData = (await uploadRes.json()) as Record<string, unknown>;
    return (uploadData.url as string) || null;
  } catch (error) {
    logger.warn('FALProvider . 图片上传异常', { error: String(error) });
    return null;
  }
}

/** 简单的异步等待 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class FALProvider extends BaseAIProvider {
  private apiKey: string | null = null;

  constructor(options: BaseProviderOptions) {
    super(options);
    this.capabilities.videoGeneration = true;
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
    return [...FAL_MODELS, ...FAL_VIDEO_MODELS].map((m) => m.id);
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

  // ----- 视频生成 -----

  /**
   * FAL.ai 视频生成
   * 使用 FAL 异步 API：提交 → 轮询 → 下载
   * 模型 ID 从模型管理（DB）传入，FAL_VIDEO_MODELS 仅作能力提示，不作为校验依据
   */
  async generateVideo(
    params: VideoGenerationParams
  ): Promise<VideoGenerationResult> {
    const startTime = Date.now();
    const modelId =
      params.model ||
      this.options.defaultModel ||
      FAL_VIDEO_MODELS[0]?.id ||
      '';
    // FAL_VIDEO_MODELS 仅作能力提示，模型不在列表中时使用默认值
    const modelConfig = FAL_VIDEO_MODELS.find((m) => m.id === modelId);
    const caps = modelConfig?.capabilities || {
      durations: [5, 10],
      aspectRatios: ['16:9'],
    };

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

    logger.info('FALProvider.generateVideo()', {
      model: modelId,
      prompt: params.prompt.slice(0, 80),
      inModelList: !!modelConfig,
    });

    // 构建请求体 — 传递用户提供的所有参数，FAL API 自行校验
    const body: Record<string, unknown> = { prompt: params.prompt };

    // 图生视频：本地图片 → FAL 上传 → URL
    // 如果 imageUrl 是 localhost（内网不可达），回退到 imagePath 文件上传
    let imageUrl = params.imageUrl;
    if (
      imageUrl &&
      (imageUrl.includes('localhost') || imageUrl.includes('127.0.0.1'))
    ) {
      logger.info('FALProvider . 检测到 localhost URL，改用 imagePath 上传', {
        url: imageUrl.slice(0, 80),
        hasImagePath: !!params.imagePath,
      });
      imageUrl = undefined;
    }
    if (!imageUrl && params.imagePath) {
      const uploadedUrl = await uploadImageToFAL(params.imagePath, apiKey);
      if (uploadedUrl) imageUrl = uploadedUrl;
    }
    if (imageUrl) body.image_url = imageUrl;
    if (params.duration !== undefined)
      body.duration = normalizeByCaps(
        params.duration,
        caps.durations,
        caps.durations[0] || 5
      );
    if (params.aspectRatio)
      body.aspect_ratio = normalizeByCaps(
        params.aspectRatio,
        caps.aspectRatios,
        caps.aspectRatios[0] || '16:9'
      );
    if (params.negativePrompt) body.negative_prompt = params.negativePrompt;
    if (params.seed !== undefined) body.seed = params.seed;

    try {
      // 1. 提交异步任务
      const submitRes = await fetch(`https://fal.run/${modelId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Key ${apiKey}`,
          'x-idempotency-key': randomUUID(),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });

      if (!submitRes.ok) {
        const errorBody = await submitRes.text();
        return {
          success: false,
          data: [],
          error: `FAL.ai API 错误 (${submitRes.status}): ${errorBody}`,
          durationMs: Date.now() - startTime,
        };
      }

      const submitData = (await submitRes.json()) as Record<string, unknown>;
      const requestId = submitData.request_id as string | undefined;
      if (!requestId) {
        return {
          success: false,
          data: [],
          error: 'FAL.ai 视频生成: 未返回 request_id',
          durationMs: Date.now() - startTime,
        };
      }

      // 2. 轮询状态（指数退避 + 错误分类 + 5 分钟超时保护）
      const statusUrl = `https://fal.run/${modelId}/requests/${requestId}/status`;
      const MAX_POLL_TIME = 5 * 60 * 1000;
      let pollInterval = 2000;
      let videoUrl = '';
      let retryCount = 0;

      while (Date.now() - startTime < MAX_POLL_TIME) {
        await sleep(pollInterval);
        pollInterval = Math.min(pollInterval * 1.5, 10000);

        const statusRes = await fetch(statusUrl, {
          headers: { Authorization: `Key ${apiKey}` },
          signal: AbortSignal.timeout(15000),
        });

        // 错误分类处理
        if (!statusRes.ok) {
          if (statusRes.status === 401 || statusRes.status === 403) {
            return {
              success: false,
              data: [],
              error: `FAL API 认证失败 (${statusRes.status})`,
              durationMs: Date.now() - startTime,
            };
          }
          if (statusRes.status === 429) {
            await sleep(10000);
            continue;
          }
          retryCount++;
          if (retryCount > 3) {
            return {
              success: false,
              data: [],
              error: `FAL API 服务不可用 (${statusRes.status}，已重试 ${retryCount} 次)`,
              durationMs: Date.now() - startTime,
            };
          }
          continue;
        }

        const status = (await statusRes.json()) as Record<string, unknown>;
        if (status.status === 'COMPLETED') {
          videoUrl =
            ((status.video as Record<string, unknown>)?.url as string) ||
            ((status.output as Record<string, unknown>)?.video as string) ||
            ((
              (status.result as Record<string, unknown>)?.video as Record<
                string,
                unknown
              >
            )?.url as string) ||
            '';
          break;
        }
        if (status.status === 'FAILED') {
          return {
            success: false,
            data: [],
            error: `FAL.ai 视频生成失败: ${JSON.stringify(status.error || status)}`,
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

      // 3. 下载视频为 Buffer（用于后续 MediaStore 持久化）
      await fetch(videoUrl, { signal: AbortSignal.timeout(60000) }).then((r) =>
        r.arrayBuffer()
      );

      return {
        success: true,
        data: [{ url: videoUrl }],
        durationMs: Date.now() - startTime,
        model: modelId,
      };
    } catch (error) {
      return {
        success: false,
        data: [],
        error: `FAL.ai 视频生成失败: ${(error as Error).message}`,
        durationMs: Date.now() - startTime,
      };
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
