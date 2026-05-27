/**
 * 图片验证工具
 *
 * 验证图片是否符合API限制。
 * 在API边界检查base64编码图片是否超过大小限制。
 */
import { API_IMAGE_MAX_BASE64_SIZE } from '../constants/apiLimits';

/**
 * 超限图片信息
 */
export interface OversizedImage {
  index: number;
  size: number;
}

/**
 * 图片大小超限错误
 */
export class ImageSizeError extends Error {
  constructor(oversizedImages: OversizedImage[], maxSize: number) {
    let message: string;
    const firstImage = oversizedImages[0];
    if (oversizedImages.length === 1 && firstImage) {
      message =
        `Image base64 size (${formatFileSize(firstImage.size)}) exceeds API limit (${formatFileSize(maxSize)}). ` +
        `Please resize the image before sending.`;
    } else {
      message =
        `${oversizedImages.length} images exceed the API limit (${formatFileSize(maxSize)}): ` +
        oversizedImages
          .map((img) => `Image ${img.index}: ${formatFileSize(img.size)}`)
          .join(', ') +
        `. Please resize these images before sending.`;
    }
    super(message);
    this.name = 'ImageSizeError';
  }
}

/**
 * 格式化文件大小
 */
function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

/**
 * 检查消息块是否为 base64 图片块
 */
function isBase64ImageBlock(
  block: unknown
): block is { type: 'image'; source: { type: 'base64'; data: string } } {
  if (typeof block !== 'object' || block === null) return false;
  const b = block as Record<string, unknown>;
  if (b.type !== 'image') return false;
  if (typeof b.source !== 'object' || b.source === null) return false;
  const source = b.source as Record<string, unknown>;
  return source.type === 'base64' && typeof source.data === 'string';
}

/**
 * 验证消息中所有图片是否在API大小限制内
 *
 * 在API边界检查是否有超限图片。
 * API的5MB限制适用于base64编码字符串长度，而非解码后原始字节。
 * 支持 UserMessage（{ type, message }）和原始 MessageParam（{ role, content }）。
 *
 * @param messages - 待验证的消息数组
 * @throws ImageSizeError - 如果有图片超过API限制
 */
export function validateImagesForAPI(messages: unknown[]): void {
  const oversizedImages: OversizedImage[] = [];
  let imageIndex = 0;

  for (const msg of messages) {
    if (typeof msg !== 'object' || msg === null) continue;

    const m = msg as Record<string, unknown>;

    if (m.type !== 'user') continue;

    const innerMessage = m.message as Record<string, unknown> | undefined;
    if (!innerMessage) continue;

    const content = innerMessage.content;
    if (typeof content === 'string' || !Array.isArray(content)) continue;

    for (const block of content) {
      if (isBase64ImageBlock(block)) {
        imageIndex++;
        const base64Size = block.source.data.length;
        if (base64Size > API_IMAGE_MAX_BASE64_SIZE) {
          oversizedImages.push({ index: imageIndex, size: base64Size });
        }
      }
    }
  }

  if (oversizedImages.length > 0) {
    throw new ImageSizeError(oversizedImages, API_IMAGE_MAX_BASE64_SIZE);
  }
}

/**
 * 计算 base64 编码后的大小
 *
 * @param rawSize - 原始字节数
 * @returns base64 编码后的近似长度
 */
export function base64EncodedSize(rawSize: number): number {
  return Math.ceil((rawSize * 4) / 3);
}
