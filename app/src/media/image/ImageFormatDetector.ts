import { Logger, LogLevel } from '@modules/monitoring';
import fs from 'node:fs';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 已知图片格式的魔数签名
 */
const MAGIC_BYTES: Record<string, { signature: number[]; offset: number }[]> = {
  png: [
    { signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], offset: 0 },
  ],
  jpeg: [
    { signature: [0xff, 0xd8, 0xff, 0xe0], offset: 0 },
    { signature: [0xff, 0xd8, 0xff, 0xe1], offset: 0 },
    { signature: [0xff, 0xd8, 0xff, 0xe2], offset: 0 },
  ],
  gif: [
    { signature: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61], offset: 0 },
    { signature: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], offset: 0 },
  ],
  webp: [{ signature: [0x52, 0x49, 0x46, 0x46], offset: 0 }],
  bmp: [{ signature: [0x42, 0x4d], offset: 0 }],
};

/**
 * 图片格式检测结果
 */
export interface FormatDetectionResult {
  format: string;
  mimeType: string;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * 图片维度检测结果
 */
export interface DimensionDetectionResult {
  width: number;
  height: number;
  aspectRatio: number;
}

/**
 * ImageFormatDetector
 * 基于魔数（Magic Bytes）的图片格式与维度检测器
 * 不依赖文件扩展名，通过读取文件头部的魔数签名判断真实格式
 */
export class ImageFormatDetector {
  /**
   * 检测图片格式（基于魔数）
   */
  detectFormat(buffer: Buffer): FormatDetectionResult | null {
    for (const [format, signatures] of Object.entries(MAGIC_BYTES)) {
      for (const sig of signatures) {
        if (this.matchesMagic(buffer, sig.signature, sig.offset)) {
          const mimeType = this.formatToMime(format);
          return { format, mimeType, confidence: 'high' };
        }
      }
    }

    return null;
  }

  /**
   * 从文件路径检测图片格式
   * 优先使用魔数，魔数无法识别时回退到扩展名
   */
  detectFormatFromFile(filePath: string): FormatDetectionResult | null {
    try {
      const fd = fs.openSync(filePath, 'r');
      const buffer = Buffer.alloc(12);
      fs.readSync(fd, buffer, 0, 12, 0);
      fs.closeSync(fd);

      const magicResult = this.detectFormat(buffer);
      if (magicResult) return magicResult;

      logger.warn('魔数检测失败，回退到扩展名检测', { filePath });
    } catch {
      logger.warn('图片文件不可读，回退到扩展名检测', { filePath });
    }

    const ext = filePath.split('.').pop()?.toLowerCase();
    if (!ext) return null;

    const extMap: Record<string, string> = {
      png: 'png',
      jpg: 'jpeg',
      jpeg: 'jpeg',
      webp: 'webp',
      gif: 'gif',
      bmp: 'bmp',
    };

    const format = extMap[ext];
    if (!format) return null;

    logger.info('通过扩展名检测图片格式', {
      filePath,
      format,
      confidence: 'low',
    });
    return { format, mimeType: this.formatToMime(format), confidence: 'low' };
  }

  /**
   * 读取图片尺寸（基于魔数解析位置信息）
   */
  detectDimensions(filePath: string): DimensionDetectionResult | null {
    try {
      const format = this.detectFormatFromFile(filePath);
      if (!format) return null;

      const fd = fs.openSync(filePath, 'r');
      const buffer = Buffer.alloc(48);
      const bytesRead = fs.readSync(fd, buffer, 0, 48, 0);
      fs.closeSync(fd);

      if (bytesRead < 24) return null;

      const result = this.parseDimensionsFromBuffer(buffer, format.format);
      return result;
    } catch {
      return null;
    }
  }

  /**
   * 校验文件是否为受支持的图片格式
   */
  isValidImage(filePath: string): boolean {
    return this.detectFormatFromFile(filePath) !== null;
  }

  private matchesMagic(
    buffer: Buffer,
    signature: number[],
    offset: number
  ): boolean {
    if (buffer.length < offset + signature.length) return false;

    for (let i = 0; i < signature.length; i++) {
      if (buffer[offset + i] !== signature[i]) return false;
    }
    return true;
  }

  private formatToMime(format: string): string {
    const mimeMap: Record<string, string> = {
      png: 'image/png',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      bmp: 'image/bmp',
    };
    return mimeMap[format] || `image/${format}`;
  }

  private parseDimensionsFromBuffer(
    buffer: Buffer,
    format: string
  ): DimensionDetectionResult | null {
    let width = 0;
    let height = 0;

    switch (format) {
      case 'png': {
        width = buffer.readUInt32BE(16);
        height = buffer.readUInt32BE(20);
        break;
      }
      case 'jpeg': {
        let offset = 2;
        while (offset + 9 <= buffer.length) {
          if (buffer[offset] === 0xff && buffer[offset + 1] === 0xc0) {
            height = buffer.readUInt16BE(offset + 5);
            width = buffer.readUInt16BE(offset + 7);
            break;
          }
          offset++;
        }
        break;
      }
      case 'gif': {
        width = buffer.readUInt16LE(6);
        height = buffer.readUInt16LE(8);
        break;
      }
      case 'bmp': {
        width = buffer.readInt32LE(18);
        height = Math.abs(buffer.readInt32LE(22));
        break;
      }
    }

    if (width > 0 && height > 0) {
      return {
        width,
        height,
        aspectRatio: parseFloat((width / height).toFixed(2)),
      };
    }

    return null;
  }
}

export const imageFormatDetector = new ImageFormatDetector();
