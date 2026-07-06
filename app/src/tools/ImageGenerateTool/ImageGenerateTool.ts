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

import { Logger, LogLevel, getOTelTracing } from '@modules/monitoring';
import { SpanStatusCode } from '@opentelemetry/api';
import { handleError } from '@modules/error/handleError';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { BaseTool } from '../BaseTool';
import type { ToolResult, ToolUseContext, ToolParam } from '../types/index';
import { providerRegistry } from '../../ai/providers/ProviderRegistry';
import type { AIProvider } from '../../ai/providers/AIProvider';
import { imageSanitizationPolicy } from '../../security/policy/ImageSanitizationPolicy';
import { resolveOutputDir } from '@modules/core';
import { registerGeneratedMedia } from '@modules/services/file/registerMediaFile';
import { ImageGenerationRouter } from './ImageGenerationRouter';
import type { CostRecord } from './types';
import { RegistryImageProvider } from './providers/RegistryImageProvider';
import {
  resolveModelRoute,
  RouteKey,
} from '../../ai/router/resolveModelRoute.js';

const logger = new Logger({
  level: LogLevel.INFO,
  module: 'tools:imageGenerate',
});

export interface ImageGenerateParams {
  prompt: string;
  /** 生图模型名（由模型管理驱动，不填则从 modelRouter 解析） */
  model?: string;
  negativePrompt?: string;
  /** 图片尺寸，如 "1024x1024"。Provider 决定支持的尺寸 */
  size?: string;
  /** DALL-E 专用：图片质量 */
  quality?: 'standard' | 'hd';
  /** DALL-E 专用：图片风格 */
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
  /** FileRegistry 注册后的本地文件 ID */
  fileId?: string;
  /** 本地持久化虚拟 URL（/v1/images/static/...），供前端显示 */
  localUrl?: string;
  /** 完整文件系统路径，供后续工具（如 image_analysis）直接读取 */
  filePath?: string;
}

export class ImageGenerateTool extends BaseTool {
  name = 'image_generate';

  description =
    'Generate AI images from text descriptions (prompts). Use this when the user ' +
    'asks to create, draw, or generate an image. Supports multiple aspect ratios, ' +
    'quality levels, and output formats. Returns file paths of generated images.';

  params: ToolParam[] = [
    {
      name: 'prompt',
      type: 'string',
      description: 'Text description of the image to generate',
      required: true,
    },
    {
      name: 'model',
      type: 'string',
      description:
        'Image generation model name. Auto-resolved from modelRouter if empty.',
      required: false,
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
      description:
        'Image dimensions (e.g. "1024x1024"). Provider decides supported values.',
      required: false,
      default: '1024x1024',
    },
    {
      name: 'aspectRatio',
      type: 'string',
      description:
        'Aspect ratio (e.g. "1:1", "16:9", "9:16", "4:3", "3:2"). Priority over size.',
      required: false,
    },
    {
      name: 'quality',
      type: 'string',
      enum: ['standard', 'hd'],
      description: 'Image quality (DALL-E only)',
      required: false,
      default: 'standard',
    },
    {
      name: 'style',
      type: 'string',
      enum: ['vivid', 'natural'],
      description: 'Image style (DALL-E only)',
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
  private async getRouter(): Promise<ImageGenerationRouter> {
    if (
      ImageGenerateTool.router &&
      ImageGenerateTool.router.getProviders().length === 0
    ) {
      logger.info(
        'ImageGenerateTool.getRouter() · 检测到空 Provider，重建 Router'
      );
      ImageGenerateTool.router = null;
    }

    if (!ImageGenerateTool.router) {
      logger.info('ImageGenerateTool.getRouter() · 创建 Router（模型驱动）');
      ImageGenerateTool.router = new ImageGenerationRouter();

      try {
        const resolvedModel = await resolveModelRoute(RouteKey.IMAGE_GENERATE);
        if (!resolvedModel) {
          throw new AppError(
            '未配置生图模型，请在模型管理 → 任务分工中设置生图模型',
            ErrorCategory.CONFIGURATION,
            ErrorSeverity.HIGH,
            'NO_IMAGE_MODEL_CONFIGURED'
          );
        }

        const { modelPricingService } =
          await import('../../ai/models/ModelPricingService.js');
        await modelPricingService.initialize();
        const allModels = await modelPricingService.getAllPricing();
        const isUuid =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            resolvedModel
          );
        const modelRecord = allModels.find((m) =>
          isUuid ? m.id === resolvedModel : m.modelId === resolvedModel
        );
        if (!modelRecord) {
          throw new AppError(
            `模型 "${resolvedModel}" 未在 DB 中注册`,
            ErrorCategory.CONFIGURATION,
            ErrorSeverity.HIGH,
            'MODEL_NOT_FOUND'
          );
        }

        let providerRegistryId = modelRecord.providerId;
        try {
          const { getRegistryId } =
            await import('../../ai/providers/ProviderSyncService.js');
          const mapped = getRegistryId(modelRecord.providerId);
          if (mapped) providerRegistryId = mapped;
        } catch {
          /* 不可用时用原始值 */
        }

        let aiProvider: AIProvider;
        try {
          aiProvider = providerRegistry.get(providerRegistryId);
        } catch {
          throw new AppError(
            `Provider "${modelRecord.providerId}" 未注册`,
            ErrorCategory.CONFIGURATION,
            ErrorSeverity.HIGH,
            'PROVIDER_NOT_FOUND'
          );
        }

        if (!aiProvider.generateImage) {
          throw new AppError(
            `Provider "${aiProvider.displayName}" 不支持生图`,
            ErrorCategory.CONFIGURATION,
            ErrorSeverity.HIGH,
            'PROVIDER_NO_IMAGE_SUPPORT'
          );
        }

        const realType = providerRegistry.getProviderTypeById(aiProvider.id);
        const normalized = (realType ?? '').toLowerCase();
        let mappedType:
          | 'openai'
          | 'stability'
          | 'sdwebui'
          | 'replicate'
          | 'fal'
          | null = null;
        if (normalized === 'openai' || normalized === 'custom')
          mappedType = 'openai';
        else if (normalized.includes('stability')) mappedType = 'stability';
        else if (normalized.includes('webui')) mappedType = 'sdwebui';
        else if (normalized === 'replicate') mappedType = 'replicate';
        else if (normalized === 'fal') mappedType = 'fal';
        else if (realType) mappedType = 'openai';

        if (!mappedType) {
          throw new AppError(
            `无法确定 Provider "${aiProvider.displayName}" 的类型`,
            ErrorCategory.CONFIGURATION,
            ErrorSeverity.HIGH,
            'PROVIDER_TYPE_UNKNOWN'
          );
        }

        ImageGenerateTool.router.setProviders([
          new RegistryImageProvider(aiProvider, mappedType),
        ]);
        logger.info('ImageGenerateTool.getRouter() · 模型匹配完成', {
          modelId: modelRecord.modelId,
          provider: aiProvider.displayName,
          mappedType,
        });
      } catch (error) {
        logger.error('ImageGenerateTool · 创建 Router 失败', {
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }
    return ImageGenerateTool.router;
  }

  async execute(input: any, _context: ToolUseContext): Promise<ToolResult> {
    const params = input as ImageGenerateParams;
    logger.info('ImageGenerateTool.execute() 入口', {
      prompt: params.prompt?.slice(0, 80),
      provider: params.provider ?? 'auto',
      size: params.size ?? '1024x1024',
      n: params.n ?? 1,
      hasPrompt: !!params.prompt,
    });

    const otel = getOTelTracing();
    const span = otel.startSpan('image.generate', {
      'tool.name': this.name,
      'image.prompt_length': params.prompt?.length ?? 0,
      'image.count': params.n ?? 1,
      'image.size': params.size ?? '1024x1024',
      'image.provider': params.provider ?? 'auto',
    });

    try {
      if (!params.prompt || typeof params.prompt !== 'string') {
        logger.warn('ImageGenerateTool · 缺少提示词');
        otel.endSpan(span, SpanStatusCode.ERROR, 'missing prompt');
        return {
          success: false,
          error: 'prompt is required and must be a string',
        };
      }

      const count = params.n ?? 1;
      if (count < 1 || count > 4) {
        logger.warn('ImageGenerateTool · 数量超出范围', { n: count });
        otel.endSpan(span, SpanStatusCode.ERROR, 'invalid count');
        return { success: false, error: 'n must be between 1 and 4' };
      }

      // P3-1: 分辨率自动推断（参照 openclaw）
      // 如果有输入参考图且未指定 resolution，自动从图片尺寸推断
      if (!(params as any).resolution && (params as any).inputImage) {
        try {
          const { imageFormatDetector } =
            await import('../../media/image/ImageFormatDetector');
          const inputPath = (params as any).inputImage as string;
          if (inputPath) {
            const dims = imageFormatDetector.detectDimensions(inputPath);
            if (dims) {
              const maxSide = Math.max(dims.width, dims.height);
              const inferred =
                maxSide >= 3000 ? '4K' : maxSide >= 1500 ? '2K' : '1K';
              (params as any).resolution = inferred;
              logger.info('ImageGenerateTool · 分辨率自动推断', {
                inputSize: `${dims.width}x${dims.height}`,
                maxSide,
                inferred,
              });
            }
          }
        } catch {
          // 推断失败不影响主流程
        }
      }

      // 兼容旧调用方式：指定 provider 时跳过 fallback 链，走原有 ProviderRegistry
      if (params.provider) {
        logger.info('ImageGenerateTool · 走兼容模式', {
          provider: params.provider,
        });
        const result = await this.executeWithSpecificProvider(params);
        otel.endSpan(
          span,
          result.success ? SpanStatusCode.OK : SpanStatusCode.ERROR
        );
        return result;
      }

      // 新方式：走 fallback 链
      logger.info('ImageGenerateTool · 走 Router 模式');
      const result = await this.executeWithRouter(params);
      otel.endSpan(
        span,
        result.success ? SpanStatusCode.OK : SpanStatusCode.ERROR
      );
      return result;
    } catch (error) {
      otel.endSpan(
        span,
        SpanStatusCode.ERROR,
        error instanceof Error ? error.message : String(error)
      );
      logger.error('ImageGenerateTool · execute() 异常', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
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
    const router = await this.getRouter();

    // 预先显示费用估算
    const providers = router.getProviders();
    const costEstimates = await Promise.all(
      providers.map(async (p) => ({
        provider: p.name,
        ...(await p.estimateCost({
          prompt: params.prompt,
          model: params.model,
          negativePrompt: params.negativePrompt,
          size: params.size,
          quality: params.quality,
          style: params.style,
          n: params.n,
          format: params.format,
        })),
      }))
    );

    logger.info('ImageGenerateTool · 开始生成 (Router 模式)', {
      prompt: params.prompt.slice(0, 80),
      providers: providers.map((p) => p.name),
      count: params.n ?? 1,
      size: params.size,
    });

    const { result, costBreakdown, totalCostUsd, usedProvider } =
      await router.generate({
        prompt: params.prompt,
        model: params.model,
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

    // 同步注册生成的图片到 FileRegistry，返回本地持久化路径
    const persistedImages: GeneratedImage[] = await Promise.all(
      images.map(async (img) => {
        const fmt = img.format || 'png';
        try {
          const result = await registerGeneratedMedia(
            img.url,
            params.prompt,
            'images',
            fmt
          );
          return {
            ...img,
            fileId: result?.fileId,
            localUrl: result?.savedPath
              ? `/v1/images/static/media/${result.savedPath}`
              : undefined,
            filePath: result?.savedFullPath,
          };
        } catch (err) {
          logger.warn('ImageGenerateTool · 图片注册到本地失败（Router模式）', {
            error: err instanceof Error ? err.message : String(err),
            imgUrl: (img.url || '').slice(0, 200),
          });
          return img;
        }
      })
    );

    return {
      success: true,
      data: {
        images: persistedImages,
        params,
        model: result.model,
        durationMs: result.durationMs,
        usedProvider,
        costBreakdown,
        totalCostUsd,
        costEstimates,
      },
      // 增强的上下文回传：完整 prompt + 参数，让 AI 后续对话可引用图片元数据
      output:
        `[IMAGE_GENERATED]\n` +
        `Generated ${params.n ?? 1} image(s) using ${usedProvider} (${result.model}).\n` +
        `Prompt: "${params.prompt}"\n` +
        `Size: ${params.size ?? '1024x1024'} | Style: ${params.style ?? 'vivid'} | Quality: ${params.quality ?? 'standard'}\n` +
        `Cost: $${totalCostUsd.toFixed(4)}\n` +
        persistedImages
          .map(
            (img, i) =>
              `Image #${i + 1}:\n` +
              `  filePath: ${img.filePath ?? '(not registered)'}\n` +
              `  localUrl: ${img.localUrl ?? '(not registered)'}\n` +
              `  (Use filePath for follow-up tools like image_analysis)`
          )
          .join('\n') +
        `\n(You can reference these images in follow-up requests, e.g. "change the style to watercolor" or "make it larger".)`,
      metadata: {
        images: images.map((img) => ({
          alt: img.alt,
          size: img.size,
          format: img.format,
          provider: usedProvider,
        })),
        model: result.model,
        prompt: params.prompt,
        params: {
          size: params.size,
          style: params.style,
          quality: params.quality,
          n: params.n,
        },
        costUsd: totalCostUsd,
        durationMs: result.durationMs,
      },
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
      model: params.model,
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

    // 同步注册并返回本地持久化路径
    const persistedImages: GeneratedImage[] = await Promise.all(
      images.map(async (img) => {
        const fmt = img.format || 'png';
        try {
          const result = await registerGeneratedMedia(
            img.url,
            params.prompt,
            'images',
            fmt
          );
          return {
            ...img,
            fileId: result?.fileId,
            localUrl: result?.savedPath
              ? `/v1/images/static/media/${result.savedPath}`
              : undefined,
            filePath: result?.savedFullPath,
          };
        } catch (err) {
          logger.warn('ImageGenerateTool · 图片注册到本地失败（兼容模式）', {
            error: err instanceof Error ? err.message : String(err),
            imgUrl: (img.url || '').slice(0, 200),
          });
          return img;
        }
      })
    );

    return {
      success: true,
      data: {
        images: persistedImages,
        params,
        model: result.model,
        durationMs: result.durationMs,
      },
      // 增强的上下文回传：完整 prompt + 参数 + 文件路径，让 AI 后续可引用图片
      output:
        `[IMAGE_GENERATED]\n` +
        `Generated ${params.n ?? 1} image(s) using ${params.provider ?? 'openai'} (${result.model}).\n` +
        `Prompt: "${params.prompt}"\n` +
        `Size: ${params.size ?? '1024x1024'} | Style: ${params.style ?? 'vivid'} | Quality: ${params.quality ?? 'standard'}\n` +
        persistedImages
          .map(
            (img, i) =>
              `Image #${i + 1}:\n` +
              `  filePath: ${img.filePath ?? '(not registered)'}\n` +
              `  localUrl: ${img.localUrl ?? '(not registered)'}\n` +
              `  (Use filePath for follow-up tools like image_analysis)`
          )
          .join('\n') +
        `\n(You can reference these images in follow-up requests, e.g. "change the style to watercolor" or "make it larger".)`,
      metadata: {
        images: images.map((img) => ({
          alt: img.alt,
          size: img.size,
          format: img.format,
          provider: params.provider ?? 'openai',
        })),
        model: result.model,
        prompt: params.prompt,
        params: {
          size: params.size,
          style: params.style,
          quality: params.quality,
          n: params.n,
        },
        durationMs: result.durationMs,
      },
    };
  }
}

export function createImageGenerateTool(): ImageGenerateTool {
  return new ImageGenerateTool();
}
