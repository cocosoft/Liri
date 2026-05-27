import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import fs from 'node:fs';
import {
  imageFormatDetector,
  ImageFormatDetector,
} from './ImageFormatDetector';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 安全检测配置
 */
export interface SecurityConfig {
  /** 最大文件字节数（默认 20MB） */
  maxFileSize: number;
  /** 最大宽度像素 */
  maxWidth: number;
  /** 最大高度像素 */
  maxHeight: number;
  /** 允许的格式白名单 */
  allowedFormats: string[];
  /** 是否禁用外部 URL */
  blockExternalUrls: boolean;
}

/**
 * 安全检测结果
 */
export interface SecurityResult {
  safe: boolean;
  checks: SecurityCheck[];
}

/**
 * 单项检查结果
 */
export interface SecurityCheck {
  name: string;
  passed: boolean;
  detail?: string;
}

const DEFAULT_CONFIG: SecurityConfig = {
  maxFileSize: 20 * 1024 * 1024,
  maxWidth: 8192,
  maxHeight: 8192,
  allowedFormats: ['png', 'jpeg', 'gif', 'webp', 'bmp'],
  blockExternalUrls: true,
};

/**
 * ImageSecurity
 * 图片安全检查器
 * 在加载/处理前验证图片的合法性，防止恶意文件攻击
 */
export class ImageSecurity {
  private config: SecurityConfig;
  private detector: ImageFormatDetector;

  constructor(config?: Partial<SecurityConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.detector = imageFormatDetector;
  }

  /**
   * 对本地文件执行完整安全检查
   */
  checkFile(filePath: string): SecurityResult {
    const checks: SecurityCheck[] = [];

    checks.push(this.checkFileExists(filePath));
    if (!checks[checks.length - 1].passed) {
      const failedCheck = checks[checks.length - 1];
      logger.warn('图片安全检查 · 文件不存在', {
        filePath,
        detail: failedCheck.detail,
      });
      return { safe: false, checks };
    }

    checks.push(this.checkFileSize(filePath));
    checks.push(this.checkFormat(filePath));
    checks.push(this.checkDimensions(filePath));
    checks.push(this.checkMimeConsistency(filePath));

    const safe = checks.every((c) => c.passed);
    if (!safe) {
      const failed = checks
        .filter((c) => !c.passed)
        .map((c) => `${c.name}: ${c.detail}`);
      logger.warn('图片安全检查 · 未通过', {
        filePath,
        failed: failed.join('; '),
      });
    }
    return { safe, checks };
  }

  /**
   * 检查 URL 是否安全
   */
  checkUrl(url: string): SecurityResult {
    const checks: SecurityCheck[] = [];

    if (this.config.blockExternalUrls) {
      logger.warn('图片安全检查 · 外部 URL 被拦截', { url });
      checks.push({
        name: 'external_url',
        passed: false,
        detail: 'External URLs are blocked by security policy',
      });
      return { safe: false, checks };
    }

    checks.push({
      name: 'external_url',
      passed: true,
    });

    return { safe: true, checks };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<SecurityConfig>): void {
    this.config = { ...this.config, ...config };
  }

  private checkFileExists(filePath: string): SecurityCheck {
    try {
      if (!fs.existsSync(filePath)) {
        return { name: 'file_exists', passed: false, detail: 'File not found' };
      }

      const stat = fs.statSync(filePath);
      if (!stat.isFile()) {
        return {
          name: 'file_exists',
          passed: false,
          detail: 'Not a regular file',
        };
      }

      return { name: 'file_exists', passed: true };
    } catch (error) {
      return {
        name: 'file_exists',
        passed: false,
        detail: `File access error: ${(error as Error).message}`,
      };
    }
  }

  private checkFileSize(filePath: string): SecurityCheck {
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > this.config.maxFileSize) {
        return {
          name: 'file_size',
          passed: false,
          detail: `File size ${(stat.size / 1024 / 1024).toFixed(1)}MB exceeds limit ${(this.config.maxFileSize / 1024 / 1024).toFixed(1)}MB`,
        };
      }
      return { name: 'file_size', passed: true };
    } catch (error) {
      return {
        name: 'file_size',
        passed: false,
        detail: `Size check error: ${(error as Error).message}`,
      };
    }
  }

  private checkFormat(filePath: string): SecurityCheck {
    try {
      const format = this.detector.detectFormatFromFile(filePath);
      if (!format) {
        return { name: 'format', passed: false, detail: 'Unknown format' };
      }

      if (!this.config.allowedFormats.includes(format.format)) {
        return {
          name: 'format',
          passed: false,
          detail: `Format '${format.format}' is not in allowed list: ${this.config.allowedFormats.join(', ')}`,
        };
      }

      return { name: 'format', passed: true };
    } catch (error) {
      return {
        name: 'format',
        passed: false,
        detail: `Format check error: ${(error as Error).message}`,
      };
    }
  }

  private checkDimensions(filePath: string): SecurityCheck {
    try {
      const dims = this.detector.detectDimensions(filePath);
      if (!dims) {
        return {
          name: 'dimensions',
          passed: false,
          detail: 'Unable to determine dimensions',
        };
      }

      if (
        dims.width > this.config.maxWidth ||
        dims.height > this.config.maxHeight
      ) {
        return {
          name: 'dimensions',
          passed: false,
          detail: `Dimensions ${dims.width}x${dims.height} exceed limit ${this.config.maxWidth}x${this.config.maxHeight}`,
        };
      }

      return { name: 'dimensions', passed: true };
    } catch (error) {
      return {
        name: 'dimensions',
        passed: false,
        detail: `Dimension check error: ${(error as Error).message}`,
      };
    }
  }

  private checkMimeConsistency(filePath: string): SecurityCheck {
    try {
      const ext = filePath.split('.').pop()?.toLowerCase();
      const format = this.detector.detectFormatFromFile(filePath);

      if (!ext || !format) {
        return {
          name: 'mime_consistency',
          passed: true,
          detail: 'Consistency check skipped',
        };
      }

      const extToFormat: Record<string, string> = {
        png: 'png',
        jpg: 'jpeg',
        jpeg: 'jpeg',
        webp: 'webp',
        gif: 'gif',
        bmp: 'bmp',
      };

      const expectedFormat = extToFormat[ext];
      if (expectedFormat && expectedFormat !== format.format) {
        return {
          name: 'mime_consistency',
          passed: false,
          detail: `Extension '.${ext}' suggests ${expectedFormat} but magic bytes indicate ${format.format}`,
        };
      }

      return { name: 'mime_consistency', passed: true };
    } catch (error) {
      return {
        name: 'mime_consistency',
        passed: true,
        detail: `Consistency check skipped: ${(error as Error).message}`,
      };
    }
  }
}

export const imageSecurity = new ImageSecurity();
