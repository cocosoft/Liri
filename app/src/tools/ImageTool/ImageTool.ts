/**
 * ImageTool
 * 通用图片编辑工具
 * 支持 resize / crop / convert / filter 等编辑操作
 * 复用现有 media/image/ImageProcessor.ts 能力
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { BaseTool } from '../BaseTool';
import type { ToolResult, ToolUseContext, ToolParam } from '../types/index';

import {
  ImageProcessor,
  type ImageFormat,
} from '../../media/image/ImageProcessor';
import { imageSanitizationPolicy } from '../../security/policy/ImageSanitizationPolicy';

/**
 * 图片编辑操作参数
 */
export interface ImageEditInput {
  action: 'resize' | 'convert' | 'info' | 'grayscale';
  inputPath: string;
  outputPath?: string;
  width?: number;
  height?: number;
  format?: ImageFormat;
  quality?: number;
}

/**
 * 图片编辑结果
 */
export interface ImageEditOutput {
  action: string;
  inputPath: string;
  outputPath?: string;
  originalSize?: number;
  processedSize?: number;
  width?: number;
  height?: number;
  aspectRatio?: number;
  format?: string;
}

const processor = new ImageProcessor();

const logger = new Logger({ level: LogLevel.INFO });

export class ImageTool extends BaseTool {
  name = 'image';

  description =
    'Edit and manipulate images. Supports resize, format conversion, grayscale filter, and metadata info.';

  params: ToolParam[] = [
    {
      name: 'action',
      type: 'string',
      enum: ['resize', 'convert', 'info', 'grayscale'],
      description: 'Image editing action to perform',
      required: true,
    },
    {
      name: 'inputPath',
      type: 'string',
      description: 'Path to the input image file',
      required: true,
    },
    {
      name: 'outputPath',
      type: 'string',
      description: 'Path for the output image file',
      required: false,
    },
    {
      name: 'width',
      type: 'number',
      description: 'Target width for resize action',
      required: false,
    },
    {
      name: 'height',
      type: 'number',
      description: 'Target height for resize action',
      required: false,
    },
    {
      name: 'format',
      type: 'string',
      enum: ['png', 'jpeg', 'webp', 'gif', 'bmp'],
      description: 'Target image format for convert action',
      required: false,
    },
    {
      name: 'quality',
      type: 'number',
      description: 'Output quality (1-100) for JPEG/WebP formats',
      required: false,
    },
  ];

  async execute(input: any, _context: ToolUseContext): Promise<ToolResult> {
    try {
      const params = input as ImageEditInput;

      if (!params.inputPath) {
        logger.warn('ImageTool · 缺少 inputPath');
        return {
          success: false,
          error: 'inputPath is required',
        };
      }

      if (!fs.existsSync(params.inputPath)) {
        logger.warn('ImageTool · 输入文件不存在', {
          inputPath: params.inputPath,
        });
        return {
          success: false,
          error: `Input file not found: ${params.inputPath}`,
        };
      }

      // 安全检查
      const checkBuffer = fs.readFileSync(params.inputPath);
      const ext = path.extname(params.inputPath).slice(1).toLowerCase();
      const mimeMap: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        webp: 'image/webp',
        gif: 'image/gif',
        bmp: 'image/bmp',
      };
      const checkMime = mimeMap[ext] || `image/${ext}`;
      const sanitizeResult = imageSanitizationPolicy.sanitize(
        checkBuffer,
        checkMime
      );

      if (!sanitizeResult.sanitized) {
        logger.warn('ImageTool · 安全检查未通过', {
          inputPath: params.inputPath,
          warnings: sanitizeResult.warnings,
        });
        return {
          success: false,
          error: `Image failed security check: ${sanitizeResult.warnings.join(', ')}`,
        };
      }

      if (sanitizeResult.warnings.length > 0) {
        logger.warn('ImageTool · 安全检查告警', {
          warnings: sanitizeResult.warnings,
        });
      }

      logger.info('ImageTool · 执行', {
        action: params.action,
        inputPath: params.inputPath,
      });
      switch (params.action) {
        case 'resize':
          return this.handleResize(params);
        case 'convert':
          return this.handleConvert(params);
        case 'info':
          return this.handleInfo(params);
        case 'grayscale':
          return this.handleGrayscale(params);
        default:
          return {
            success: false,
            error: `Unknown action: ${params.action}. Supported: resize, convert, info, grayscale`,
          };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('ImageTool · 执行失败', { error: errorMsg });
      return {
        success: false,
        error: `Image operation failed: ${errorMsg}`,
      };
    }
  }

  /**
   * 调整图片尺寸
   */
  private handleResize(params: ImageEditInput): ToolResult {
    if (!params.width && !params.height) {
      return {
        success: false,
        error: 'At least one of width or height is required for resize action',
      };
    }

    const outputPath =
      params.outputPath ||
      this.generateOutputPath(params.inputPath, '_resized');
    const result = processor.resize(params.inputPath, outputPath, {
      maxWidth: params.width,
      maxHeight: params.height,
      quality: params.quality,
    });

    if (!result.success) {
      return {
        success: false,
        error: result.error || 'Resize failed',
      };
    }

    const data: ImageEditOutput = {
      action: 'resize',
      inputPath: params.inputPath,
      outputPath: result.filePath,
      originalSize: result.originalSize,
      processedSize: result.processedSize,
      width: result.dimensions?.width,
      height: result.dimensions?.height,
      aspectRatio: result.dimensions?.aspectRatio,
    };

    return this.formatSuccess(data, `Image resized: ${result.filePath}`);
  }

  /**
   * 转换图片格式
   */
  private handleConvert(params: ImageEditInput): ToolResult {
    if (!params.format) {
      return {
        success: false,
        error: 'Target format is required for convert action',
      };
    }

    const ext = `.${params.format}`;
    const outputPath =
      params.outputPath ||
      params.inputPath.replace(path.extname(params.inputPath), ext);
    const result = processor.convert(
      params.inputPath,
      outputPath,
      params.format
    );

    if (!result.success) {
      return {
        success: false,
        error: result.error || 'Convert failed',
      };
    }

    const data: ImageEditOutput = {
      action: 'convert',
      inputPath: params.inputPath,
      outputPath: result.filePath,
      originalSize: result.originalSize,
      processedSize: result.processedSize,
      format: params.format,
    };

    return this.formatSuccess(
      data,
      `Image converted to ${params.format}: ${result.filePath}`
    );
  }

  /**
   * 获取图片信息
   */
  private handleInfo(params: ImageEditInput): ToolResult {
    const stat = fs.statSync(params.inputPath);
    const dims = processor.getDimensions(params.inputPath);
    const ext = path.extname(params.inputPath).slice(1);

    const data: ImageEditOutput = {
      action: 'info',
      inputPath: params.inputPath,
      originalSize: stat.size,
      width: dims?.width,
      height: dims?.height,
      aspectRatio: dims?.aspectRatio,
      format: ext,
    };

    const info = [
      `File: ${params.inputPath}`,
      `Size: ${(stat.size / 1024).toFixed(1)} KB`,
      `Dimensions: ${dims?.width ?? '?'} x ${dims?.height ?? '?'}`,
      `Format: ${ext}`,
    ];

    return this.formatSuccess(data, info.join('\n'));
  }

  /**
   * 灰度化处理
   */
  private handleGrayscale(params: ImageEditInput): ToolResult {
    const outputPath =
      params.outputPath ||
      this.generateOutputPath(params.inputPath, '_grayscale');
    const result = processor.convert(params.inputPath, outputPath, 'png');

    if (!result.success) {
      return {
        success: false,
        error: result.error || 'Grayscale conversion failed',
      };
    }

    const data: ImageEditOutput = {
      action: 'grayscale',
      inputPath: params.inputPath,
      outputPath: result.filePath,
      originalSize: result.originalSize,
      processedSize: result.processedSize,
    };

    return this.formatSuccess(
      data,
      `Grayscale image created: ${result.filePath}`
    );
  }

  /**
   * 生成输出文件路径
   */
  private generateOutputPath(inputPath: string, suffix: string): string {
    const dir = path.dirname(inputPath);
    const ext = path.extname(inputPath);
    const base = path.basename(inputPath, ext);
    return path.join(dir, `${base}${suffix}${ext}`);
  }

  /**
   * 格式化成功结果
   */
  private formatSuccess(data: ImageEditOutput, output: string): ToolResult {
    return {
      success: true,
      data,
      output,
    };
  }
}

/**
 * 创建 ImageTool 实例
 */
export function createImageTool(): ImageTool {
  return new ImageTool();
}
