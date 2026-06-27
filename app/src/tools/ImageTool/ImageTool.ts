/**
 * ImageTool
 * 通用图片编辑工具 — 基于 Sharp 实现
 * 支持 resize / crop / rotate / flip / watermark / adjust / convert / grayscale / info / batch
 */

import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { BaseTool } from '../BaseTool';
import type { ToolResult, ToolUseContext, ToolParam } from '../types/index';

import {
  ImageProcessor,
  type ImageFormat,
  type ProcessResult,
} from '../../media/image/ImageProcessor';
import { imageSanitizationPolicy } from '../../security/policy/ImageSanitizationPolicy';

const logger = new Logger({ level: LogLevel.INFO, module: 'tools:imageTool' });

/**
 * 图片编辑操作参数
 */
export interface ImageEditInput {
  action: 'resize' | 'convert' | 'info' | 'grayscale' | 'crop' | 'rotate' | 'flip' | 'watermark' | 'adjust' | 'batch';
  inputPath: string;
  outputPath?: string;
  width?: number;
  height?: number;
  format?: ImageFormat;
  quality?: number;

  // crop 操作
  cropX?: number;
  cropY?: number;

  // rotate 操作
  degrees?: number;

  // flip 操作
  direction?: 'horizontal' | 'vertical' | 'both';

  // watermark 操作
  watermarkText?: string;
  watermarkPosition?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
  watermarkFontSize?: number;
  watermarkColor?: string;

  // adjust 操作
  brightness?: number;
  contrast?: number;
  saturation?: number;
  gamma?: number;

  // batch 操作
  operations?: ImageEditInput[];
  concurrency?: number;
  stopOnError?: 'continue' | 'abort';
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
  /** 批量操作结果 */
  batchResults?: ImageEditOutput[];
}

const processor = new ImageProcessor();

export class ImageTool extends BaseTool {
  name = 'image';

  description =
    'Edit and manipulate images. Supports resize, crop, rotate, flip, watermark, adjust, ' +
    'format conversion, grayscale filter, metadata info, and batch processing.';

  params: ToolParam[] = [
    {
      name: 'action',
      type: 'string',
      enum: ['resize', 'crop', 'rotate', 'flip', 'watermark', 'adjust', 'convert', 'grayscale', 'info', 'batch'],
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
      description: 'Target width for resize/crop action',
      required: false,
    },
    {
      name: 'height',
      type: 'number',
      description: 'Target height for resize/crop action',
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
    {
      name: 'cropX',
      type: 'number',
      description: 'Crop start X coordinate',
      required: false,
    },
    {
      name: 'cropY',
      type: 'number',
      description: 'Crop start Y coordinate',
      required: false,
    },
    {
      name: 'degrees',
      type: 'number',
      description: 'Rotation degrees (positive = clockwise)',
      required: false,
    },
    {
      name: 'direction',
      type: 'string',
      enum: ['horizontal', 'vertical', 'both'],
      description: 'Flip direction',
      required: false,
    },
    {
      name: 'watermarkText',
      type: 'string',
      description: 'Watermark text',
      required: false,
    },
    {
      name: 'watermarkPosition',
      type: 'string',
      enum: ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'],
      description: 'Watermark position',
      required: false,
    },
    {
      name: 'brightness',
      type: 'number',
      description: 'Brightness multiplier (1.0 = unchanged)',
      required: false,
    },
    {
      name: 'contrast',
      type: 'number',
      description: 'Contrast multiplier (1.0 = unchanged)',
      required: false,
    },
    {
      name: 'saturation',
      type: 'number',
      description: 'Saturation multiplier (1.0 = unchanged)',
      required: false,
    },
    {
      name: 'operations',
      type: 'array',
      description: 'Array of operations for batch processing',
      required: false,
    },
    {
      name: 'concurrency',
      type: 'number',
      description: 'Max concurrent operations for batch (default 4)',
      required: false,
    },
  ];

  async execute(input: any, _context: ToolUseContext): Promise<ToolResult> {
    try {
      const params = input as ImageEditInput;

      if (!params.inputPath) {
        logger.warn('ImageTool · 缺少 inputPath');
        return { success: false, error: 'inputPath is required' };
      }

      if (!fs.existsSync(params.inputPath)) {
        logger.warn('ImageTool · 输入文件不存在', { inputPath: params.inputPath });
        return { success: false, error: `Input file not found: ${params.inputPath}` };
      }

      // 安全检查
      const checkBuffer = fs.readFileSync(params.inputPath);
      const ext = path.extname(params.inputPath).slice(1).toLowerCase();
      const mimeMap: Record<string, string> = {
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
        webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp',
      };
      const checkMime = mimeMap[ext] || `image/${ext}`;
      const sanitizeResult = imageSanitizationPolicy.sanitize(checkBuffer, checkMime);

      if (!sanitizeResult.sanitized) {
        logger.warn('ImageTool · 安全检查未通过', { inputPath: params.inputPath, warnings: sanitizeResult.warnings });
        return { success: false, error: `Image failed security check: ${sanitizeResult.warnings.join(', ')}` };
      }

      logger.info('ImageTool · 执行', { action: params.action, inputPath: params.inputPath });

      switch (params.action) {
        case 'resize':    return this.handleResize(params);
        case 'convert':   return this.handleConvert(params);
        case 'info':      return this.handleInfo(params);
        case 'grayscale': return this.handleGrayscale(params);
        case 'crop':      return this.handleCrop(params);
        case 'rotate':    return this.handleRotate(params);
        case 'flip':      return this.handleFlip(params);
        case 'watermark': return this.handleWatermark(params);
        case 'adjust':    return this.handleAdjust(params);
        case 'batch':     return await this.handleBatch(params);
        default:
          return { success: false, error: `Unknown action: ${params.action}` };
      }
    } catch (error) {
      await handleError(error, { module: 'tools:imageTool', action: (input as ImageEditInput)?.action ?? 'unknown' });
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Image operation failed: ${errorMsg}` };
    }
  }

  // ---- 各操作处理器 ----

  private async handleResize(params: ImageEditInput): Promise<ToolResult> {
    if (!params.width && !params.height) {
      return { success: false, error: 'At least one of width or height is required for resize action' };
    }
    const outputPath = params.outputPath || this.generateOutputPath(params.inputPath, '_resized');
    const result = await processor.resize(params.inputPath, outputPath, {
      maxWidth: params.width,
      maxHeight: params.height,
      quality: params.quality,
    });
    if (!result.success) return { success: false, error: result.error || 'Resize failed' };
    return this.outputToResult('resize', params.inputPath, result);
  }

  private async handleConvert(params: ImageEditInput): Promise<ToolResult> {
    if (!params.format) return { success: false, error: 'Target format is required for convert action' };
    const ext = `.${params.format}`;
    const outputPath = params.outputPath || params.inputPath.replace(path.extname(params.inputPath), ext);
    const result = await processor.convert(params.inputPath, outputPath, params.format);
    if (!result.success) return { success: false, error: result.error || 'Convert failed' };
    return this.outputToResult('convert', params.inputPath, result, { format: params.format });
  }

  private handleInfo(params: ImageEditInput): ToolResult {
    const stat = fs.statSync(params.inputPath);
    const dims = processor.getDimensions(params.inputPath);
    const ext = path.extname(params.inputPath).slice(1);
    const data: ImageEditOutput = {
      action: 'info', inputPath: params.inputPath, originalSize: stat.size,
      width: dims?.width, height: dims?.height, aspectRatio: dims?.aspectRatio, format: ext,
    };
    const info = [
      `File: ${params.inputPath}`,
      `Size: ${(stat.size / 1024).toFixed(1)} KB`,
      `Dimensions: ${dims?.width ?? '?'} x ${dims?.height ?? '?'}`,
      `Format: ${ext}`,
    ];
    return { success: true, data, output: info.join('\n') };
  }

  private async handleGrayscale(params: ImageEditInput): Promise<ToolResult> {
    const outputPath = params.outputPath || this.generateOutputPath(params.inputPath, '_grayscale');
    const result = await processor.resize(params.inputPath, outputPath, { grayscale: true });
    if (!result.success) return { success: false, error: result.error || 'Grayscale conversion failed' };
    return this.outputToResult('grayscale', params.inputPath, result);
  }

  private async handleCrop(params: ImageEditInput): Promise<ToolResult> {
    const x = params.cropX ?? 0;
    const y = params.cropY ?? 0;
    if (!params.width || !params.height) {
      return { success: false, error: 'width and height are required for crop action' };
    }
    const outputPath = params.outputPath || this.generateOutputPath(params.inputPath, '_cropped');
    const result = await processor.crop(params.inputPath, outputPath, { x, y, width: params.width, height: params.height });
    if (!result.success) return { success: false, error: result.error || 'Crop failed' };
    return this.outputToResult('crop', params.inputPath, result);
  }

  private async handleRotate(params: ImageEditInput): Promise<ToolResult> {
    const degrees = params.degrees ?? 90;
    const outputPath = params.outputPath || this.generateOutputPath(params.inputPath, '_rotated');
    const result = await processor.rotate(params.inputPath, outputPath, degrees);
    if (!result.success) return { success: false, error: result.error || 'Rotate failed' };
    return this.outputToResult('rotate', params.inputPath, result);
  }

  private async handleFlip(params: ImageEditInput): Promise<ToolResult> {
    const direction = params.direction ?? 'horizontal';
    const outputPath = params.outputPath || this.generateOutputPath(params.inputPath, `_flipped_${direction}`);
    const result = await processor.flip(params.inputPath, outputPath, direction);
    if (!result.success) return { success: false, error: result.error || 'Flip failed' };
    return this.outputToResult('flip', params.inputPath, result);
  }

  private async handleWatermark(params: ImageEditInput): Promise<ToolResult> {
    if (!params.watermarkText) {
      return { success: false, error: 'watermarkText is required for watermark action' };
    }
    const outputPath = params.outputPath || this.generateOutputPath(params.inputPath, '_watermarked');
    const result = await processor.watermark(params.inputPath, outputPath, {
      text: params.watermarkText,
      position: params.watermarkPosition,
      fontSize: params.watermarkFontSize,
      color: params.watermarkColor,
    });
    if (!result.success) return { success: false, error: result.error || 'Watermark failed' };
    return this.outputToResult('watermark', params.inputPath, result);
  }

  private async handleAdjust(params: ImageEditInput): Promise<ToolResult> {
    if (!params.brightness && !params.contrast && !params.saturation && !params.gamma) {
      return { success: false, error: 'At least one of brightness, contrast, saturation, or gamma is required' };
    }
    const outputPath = params.outputPath || this.generateOutputPath(params.inputPath, '_adjusted');
    const result = await processor.adjust(params.inputPath, outputPath, {
      brightness: params.brightness,
      contrast: params.contrast,
      saturation: params.saturation,
      gamma: params.gamma,
    });
    if (!result.success) return { success: false, error: result.error || 'Adjust failed' };
    return this.outputToResult('adjust', params.inputPath, result);
  }

  /**
   * 批量处理：并发执行多个操作
   */
  private async handleBatch(params: ImageEditInput): Promise<ToolResult> {
    const operations = params.operations ?? [];
    if (operations.length === 0) {
      return { success: false, error: 'operations array is required for batch action' };
    }

    const concurrency = params.concurrency ?? 4;
    const stopOnError = params.stopOnError ?? 'continue';
    const results: ImageEditOutput[] = [];
    const errors: string[] = [];

    // 分批并发执行
    for (let i = 0; i < operations.length; i += concurrency) {
      const batch = operations.slice(i, i + concurrency);
      const batchPromises = batch.map(async (op) => {
        try {
          // 每个 batch 操作继承父级的 inputPath
          const fullOp = { ...op, inputPath: op.inputPath || params.inputPath };
          const result = await this.execute(fullOp, {} as ToolUseContext);
          if (result.success) {
            results.push(result.data as ImageEditOutput);
          } else {
            errors.push(`[${fullOp.action}] ${result.error}`);
          }
          return result;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`[${op.action}] ${msg}`);
          return { success: false, error: msg };
        }
      });

      const batchResults = await Promise.all(batchPromises);

      if (stopOnError === 'abort' && batchResults.some((r) => !r.success)) {
        break;
      }
    }

    const data: ImageEditOutput = {
      action: 'batch',
      inputPath: params.inputPath,
      batchResults: results,
    };

    const output = [
      `Batch processing completed: ${results.length}/${operations.length} succeeded`,
      errors.length > 0 ? `Errors (${errors.length}):\n${errors.map((e) => `  ${e}`).join('\n')}` : '',
    ].filter(Boolean).join('\n');

    return {
      success: errors.length === 0 || stopOnError === 'continue',
      data,
      output,
      error: errors.length > 0 ? `${errors.length} operation(s) failed` : undefined,
    };
  }

  // ---- 辅助方法 ----

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
   * 将 ProcessResult 转为 ImageEditOutput
   */
  private outputToResult(
    action: string,
    inputPath: string,
    result: ProcessResult,
    extra?: Record<string, unknown>
  ): ToolResult {
    const data: ImageEditOutput = {
      action,
      inputPath,
      outputPath: result.filePath,
      originalSize: result.originalSize,
      processedSize: result.processedSize,
      width: result.dimensions?.width,
      height: result.dimensions?.height,
      aspectRatio: result.dimensions?.aspectRatio,
      ...extra,
    };

    const actionLabels: Record<string, string> = {
      resize: 'Image resized',
      convert: `Image converted to ${extra?.format ?? '?'}`,
      grayscale: 'Grayscale image created',
      crop: 'Image cropped',
      rotate: 'Image rotated',
      flip: 'Image flipped',
      watermark: 'Watermark added',
      adjust: 'Image adjusted',
    };

    return {
      success: true,
      data,
      output: `${actionLabels[action] || action}: ${result.filePath}`,
    };
  }
}

/**
 * 创建 ImageTool 实例
 */
export function createImageTool(): ImageTool {
  return new ImageTool();
}
