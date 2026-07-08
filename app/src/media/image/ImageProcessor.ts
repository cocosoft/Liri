/**
 * ImageProcessor 图片处理工具
 * 基于 Sharp 实现实际的图像处理操作（async）
 */

import { Logger, LogLevel } from '@modules/monitoring';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import fs from 'node:fs';
import path from 'path';
import sharp from 'sharp';
import { imageFormatDetector } from './ImageFormatDetector';

const logger = new Logger({ level: LogLevel.INFO, module: 'media:image' });

/** 图片格式 */
export type ImageFormat =
  | 'png'
  | 'jpeg'
  | 'webp'
  | 'gif'
  | 'bmp'
  | 'svg'
  | 'heic'
  | 'heif';

/** 图片尺寸 */
export interface ImageDimensions {
  width: number;
  height: number;
  aspectRatio: number;
}

/** 处理选项 */
export interface ProcessOptions {
  format?: ImageFormat;
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
  grayscale?: boolean;
}

/** 裁剪选项 */
export interface CropOptions {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 调整选项 */
export interface AdjustOptions {
  brightness?: number;
  contrast?: number;
  saturation?: number;
  gamma?: number;
}

/** 水印选项 */
export interface WatermarkOptions {
  text: string;
  position?:
    | 'top-left'
    | 'top-right'
    | 'bottom-left'
    | 'bottom-right'
    | 'center';
  fontSize?: number;
  color?: string;
  opacity?: number;
}

/** 处理结果 */
export interface ProcessResult {
  success: boolean;
  filePath: string;
  originalSize: number;
  processedSize: number;
  dimensions?: ImageDimensions;
  error?: string;
}

export class ImageProcessor {
  /** 转换图片格式 */
  async convert(
    input: string,
    output: string,
    format: ImageFormat
  ): Promise<ProcessResult> {
    const originalSize = fs.statSync(input).size;
    try {
      fs.mkdirSync(path.dirname(output), { recursive: true });
      let pipeline = sharp(input);
      switch (format) {
        case 'png':
          pipeline = pipeline.png();
          break;
        case 'jpeg':
          pipeline = pipeline.jpeg({ quality: 90 });
          break;
        case 'webp':
          pipeline = pipeline.webp({ quality: 90 });
          break;
        case 'gif':
          pipeline = pipeline.gif();
          break;
        default:
          return {
            success: false,
            filePath: output,
            originalSize,
            processedSize: 0,
            error: `Unsupported format: ${format}`,
          };
      }
      const outputBuffer = await pipeline.toBuffer();
      fs.writeFileSync(output, outputBuffer);
      return {
        success: true,
        filePath: output,
        originalSize,
        processedSize: outputBuffer.length,
        dimensions: this.getDimensions(output),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('图片格式转换失败', { input, format, error: msg });
      return {
        success: false,
        filePath: output,
        originalSize,
        processedSize: 0,
        error: msg,
      };
    }
  }

  /** 调整图片大小 */
  async resize(
    input: string,
    output: string,
    options: ProcessOptions
  ): Promise<ProcessResult> {
    const originalSize = fs.statSync(input).size;
    try {
      fs.mkdirSync(path.dirname(output), { recursive: true });
      let pipeline = sharp(input);
      const resizeOpts: sharp.ResizeOptions = {
        fit: 'inside' as const,
        withoutEnlargement: true,
      };
      if (options.maxWidth) resizeOpts.width = options.maxWidth;
      if (options.maxHeight) resizeOpts.height = options.maxHeight;
      pipeline = pipeline.resize(resizeOpts);
      if (options.grayscale) pipeline = pipeline.grayscale();
      const fmt = options.format ?? 'png';
      if (fmt === 'jpeg')
        pipeline = pipeline.jpeg({ quality: options.quality ?? 90 });
      else if (fmt === 'webp')
        pipeline = pipeline.webp({ quality: options.quality ?? 90 });
      else pipeline = pipeline.png({ quality: options.quality ?? 90 });
      const outputBuffer = await pipeline.toBuffer();
      fs.writeFileSync(output, outputBuffer);
      return {
        success: true,
        filePath: output,
        originalSize,
        processedSize: outputBuffer.length,
        dimensions: this.getDimensions(output),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('图片调整大小失败', { input, output, error: msg });
      return {
        success: false,
        filePath: output,
        originalSize,
        processedSize: 0,
        error: msg,
      };
    }
  }

  /** 裁剪图片 */
  async crop(
    input: string,
    output: string,
    options: CropOptions
  ): Promise<ProcessResult> {
    const originalSize = fs.statSync(input).size;
    try {
      fs.mkdirSync(path.dirname(output), { recursive: true });
      const outputBuffer = await sharp(input)
        .extract({
          left: options.x,
          top: options.y,
          width: options.width,
          height: options.height,
        })
        .toBuffer();
      fs.writeFileSync(output, outputBuffer);
      return {
        success: true,
        filePath: output,
        originalSize,
        processedSize: outputBuffer.length,
        dimensions: this.getDimensions(output),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('图片裁剪失败', { input, error: msg });
      return {
        success: false,
        filePath: output,
        originalSize,
        processedSize: 0,
        error: msg,
      };
    }
  }

  /** 旋转图片 */
  async rotate(
    input: string,
    output: string,
    degrees: number
  ): Promise<ProcessResult> {
    const originalSize = fs.statSync(input).size;
    try {
      fs.mkdirSync(path.dirname(output), { recursive: true });
      const outputBuffer = await sharp(input).rotate(degrees).toBuffer();
      fs.writeFileSync(output, outputBuffer);
      return {
        success: true,
        filePath: output,
        originalSize,
        processedSize: outputBuffer.length,
        dimensions: this.getDimensions(output),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('图片旋转失败', { input, error: msg });
      return {
        success: false,
        filePath: output,
        originalSize,
        processedSize: 0,
        error: msg,
      };
    }
  }

  /** 翻转图片 */
  async flip(
    input: string,
    output: string,
    direction: 'horizontal' | 'vertical' | 'both'
  ): Promise<ProcessResult> {
    const originalSize = fs.statSync(input).size;
    try {
      fs.mkdirSync(path.dirname(output), { recursive: true });
      let pipeline = sharp(input);
      if (direction === 'horizontal' || direction === 'both')
        pipeline = pipeline.flop();
      if (direction === 'vertical' || direction === 'both')
        pipeline = pipeline.flip();
      const outputBuffer = await pipeline.toBuffer();
      fs.writeFileSync(output, outputBuffer);
      return {
        success: true,
        filePath: output,
        originalSize,
        processedSize: outputBuffer.length,
        dimensions: this.getDimensions(output),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('图片翻转失败', { input, error: msg });
      return {
        success: false,
        filePath: output,
        originalSize,
        processedSize: 0,
        error: msg,
      };
    }
  }

  /** 添加水印文字 */
  async watermark(
    input: string,
    output: string,
    options: WatermarkOptions
  ): Promise<ProcessResult> {
    const originalSize = fs.statSync(input).size;
    try {
      fs.mkdirSync(path.dirname(output), { recursive: true });
      const meta = await sharp(input).metadata();
      const imgWidth = meta.width ?? 800;
      const imgHeight = meta.height ?? 600;
      const fontSize =
        options.fontSize ??
        Math.max(16, Math.round(Math.min(imgWidth, imgHeight) * 0.05));
      const fontColor = options.color ?? 'rgba(255,255,255,0.5)';
      const padding = fontSize;
      let x = padding,
        y = padding;
      switch (options.position ?? 'bottom-right') {
        case 'top-left':
          x = padding;
          y = padding + fontSize;
          break;
        case 'top-right':
          x = imgWidth - padding;
          y = padding + fontSize;
          break;
        case 'bottom-left':
          x = padding;
          y = imgHeight - padding;
          break;
        case 'bottom-right':
          x = imgWidth - padding;
          y = imgHeight - padding;
          break;
        case 'center':
          x = Math.round(imgWidth / 2);
          y = Math.round(imgHeight / 2);
          break;
      }
      const anchor =
        options.position === 'center'
          ? 'middle'
          : options.position?.endsWith('right')
            ? 'end'
            : 'start';
      const svgText = `<svg width="${imgWidth}" height="${imgHeight}" xmlns="http://www.w3.org/2000/svg"><text x="${x}" y="${y}" font-size="${fontSize}" fill="${fontColor}" text-anchor="${anchor}" font-family="sans-serif">${escapeXml(options.text)}</text></svg>`;
      const outputBuffer = await sharp(input)
        .composite([{ input: Buffer.from(svgText), top: 0, left: 0 }])
        .toBuffer();
      fs.writeFileSync(output, outputBuffer);
      return {
        success: true,
        filePath: output,
        originalSize,
        processedSize: outputBuffer.length,
        dimensions: this.getDimensions(output),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('水印添加失败', { input, error: msg });
      return {
        success: false,
        filePath: output,
        originalSize,
        processedSize: 0,
        error: msg,
      };
    }
  }

  /** 调整亮度/对比度/饱和度/Gamma */
  async adjust(
    input: string,
    output: string,
    options: AdjustOptions
  ): Promise<ProcessResult> {
    const originalSize = fs.statSync(input).size;
    try {
      fs.mkdirSync(path.dirname(output), { recursive: true });
      let pipeline = sharp(input);
      if (
        options.brightness !== undefined ||
        options.saturation !== undefined
      ) {
        pipeline = pipeline.modulate({
          brightness: options.brightness,
          saturation: options.saturation,
        });
      }
      if (options.gamma !== undefined) pipeline = pipeline.gamma(options.gamma);
      const outputBuffer = await pipeline.toBuffer();
      fs.writeFileSync(output, outputBuffer);
      return {
        success: true,
        filePath: output,
        originalSize,
        processedSize: outputBuffer.length,
        dimensions: this.getDimensions(output),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('图片调整失败', { input, error: msg });
      return {
        success: false,
        filePath: output,
        originalSize,
        processedSize: 0,
        error: msg,
      };
    }
  }

  /** 获取图片尺寸（基于魔数检测） */
  getDimensions(filePath: string): ImageDimensions | undefined {
    const magicResult = imageFormatDetector.detectDimensions(filePath);
    if (magicResult)
      return {
        width: magicResult.width,
        height: magicResult.height,
        aspectRatio: magicResult.aspectRatio,
      };
    return undefined;
  }

  /** 获取图片的 Base64 编码 */
  toBase64(filePath: string): string {
    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(filePath).slice(1);
    return `data:image/${ext};base64,${buffer.toString('base64')}`;
  }

  /** 检查是否支持该格式 */
  isFormatSupported(format: string): boolean {
    const supported: ImageFormat[] = [
      'png',
      'jpeg',
      'webp',
      'gif',
      'bmp',
      'svg',
      'heic',
      'heif',
    ];
    return supported.includes(format as ImageFormat);
  }

  // ============================================================
  // P2-1: HEIC 转换 + EXIF 方向归一化
  // ============================================================

  /**
   * HEIC → JPEG 转换
   * 使用 sharp 的 heic 解码能力（需 sharp 版本 >= 0.33 且系统有 libheif）
   */
  async convertHeic(inputPath: string, outputPath?: string): Promise<string> {
    const outPath = outputPath || inputPath.replace(/\.(heic|heif)$/i, '.jpg');

    try {
      await sharp(inputPath).jpeg({ quality: 90 }).toFile(outPath);

      logger.info('ImageProcessor.convertHeic()', {
        inputPath,
        outputPath: outPath,
      });
      return outPath;
    } catch (error) {
      logger.warn(
        'ImageProcessor.convertHeic() · sharp 不支持 heic，尝试 sips/ImageMagick',
        {
          error: (error as Error).message,
        }
      );

      // 回退：尝试系统命令
      try {
        const { execSync } = await import('node:child_process');
        execSync(`magick "${inputPath}" "${outPath}"`, { timeout: 15000 });
        return outPath;
      } catch {
        throw new AppError(
          `HEIC 格式转换失败。请确保安装了 sharp (libheif) 或 ImageMagick。${(error as Error).message}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.MEDIUM,
          'IMAGE_CONVERT_ERROR'
        );
      }
    }
  }

  /**
   * EXIF 方向归一化
   * 读取 JPEG EXIF Orientation 标签，自动旋转/翻转图片到正确方向
   */
  async normalizeExifOrientation(
    inputPath: string,
    outputPath?: string
  ): Promise<string> {
    const outPath = outputPath || inputPath;

    try {
      // sharp 的 rotate() 会自动读取并应用 EXIF Orientation
      await sharp(inputPath)
        .rotate() // auto-orient based on EXIF
        .toFile(outPath + '.tmp');

      fs.renameSync(outPath + '.tmp', outPath);
      logger.info('ImageProcessor.normalizeExifOrientation() · 完成', {
        outPath,
      });
      return outPath;
    } catch (error) {
      logger.warn('ImageProcessor.normalizeExifOrientation() · 失败', {
        error: (error as Error).message,
      });
      return inputPath; // 归一化失败时返回原文件
    }
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export const imageProcessor = new ImageProcessor();
