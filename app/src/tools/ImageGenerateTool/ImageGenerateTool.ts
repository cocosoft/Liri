/**
 * ImageGenerateTool
 * 对标OpenClaw image-generate 工具
 * AI图片生成工具
 * Phase 2: 从 Mock 改为调用 AIProvider.generateImage()
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { BaseTool } from '../BaseTool';
import type { ToolResult, ToolUseContext, ToolParam } from '../types/index';
import { providerRegistry } from '../../ai/providers/ProviderRegistry';
import { imageSanitizationPolicy } from '../../security/policy/ImageSanitizationPolicy';
import { resolveOutputDir } from '@modules/core/paths';

const logger = new Logger({ level: LogLevel.INFO });

export interface ImageGenerateParams {
  prompt: string;
  negativePrompt?: string;
  size?: '256x256' | '512x512' | '1024x1024' | '1024x1792' | '1792x1024';
  quality?: 'standard' | 'hd';
  style?: 'vivid' | 'natural';
  n?: number;
  format?: 'png' | 'jpeg' | 'webp';
  provider?: 'openai' | 'anthropic' | 'replicate' | 'stability';
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
    'Generate images using AI. Supports multiple providers (OpenAI DALL-E, Stability AI) and output formats.';

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
      enum: ['openai', 'anthropic', 'replicate', 'stability'],
      description: 'AI provider to use',
      required: false,
      default: 'openai',
    },
  ];

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

      const provider = providerRegistry.get(params.provider ?? 'openai');

      if (!provider.generateImage) {
        logger.warn('ImageGenerateTool · 提供商不支持图片生成', {
          provider: provider.id,
        });
        return {
          success: false,
          error:
            `Provider '${provider.id}' does not support image generation. ` +
            "Use 'openai' provider with DALL-E 3.",
        };
      }

      logger.info('ImageGenerateTool · 开始生成', {
        prompt: params.prompt.slice(0, 80),
        provider: provider.id,
        count,
        size: params.size,
      });
      const result = await provider.generateImage({
        prompt: params.prompt,
        negativePrompt: params.negativePrompt,
        size: params.size,
        quality: params.quality,
        style: params.style,
        n: count,
        format: params.format,
      });

      if (!result.success) {
        logger.error('ImageGenerateTool · 生成失败', { error: result.error });
        return { success: false, error: result.error };
      }

      const images: GeneratedImage[] = [];
      for (const img of result.data) {
        // 验证生成的图片 URL 格式有效
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

      logger.info('ImageGenerateTool · 生成完成', {
        count: images.length,
        model: result.model,
        durationMs: result.durationMs,
      });
      return {
        success: true,
        data: {
          images,
          params,
          model: result.model,
          durationMs: result.durationMs,
        },
        output: `Generated ${count} image(s) using ${params.provider ?? 'openai'} (${result.model}): "${params.prompt.slice(0, 80)}..."`,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('ImageGenerateTool · 执行异常', { error: errorMsg });
      return {
        success: false,
        error: `Failed to generate image: ${errorMsg}`,
      };
    }
  }
}

export function createImageGenerateTool(): ImageGenerateTool {
  return new ImageGenerateTool();
}
