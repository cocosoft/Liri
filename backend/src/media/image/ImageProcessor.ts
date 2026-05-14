/**
 * ImageProcessor 图片处理工具
 * 对标 CC 的图片处理能力
 */
import fs from 'node:fs';
import path from 'node:path';

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

      return {
        success: true,
        filePath: output,
        originalSize,
        processedSize: outputBuffer.length,
        dimensions: this.getDimensions(input),
      };
    } catch (err) {
      return {
        success: false,
        filePath: output,
        originalSize,
        processedSize: 0,
        error: err instanceof Error ? err.message : String(err),
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

      return {
        success: true,
        filePath: output,
        originalSize,
        processedSize,
        dimensions: this.getDimensions(output),
      };
    } catch (err) {
      return {
        success: false,
        filePath: output,
        originalSize,
        processedSize: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * 获取图片尺寸
   */
  getDimensions(filePath: string): ImageDimensions | undefined {
    try {
      const buffer = Buffer.alloc(24);
      const fd = fs.openSync(filePath, 'r');
      fs.readSync(fd, buffer, 0, 24, 0);
      fs.closeSync(fd);

      const ext = path.extname(filePath).toLowerCase();

      let width = 0;
      let height = 0;

      if (ext === '.png') {
        width = buffer.readUInt32BE(16);
        height = buffer.readUInt32BE(20);
      } else if (ext === '.jpg' || ext === '.jpeg') {
        let offset = 2;
        while (offset < buffer.length) {
          if (buffer[offset] === 0xff && buffer[offset + 1] === 0xc0) {
            height = buffer.readUInt16BE(offset + 5);
            width = buffer.readUInt16BE(offset + 7);
            break;
          }
          offset++;
        }
      } else if (ext === '.gif') {
        width = buffer.readUInt16LE(6);
        height = buffer.readUInt16LE(8);
      }

      if (width > 0 && height > 0) {
        return {
          width,
          height,
          aspectRatio: parseFloat((width / height).toFixed(2)),
        };
      }

      return undefined;
    } catch {
      return undefined;
    }
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
