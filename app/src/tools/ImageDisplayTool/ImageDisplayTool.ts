/**
 * ImageDisplayTool
 * AI 可调用的图片预览工具 — 同时预览多张图片，点击放大，支持引用
 *
 * 参数: images (string[]) — 图片路径或 URL 列表
 * 输出: { images: DisplayImage[] } — 前端渲染缩略图网格
 */
import { Logger, LogLevel } from '@modules/monitoring';
import { BaseTool } from '../BaseTool';
import { ToolResult, ToolUseContext, ToolParam, ToolTag } from '../types/index';
import { ImageUrlHelper } from '../ImageUrlHelper';
import { existsSync, statSync } from 'fs';
import { resolve } from 'path';

const logger = new Logger({
  level: LogLevel.INFO,
  module: 'tools:imageDisplay',
});

export interface DisplayImage {
  /** 前端展示用的 URL */
  url: string;
  /** 图片名称（文件名） */
  name: string;
  /** 文件大小（字节），本地文件可用 */
  size?: number;
  /** 原始路径 */
  originalPath: string;
}

export interface ImageDisplayOutput {
  images: DisplayImage[];
  count: number;
}

export class ImageDisplayTool extends BaseTool {
  name = 'image_display';

  override tags = [ToolTag.READ];

  description =
    'Display/preview images directly in the chat conversation. MUST call this after generating images with image_generate to show results to the user. ' +
    'Users cannot open file paths themselves — images are only visible when you use this tool. ' +
    'Accepts local file paths or URLs. Supports thumbnail grid, click-to-enlarge, and citation.';

  params: ToolParam[] = [
    {
      name: 'images',
      type: 'array',
      description:
        'Array of image file paths or URLs to display. ' +
        'e.g. ["/path/to/photo1.png", "https://example.com/image.jpg"]',
      required: true,
      items: {
        type: 'string',
        description: '图片文件路径或 URL',
      },
    },
  ];

  async execute(
    params: { images: string[] },
    _context: ToolUseContext
  ): Promise<ToolResult<ImageDisplayOutput>> {
    const { images } = params;

    if (!Array.isArray(images) || images.length === 0) {
      return {
        success: false,
        error: 'images 参数必须是非空数组',
      };
    }

    const displayImages: DisplayImage[] = [];

    for (const input of images) {
      if (typeof input !== 'string' || !input.trim()) {
        continue;
      }

      const trimmed = input.trim();

      // URL 直接使用
      if (/^https?:\/\//i.test(trimmed)) {
        const urlParts = trimmed.split('/');
        const name = urlParts[urlParts.length - 1]?.split('?')[0] || 'image';
        displayImages.push({
          url: trimmed,
          name,
          originalPath: trimmed,
        });
        continue;
      }

      // 本地文件路径
      const resolvedPath = resolve(trimmed);
      if (!existsSync(resolvedPath)) {
        logger.warn('图片文件不存在，跳过', { path: resolvedPath });
        continue;
      }

      const displayUrl = ImageUrlHelper.toDisplayUrl(resolvedPath);
      const name =
        ImageUrlHelper.extractFilename(resolvedPath) ||
        resolvedPath.split(/[\\/]/).pop() ||
        'image';

      let size: number | undefined;
      try {
        size = statSync(resolvedPath).size;
      } catch {
        // 忽略 stat 错误
      }

      displayImages.push({
        url: displayUrl,
        name,
        size,
        originalPath: resolvedPath,
      });
    }

    if (displayImages.length === 0) {
      return {
        success: false,
        error: '没有有效的图片可显示（文件不存在或路径无效）',
      };
    }

    logger.info(`显示 ${displayImages.length} 张图片`, {
      count: displayImages.length,
    });

    return {
      success: true,
      data: {
        images: displayImages,
        count: displayImages.length,
      },
    };
  }
}
