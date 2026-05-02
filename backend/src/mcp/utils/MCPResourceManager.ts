/**
 * MCP资源类型管理器
 * 支持图片、二进制资源的处理
 * 参考CC源码实现
 */

import { logger } from '../../utils/log';

/**
 * 资源类型
 */
export type MCPResourceType = 'text' | 'image' | 'binary' | 'json' | 'unknown';

/**
 * 图片资源
 */
export interface MCPImageResource {
  type: 'image';
  mimeType: string;
  data: string; // base64编码
  width?: number;
  height?: number;
  size?: number;
}

/**
 * 二进制资源
 */
export interface MCPBinaryResource {
  type: 'binary';
  mimeType: string;
  data: string; // base64编码
  size?: number;
}

/**
 * 文本资源
 */
export interface MCPTextResource {
  type: 'text';
  mimeType: string;
  data: string;
  encoding?: string;
}

/**
 * 统一资源格式
 */
export type MCPResource = MCPImageResource | MCPBinaryResource | MCPTextResource;

/**
 * 资源处理配置
 */
export interface ResourceProcessingConfig {
  maxImageWidth: number;
  maxImageHeight: number;
  maxImageSizeBytes: number;
  maxBinarySizeBytes: number;
  imageQuality: 'low' | 'medium' | 'high';
  enableAutoResize: boolean;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: ResourceProcessingConfig = {
  maxImageWidth: 2048,
  maxImageHeight: 2048,
  maxImageSizeBytes: 5 * 1024 * 1024, // 5MB
  maxBinarySizeBytes: 10 * 1024 * 1024, // 10MB
  imageQuality: 'medium',
  enableAutoResize: true,
};

/**
 * 资源类型检测结果
 */
export interface ResourceTypeDetection {
  type: MCPResourceType;
  mimeType: string;
  extension?: string;
}

/**
 * 资源类型管理器
 */
export class MCPResourceManager {
  private config: ResourceProcessingConfig;

  constructor(config: Partial<ResourceProcessingConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 检测资源类型
   */
  detectResourceType(data: string, mimeType?: string): ResourceTypeDetection {
    // 如果提供了MIME类型，直接使用
    if (mimeType) {
      return {
        type: this.getTypeFromMime(mimeType),
        mimeType,
        extension: this.getExtensionFromMime(mimeType),
      };
    }

    // 尝试从数据特征检测
    const trimmed = data.trim();

    // JSON检测
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        JSON.parse(trimmed);
        return { type: 'json', mimeType: 'application/json' };
      } catch {
        // 不是有效的JSON
      }
    }

    // Base64图片检测
    if (this.isBase64Image(trimmed)) {
      const detectedMime = this.detectImageMimeFromBase64(trimmed);
      return {
        type: 'image',
        mimeType: detectedMime,
        extension: this.getExtensionFromMime(detectedMime),
      };
    }

    // 纯文本检测
    if (this.isTextData(data)) {
      return { type: 'text', mimeType: 'text/plain' };
    }

    return { type: 'unknown', mimeType: 'application/octet-stream' };
  }

  /**
   * 处理资源数据
   */
  async processResource(
    data: string,
    mimeType?: string
  ): Promise<MCPResource> {
    const detection = this.detectResourceType(data, mimeType);

    switch (detection.type) {
      case 'image':
        return this.processImageResource(data, detection.mimeType);

      case 'binary':
        return this.processBinaryResource(data, detection.mimeType);

      case 'json':
      case 'text':
        return this.processTextResource(data, detection.mimeType);

      default:
        return this.processBinaryResource(data, 'application/octet-stream');
    }
  }

  /**
   * 处理图片资源
   */
  async processImageResource(data: string, mimeType: string): Promise<MCPImageResource> {
    let imageData = data;

    // 移除可能的data URI前缀
    if (imageData.includes(',')) {
      const parts = imageData.split(',');
      imageData = parts[parts.length - 1];
    }

    const size = this.getBase64Size(imageData);

    // 检查是否需要压缩
    if (this.config.enableAutoResize && size > this.config.maxImageSizeBytes) {
      logger.warn(`Image size ${size} exceeds max ${this.config.maxImageSizeBytes}, but auto-resize not fully implemented`);
    }

    return {
      type: 'image',
      mimeType,
      data: imageData,
      size,
    };
  }

  /**
   * 处理二进制资源
   */
  processBinaryResource(data: string, mimeType: string): MCPBinaryResource {
    let binaryData = data;

    // 移除可能的data URI前缀
    if (binaryData.includes(',')) {
      const parts = binaryData.split(',');
      binaryData = parts[parts.length - 1];
    }

    const size = this.getBase64Size(binaryData);

    return {
      type: 'binary',
      mimeType,
      data: binaryData,
      size,
    };
  }

  /**
   * 处理文本资源
   */
  processTextResource(data: string, mimeType: string): MCPTextResource {
    let textData = data;

    // 移除可能的data URI前缀
    if (data.startsWith('data:')) {
      const commaIndex = data.indexOf(',');
      if (commaIndex > -1) {
        textData = data.substring(commaIndex + 1);
      }
    }

    return {
      type: 'text',
      mimeType,
      data: textData,
      encoding: 'utf-8',
    };
  }

  /**
   * 验证资源大小
   */
  validateResourceSize(data: string, type: MCPResourceType): { valid: boolean; error?: string } {
    const size = this.getBase64Size(data);

    switch (type) {
      case 'image':
        if (size > this.config.maxImageSizeBytes) {
          return {
            valid: false,
            error: `Image size ${size} exceeds maximum ${this.config.maxImageSizeBytes}`,
          };
        }
        break;

      case 'binary':
        if (size > this.config.maxBinarySizeBytes) {
          return {
            valid: false,
            error: `Binary size ${size} exceeds maximum ${this.config.maxBinarySizeBytes}`,
          };
        }
        break;
    }

    return { valid: true };
  }

  /**
   * 从MIME类型获取资源类型
   */
  private getTypeFromMime(mimeType: string): MCPResourceType {
    if (mimeType.startsWith('image/')) {
      return 'image';
    }

    if (mimeType.startsWith('text/') || mimeType === 'application/json') {
      return 'text';
    }

    if (
      mimeType.startsWith('audio/') ||
      mimeType.startsWith('video/') ||
      mimeType.startsWith('application/')
    ) {
      return 'binary';
    }

    return 'unknown';
  }

  /**
   * 从MIME类型获取扩展名
   */
  private getExtensionFromMime(mimeType: string): string {
    const map: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/svg+xml': 'svg',
      'text/plain': 'txt',
      'application/json': 'json',
      'application/octet-stream': 'bin',
    };

    return map[mimeType] || 'bin';
  }

  /**
   * 检测Base64图片的MIME类型
   */
  private detectImageMimeFromBase64(data: string): string {
    // 检查PNG魔数
    if (data.startsWith('iVBOR')) {
      return 'image/png';
    }

    // 检查JPEG魔数
    if (data.startsWith('/9j/')) {
      return 'image/jpeg';
    }

    // 检查GIF魔数
    if (data.startsWith('R0lGO')) {
      return 'image/gif';
    }

    // 检查WebP魔数
    if (data.startsWith('UklGR')) {
      return 'image/webp';
    }

    return 'image/png';
  }

  /**
   * 检查是否为Base64图片
   */
  private isBase64Image(data: string): boolean {
    if (!data || data.length < 20) {
      return false;
    }

    const patterns = [
      /^data:image\//,
      /^iVBOR/,
      /^\/9j\//,
      /^R0lGO/,
      /^UklGR/,
    ];

    return patterns.some(p => p.test(data));
  }

  /**
   * 检查是否为文本数据
   */
  private isTextData(data: string): boolean {
    try {
      const decoded = atob(data.substring(0, 100));
      return /^[\\x20-\\x7E\\n\\r\\t]*$/.test(decoded);
    } catch {
      // 如果无法解码为Base64，尝试直接检查
      return /^[\\x20-\\x7E\\n\\r\\t]*$/.test(data);
    }
  }

  /**
   * 计算Base64数据大小
   */
  private getBase64Size(data: string): number {
    const padding = (data.match(/=/g) || []).length;
    return Math.floor((data.length * 3) / 4) - padding;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<ResourceProcessingConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取当前配置
   */
  getConfig(): ResourceProcessingConfig {
    return { ...this.config };
  }
}

/**
 * 导出单例
 */
export const mcpResourceManager = new MCPResourceManager();
