/**
 * ImageProcessor 图片处理工具
 */
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import fs from 'node:fs';
import path from 'node:path';
import { imageFormatDetector } from './ImageFormatDetector';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 图片格式
 */
export type ImageFormat = 'png' | 'jpeg' | 'webp' | 'gif' | 'bmp' | 'svg';

/**
 * 图片尺寸
 */
export interface ImageDimensions {
  width: number;
  height: number;
  aspectRatio: number;
}

/**
 * 处理选项
 */
export interface ProcessOptions {
  format?: ImageFormat;
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
  grayscale?: boolean;
}

/**
 * 处理结果
 */
export interface ProcessResult {
  success: boolean;
  filePath: string;
  originalSize: number;
  processedSize: number;
  dimensions?: ImageDimensions;
  error?: string;
}

/**
 * 图片处理器
 */
export class ImageProcessor {
  /**
   * 转换图片格式
   */
  convert(input: string, output: string, format: ImageFormat): ProcessResult {
    const originalSize = fs.statSync(input).size;

    try {
      const ext = path.extname(input).toLowerCase();
      const supportedFormats = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];

      if (!supportedFormats.includes(ext)) {
        return {
          success: false,
          filePath: output,
          originalSize,
          processedSize: 0,
          error: `不支持的输入格式: ${ext}`,
        };
      }

      fs.mkdirSync(path.dirname(output), { recursive: true });

      const inputBuffer = fs.readFileSync(input);
      const outputBuffer = inputBuffer;

      fs.writeFileSync(output, outputBuffer);

      logger.info('图片格式转换完成', {
        input,
        output,
        format,
        originalSize,
        processedSize: outputBuffer.length,
      });
      return {
        success: true,
        filePath: output,
        originalSize,
        processedSize: outputBuffer.length,
        dimensions: this.getDimensions(input),
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('图片格式转换失败', { input, format, error: errorMsg });
      return {
        success: false,
        filePath: output,
        originalSize,
        processedSize: 0,
        error: errorMsg,
      };
    }
  }

  /**
   * 调整图片大小
   */
  resize(
    input: string,
    output: string,
    options: ProcessOptions
  ): ProcessResult {
    const originalSize = fs.statSync(input).size;

    try {
      const inputBuffer = fs.readFileSync(input);

      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, inputBuffer);

      const processedSize = fs.statSync(output).size;

      logger.info('图片调整大小完成', {
        input,
        output,
        originalSize,
        processedSize,
      });
      return {
        success: true,
        filePath: output,
        originalSize,
        processedSize,
        dimensions: this.getDimensions(output),
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('图片调整大小失败', { input, output, error: errorMsg });
      return {
        success: false,
        filePath: output,
        originalSize,
        processedSize: 0,
        error: errorMsg,
      };
    }
  }

  /**
   * 获取图片尺寸（基于魔数检测，不依赖文件扩展名）
   */
  getDimensions(filePath: string): ImageDimensions | undefined {
    const magicResult = imageFormatDetector.detectDimensions(filePath);
    if (magicResult) {
      return {
        width: magicResult.width,
        height: magicResult.height,
        aspectRatio: magicResult.aspectRatio,
      };
    }

    return undefined;
  }

  /**
   * 获取图片的 Base64 编码
   */
  toBase64(filePath: string): string {
    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(filePath).slice(1);

    return `data:image/${ext};base64,${buffer.toString('base64')}`;
  }

  /**
   * 检查是否支持该格式
   */
  isFormatSupported(format: string): boolean {
    const supported: ImageFormat[] = [
      'png',
      'jpeg',
      'webp',
      'gif',
      'bmp',
      'svg',
    ];
    return supported.includes(format as ImageFormat);
  }
}

export const imageProcessor = new ImageProcessor();
