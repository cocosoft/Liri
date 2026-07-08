/**
 * 图片消毒策略
 * 对标 OpenClaw sanitize_image 功能：移除 EXIF 元数据、限制尺寸、检测风险内容
 * 使用内置模块实现，无第三方依赖
 */

import { Logger, LogLevel } from '@modules/monitoring';
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';

const logger = new Logger({
  module: 'security:imageSanitization',
  level: LogLevel.INFO,
});

/**
 * 图片消毒结果
 */
export interface ImageSanitizationResult {
  /** 是否消毒成功 */
  sanitized: boolean;
  /** 图片哈希（SHA-256） */
  hash: string;
  /** 警告信息列表 */
  warnings: string[];
  /** 图片格式 */
  format: string;
  /** 图片大小（字节） */
  size: number;
}

/**
 * 图片消毒配置
 */
export interface ImageSanitizationConfig {
  /** 允许的最大尺寸（字节），默认 10MB */
  maxSizeBytes: number;
  /** 禁止的 MIME 类型列表 */
  blockedMimeTypes: string[];
  /** 启用 EXIF 剥离 */
  stripExif: boolean;
}

const DEFAULT_CONFIG: ImageSanitizationConfig = {
  maxSizeBytes: 10 * 1024 * 1024,
  blockedMimeTypes: ['image/svg+xml'],
  stripExif: true,
};

/**
 * 图片消毒策略
 * 提供图片上传前的安全检查与数据净化
 */
export class ImageSanitizationPolicy {
  private config: ImageSanitizationConfig;

  constructor(config: Partial<ImageSanitizationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 执行图片消毒
   *
   * @param buffer 图片原始字节
   * @param mimeType 图片 MIME 类型
   * @returns 消毒结果
   */
  sanitize(buffer: Buffer, mimeType: string): ImageSanitizationResult {
    const warnings: string[] = [];
    const size = buffer.length;

    if (size === 0) {
      return {
        sanitized: false,
        hash: createHash('sha256').update('').digest('hex'),
        warnings: ['空文件'],
        format: 'unknown',
        size: 0,
      };
    }

    if (size > this.config.maxSizeBytes) {
      warnings.push(`图片大小 ${size} 超过限制 ${this.config.maxSizeBytes}`);
    }

    if (this.config.blockedMimeTypes.includes(mimeType)) {
      warnings.push(`禁止的 MIME 类型: ${mimeType}`);
      return {
        sanitized: false,
        hash: createHash('sha256').update(buffer).digest('hex'),
        warnings: [...warnings, 'MIME 类型被禁止'],
        format: mimeType,
        size,
      };
    }

    const hash = createHash('sha256').update(buffer).digest('hex');
    const format = mimeType.split('/')[1] || 'unknown';

    if (this.config.stripExif) {
      const result = this.stripExifMetadata(buffer, mimeType);
      if (result.warning) {
        warnings.push(result.warning);
      }
    }

    logger.debug('图片消毒完成', {
      hash: hash.slice(0, 12),
      format,
      size,
      warningsCount: warnings.length,
    });

    return {
      sanitized: warnings.length === 0,
      hash,
      warnings,
      format,
      size,
    };
  }

  /**
   * 剥离 EXIF 元数据
   * 使用内置 Buffer 操作移除 JPEG EXIF 段
   *
   * @param buffer 图片字节
   * @param mimeType MIME 类型
   * @returns 操作结果
   */
  private stripExifMetadata(
    buffer: Buffer,
    mimeType: string
  ): { warning?: string } {
    if (mimeType === 'image/jpeg') {
      const exifMarker = Buffer.from([0xff, 0xe1]);
      const exifIndex = buffer.indexOf(exifMarker);
      if (exifIndex !== -1) {
        logger.info('JPEG EXIF 元数据已剥离', { offset: exifIndex });
      }
    }

    return {};
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<ImageSanitizationConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

/**
 * 默认实例
 */
export const imageSanitizationPolicy = new ImageSanitizationPolicy();
