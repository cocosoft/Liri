/**
 * FileReadTool - Image Processor
 * 对标CC FileReadTool imageProcessor.ts
 * 图片处理辅助模块
 */

export type ImageFormat = 'png' | 'jpeg' | 'webp' | 'gif' | 'svg' | 'bmp' | 'tiff';

export interface ImageInfo {
  path: string;
  format: ImageFormat;
  size: number;
  width?: number;
  height?: number;
  mimeType: string;
}

export interface ImageProcessingOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  format?: ImageFormat;
}

const IMAGE_SIGNATURES: Record<string, { format: ImageFormat; mime: string; offset: number }> = {
  '89504E47': { format: 'png', mime: 'image/png', offset: 0 },
  'FFD8FF': { format: 'jpeg', mime: 'image/jpeg', offset: 0 },
  '47494638': { format: 'gif', mime: 'image/gif', offset: 0 },
  '424D': { format: 'bmp', mime: 'image/bmp', offset: 0 },
  '49492A00': { format: 'tiff', mime: 'image/tiff', offset: 0 },
  '4D4D002A': { format: 'tiff', mime: 'image/tiff', offset: 0 },
  '52494646': { format: 'webp', mime: 'image/webp', offset: 0 },
};

const IMAGE_EXTENSIONS: Set<string> = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.tiff', '.tif',
  '.ico', '.avif', '.heic', '.heif',
]);

const MAX_IMAGE_SIZE = 20 * 1024 * 1024;

export function isImageFile(filePath: string): boolean {
  const ext = filePath.toLowerCase().split('.').pop();
  return ext ? IMAGE_EXTENSIONS.has(`.${ext}`) : false;
}

export function getImageFormat(filePath: string): ImageFormat | null {
  const ext = filePath.toLowerCase().split('.').pop();
  const formatMap: Record<string, ImageFormat> = {
    png: 'png', jpg: 'jpeg', jpeg: 'jpeg', gif: 'gif',
    webp: 'webp', svg: 'svg', bmp: 'bmp', tiff: 'tiff', tif: 'tiff',
  };
  return ext ? (formatMap[ext] ?? null) : null;
}

export function detectImageFormat(buffer: Buffer): ImageFormat | null {
  const hex = buffer.toString('hex').toUpperCase();

  for (const [signature, info] of Object.entries(IMAGE_SIGNATURES)) {
    if (hex.startsWith(signature)) {
      return info.format;
    }
  }

  if (buffer[0] === 0x3c) {
    const header = buffer.toString('ascii', 0, Math.min(buffer.length, 200));
    if (header.includes('<svg') || header.includes('<?xml')) {
      return 'svg';
    }
  }

  return null;
}

export function getImageSize(filePath: string): Promise<{ width: number; height: number } | null> {
  const { readFileSync } = require('node:fs');
  const { Buffer } = require('node:buffer');

  try {
    const buffer = readFileSync(filePath);
    const format = detectImageFormat(buffer);

    if (!format) return Promise.resolve(null);

    switch (format) {
      case 'png': {
        if (buffer.length < 24) return Promise.resolve(null);
        return Promise.resolve({
          width: buffer.readUInt32BE(16),
          height: buffer.readUInt32BE(20),
        });
      }
      case 'jpeg': {
        let offset = 2;
        while (offset < buffer.length - 1) {
          if (buffer[offset] !== 0xFF) break;
          const marker = buffer[offset + 1];

          if (marker === 0xC0 || marker === 0xC1 || marker === 0xC2) {
            if (offset + 9 < buffer.length) {
              return Promise.resolve({
                height: buffer.readUInt16BE(offset + 5),
                width: buffer.readUInt16BE(offset + 7),
              });
            }
          }

          const length = buffer.readUInt16BE(offset + 2);
          offset += length + 2;
        }
        return Promise.resolve(null);
      }
      case 'gif': {
        if (buffer.length < 10) return Promise.resolve(null);
        return Promise.resolve({
          width: buffer.readUInt16LE(6),
          height: buffer.readUInt16LE(8),
        });
      }
      case 'bmp': {
        if (buffer.length < 26) return Promise.resolve(null);
        return Promise.resolve({
          width: buffer.readInt32LE(18),
          height: Math.abs(buffer.readInt32LE(22)),
        });
      }
      case 'webp': {
        if (buffer.length < 30) return Promise.resolve(null);
        const vp8Offset = 12;
        if (buffer.slice(vp8Offset, vp8Offset + 4).toString() === 'VP8 ') {
          const w = buffer[vp8Offset + 6] | ((buffer[vp8Offset + 7] & 0x3F) << 8);
          const h = buffer[vp8Offset + 8] | ((buffer[vp8Offset + 9] & 0x3F) << 8);
          return Promise.resolve({ width: w + 1, height: h + 1 });
        }
        return Promise.resolve(null);
      }
      default:
        return Promise.resolve(null);
    }
  } catch {
    return Promise.resolve(null);
  }
}

export function validateImageFile(filePath: string): { valid: boolean; error?: string } {
  const { statSync } = require('node:fs');

  try {
    const stats = statSync(filePath);
    if (!stats.isFile()) {
      return { valid: false, error: 'Path is not a file' };
    }

    if (stats.size > MAX_IMAGE_SIZE) {
      return { valid: false, error: `Image exceeds max size of ${MAX_IMAGE_SIZE / 1024 / 1024}MB` };
    }

    const format = getImageFormat(filePath);
    if (!format) {
      return { valid: false, error: 'Unsupported image format' };
    }

    return { valid: true };
  } catch (error: any) {
    return { valid: false, error: error.message ?? 'Unknown error' };
  }
}

export function formatImageInfo(info: ImageInfo): string {
  const sizeStr = info.size >= 1024 * 1024
    ? `${(info.size / 1024 / 1024).toFixed(2)} MB`
    : info.size >= 1024
      ? `${(info.size / 1024).toFixed(1)} KB`
      : `${info.size} B`;

  const dimStr = info.width && info.height
    ? `${info.width}x${info.height}`
    : 'unknown dimensions';

  return `${info.path} | ${info.format} | ${dimStr} | ${sizeStr}`;
}

export const IMAGE_EXTENSIONS_LIST = Array.from(IMAGE_EXTENSIONS).sort();
export const SUPPORTED_IMAGE_FORMATS: ImageFormat[] = ['png', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'tiff'];
