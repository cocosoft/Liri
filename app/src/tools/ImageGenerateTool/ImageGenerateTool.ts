/**
 * ImageGenerateTool
 * AI 图片生成工具 — 多后端 Provider + fallback 链架构
 *
 * 支持 Provider:
 *   - OpenAI DALL-E 3 (默认)
 *   - Stability AI Ultra
 *   - SD WebUI (本地)
 *   - Replicate Flux
 *
 * Fallback 链：按启用顺序依次尝试，全部失败返回聚合错误
 * 缓存：prompt 精确匹配 + 归一化，TTL 默认 1 小时
 */

import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';
import { BaseTool } from '../BaseTool';
import type { ToolResult, ToolUseContext, ToolParam } from '../types/index';
import { providerRegistry } from '../../ai/providers/ProviderRegistry';
import { imageSanitizationPolicy } from '../../security/policy/ImageSanitizationPolicy';
import { resolveOutputDir } from '@modules/core';
import { registerGeneratedMedia } from '@modules/services/file/registerMediaFile';
import { ImageGenerationRouter } from './ImageGenerationRouter';
import type { ImageGenerationConfig, CostRecord } from './types';

const logger = new Logger({
  level: LogLevel.INFO,
  module: 'tools:imageGenerate',
});

export interface ImageGenerateParams {
  prompt: string;
  negativePrompt?: string;
  size?: '256x256' | '512x512' | '1024x1024' | '1024x1792' | '1792x1024';
  quality?: 'standard' | 'hd';
  style?: 'vivid' | 'natural';
  n?: number;
  format?: 'png' | 'jpeg' | 'webp';
  /** 指定 Provider 类型（跳过 fallback 链），兼容旧调用方式 */
  provider?: 'openai' | 'stability' | 'sdwebui' | 'replicate';
}

export interface GeneratedImage {
  url: string;
  alt: string;
  size: string;
  format: string;
  provider: string;
  seed?: number;
}

export class ImageGenerateTool extends BaseTool {
  name = 'image_generate';

  description =
    'Generate images using AI. Supports multiple providers (OpenAI DALL-E, Stability AI, SD WebUI, Replicate Flux) ' +
    'with automatic fallback and optional output formats.';

  params: ToolParam[] = [
    {
      name: 'prompt',
      type: 'string',
      description: 'Text description of the image to generate',
      required: true,
    },
    {
      name: 'negativePrompt',
      type: 'string',
      description: 'What to avoid in the generated image',
      required: false,
    },
    {
      name: 'size',
      type: 'string',
      enum: ['256x256', '512x512', '1024x1024', '1024x1792', '1792x1024'],
      description: 'Image dimensions',
      required: false,
      default: '1024x1024',
    },
    {
      name: 'quality',
      type: 'string',
      enum: ['standard', 'hd'],
      description: 'Image quality',
      required: false,
      default: 'standard',
    },
    {
      name: 'style',
      type: 'string',
      enum: ['vivid', 'natural'],
      description: 'Image style',
      required: false,
      default: 'vivid',
    },
    {
      name: 'n',
      type: 'number',
      description: 'Number of images to generate (1-4)',
      required: false,
      default: 1,
    },
    {
      name: 'format',
      type: 'string',
      enum: ['png', 'jpeg', 'webp'],
      description: 'Output image format',
      required: false,
      default: 'png',
    },
    {
      name: 'provider',
      type: 'string',
      enum: ['openai', 'stability', 'sdwebui', 'replicate'],
      description:
        'AI provider to use. If not specified, uses the fallback chain.',
      required: false,
    },
  ];

  /** 全局 Router 实例（懒加载） */
  private static router: ImageGenerationRouter | null = null;

  /** 获取 Router 实例 */
  private getRouter(): ImageGenerationRouter {
    if (!ImageGenerateTool.router) {
      ImageGenerateTool.router = new ImageGenerationRouter(
        this.getProviderConfig()
      );
    }
    return ImageGenerateTool.router;
  }

  /**
   * 从环境变量构建 Provider 配置
   */
  private getProviderConfig(): Partial<ImageGenerationConfig> {
    const openaiKey =
      process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY;
    const stabilityKey = process.env.STABILITY_API_KEY;
    const replicateKey = process.env.REPLICATE_API_KEY;
    const sdEndpoint = process.env.SD_WEBUI_URL;

    return {
      providers: [
        {
          name: 'OpenAI DALL-E 3',
          type: 'openai',
          apiKey: openaiKey,
          enabled: !!openaiKey,
        },
        {
          name: 'Stability AI',
          type: 'stability',
          apiKey: stabilityKey,
          enabled: !!stabilityKey,
        },
        {
          name: 'SD WebUI (Local)',
          type: 'sdwebui',
          endpoint: sdEndpoint,
          enabled: !!sdEndpoint,
        },
        {
          name: 'Replicate Flux',
          type: 'replicate',
          apiKey: replicateKey,
          enabled: !!replicateKey,
        },
      ],
    };
  }

  async execute(input: any, _context: ToolUseContext): Promise<ToolResult> {
    try {
      const params = input as ImageGenerateParams;

      if (!params.prompt || typeof params.prompt !== 'string') {
        logger.warn('ImageGenerateTool · 缺少提示词');
        return {
          success: false,
          error: 'prompt is required and must be a string',
        };
      }

      const count = params.n ?? 1;
      if (count < 1 || count > 4) {
        logger.warn('ImageGenerateTool · 数量超出范围', { n: count });
        return { success: false, error: 'n must be between 1 and 4' };
      }

      // 兼容旧调用方式：指定 provider 时跳过 fallback 链，走原有 ProviderRegistry
      if (params.provider) {
        return await this.executeWithSpecificProvider(params);
      }

      // 新方式：走 fallback 链
      return await this.executeWithRouter(params);
    } catch (error) {
      await handleError(error, {
        module: 'tools:imageGenerate',
        action: 'execute',
      });
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Failed to generate image: ${errorMsg}` };
    }
  }

  /**
   * 通过新的 Router 执行图片生成（fallback 链）
   */
  private async executeWithRouter(
    params: ImageGenerateParams
  ): Promise<ToolResult> {
    const router = this.getRouter();

    // 预先显示费用估算
    const providers = router.getProviders();
    const costEstimates = providers.map((p) => ({
      provider: p.name,
      ...p.estimateCost({
        prompt: params.prompt,
        negativePrompt: params.negativePrompt,
        size: params.size,
        quality: params.quality,
        style: params.style,
        n: params.n,
        format: params.format,
      }),
    }));

    logger.info('ImageGenerateTool · 开始生成 (Router 模式)', {
      prompt: params.prompt.slice(0, 80),
      providers: providers.map((p) => p.name),
      count: params.n ?? 1,
      size: params.size,
    });

    const { result, costBreakdown, totalCostUsd, usedProvider } =
      await router.generate({
        prompt: params.prompt,
        negativePrompt: params.negativePrompt,
        size: params.size,
        quality: params.quality,
        style: params.style,
        n: params.n ?? 1,
        format: params.format,
      });

    if (!result.success) {
      logger.error('ImageGenerateTool · 生成失败 (Router)', {
        error: result.error,
        costBreakdown,
      });
      return {
        success: false,
        error: result.error,
        data: {
          costBreakdown,
          totalCostUsd,
          providerErrors: costBreakdown
            .filter((c) => c.status === 'failed')
            .map((c) => c.provider),
        },
      };
    }

    const images: GeneratedImage[] = [];
    for (const img of result.data) {
      if (
        !img.url ||
        typeof img.url !== 'string' ||
        img.url.trim().length === 0
      ) {
        logger.warn('ImageGenerateTool · 生成的图片 URL 无效', {
          url: img.url,
        });
        continue;
      }

      images.push({
        url: img.url,
        alt: params.prompt.slice(0, 100),
        size: params.size ?? '1024x1024',
        format: params.format ?? 'png',
        provider: usedProvider,
      });
    }

    if (images.length === 0) {
      logger.error('ImageGenerateTool · 所有生成的图片均未通过安全检查');
      return {
        success: false,
        error: 'All generated images failed security checks',
      };
    }

    logger.info('ImageGenerateTool · 生成完成 (Router)', {
      count: images.length,
      usedProvider,
      model: result.model,
      durationMs: result.durationMs,
      totalCostUsd,
    });

    // 异步注册生成的图片到 FileRegistry
    Promise.resolve().then(async () => {
      for (const img of images) {
        const fmt = img.format || 'png';
        await registerGeneratedMedia(img.url, params.prompt, 'images', fmt);
      }
    });

    return {
      success: true,
      data: {
        images,
        params,
        model: result.model,
        durationMs: result.durationMs,
        usedProvider,
        costBreakdown,
        totalCostUsd,
        costEstimates,
      },
      output: `Generated ${params.n ?? 1} image(s) via ${usedProvider} (${result.model}): "${params.prompt.slice(0, 80)}..." | Cost: $${totalCostUsd.toFixed(4)}`,
    };
  }

  /**
   * 通过原有的 ProviderRegistry 执行（兼容旧接口）
   */
  private async executeWithSpecificProvider(
    params: ImageGenerateParams
  ): Promise<ToolResult> {
    const provider = providerRegistry.get(params.provider ?? 'openai');

    if (!provider.generateImage) {
      logger.warn('ImageGenerateTool · 提供商不支持图片生成', {
        provider: provider.id,
      });
      return {
        success: false,
        error: `Provider '${provider.id}' does not support image generation. Use 'openai' provider with DALL-E 3.`,
      };
    }

    logger.info('ImageGenerateTool · 开始生成 (兼容模式)', {
      prompt: params.prompt.slice(0, 80),
      provider: provider.id,
      count: params.n ?? 1,
      size: params.size,
    });

    const result = await provider.generateImage({
      prompt: params.prompt,
      negativePrompt: params.negativePrompt,
      size: params.size,
      quality: params.quality,
      style: params.style,
      n: params.n ?? 1,
      format: params.format,
    });

    if (!result.success) {
      logger.error('ImageGenerateTool · 生成失败 (兼容模式)', {
        error: result.error,
      });
      return { success: false, error: result.error };
    }

    const images: GeneratedImage[] = [];
    for (const img of result.data) {
      if (
        !img.url ||
        typeof img.url !== 'string' ||
        img.url.trim().length === 0
      ) {
        logger.warn('ImageGenerateTool · 生成的图片 URL 无效', {
          url: img.url,
        });
        continue;
      }
      images.push({
        url: img.url,
        alt: params.prompt.slice(0, 100),
        size: params.size ?? '1024x1024',
        format: params.format ?? 'png',
        provider: params.provider ?? 'openai',
      });
    }

    if (images.length === 0) {
      logger.error('ImageGenerateTool · 所有生成的图片均未通过安全检查');
      return {
        success: false,
        error: 'All generated images failed security checks',
      };
    }

    logger.info('ImageGenerateTool · 生成完成 (兼容模式)', {
      count: images.length,
      model: result.model,
      durationMs: result.durationMs,
    });

    // 异步注册
    Promise.resolve().then(async () => {
      for (const img of images) {
        const fmt = img.format || 'png';
        await registerGeneratedMedia(img.url, params.prompt, 'images', fmt);
      }
    });

    return {
      success: true,
      data: {
        images,
        params,
        model: result.model,
        durationMs: result.durationMs,
      },
      output: `Generated ${params.n ?? 1} image(s) using ${params.provider ?? 'openai'} (${result.model}): "${params.prompt.slice(0, 80)}..."`,
    };
  }
}

export function createImageGenerateTool(): ImageGenerateTool {
  return new ImageGenerateTool();
}
