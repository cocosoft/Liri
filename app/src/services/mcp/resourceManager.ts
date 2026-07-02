/**
 * 资源管理
 * 负责处理MCP服务器的资源功能（集合管理 + 资源类型处理）
 */

import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({
  module: 'services:mcp:resourceManager',
  level: LogLevel.INFO,
});
import type { ServerResource } from './types';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

// ----- 增强层：资源类型处理 -----

export type MCPResourceType = 'text' | 'image' | 'binary' | 'json' | 'unknown';

export interface MCPImageResource {
  type: 'image';
  mimeType: string;
  data: string;
  width?: number;
  height?: number;
  size?: number;
}

export interface MCPBinaryResource {
  type: 'binary';
  mimeType: string;
  data: string;
  size?: number;
}

export interface MCPTextResource {
  type: 'text';
  mimeType: string;
  data: string;
  encoding?: string;
}

export type MCPResource =
  | MCPImageResource
  | MCPBinaryResource
  | MCPTextResource;

export interface ResourceProcessingConfig {
  maxImageWidth: number;
  maxImageHeight: number;
  maxImageSizeBytes: number;
  maxBinarySizeBytes: number;
  imageQuality: 'low' | 'medium' | 'high';
  enableAutoResize: boolean;
}

const DEFAULT_RESOURCE_CONFIG: ResourceProcessingConfig = {
  maxImageWidth: 2048,
  maxImageHeight: 2048,
  maxImageSizeBytes: 5 * 1024 * 1024,
  maxBinarySizeBytes: 10 * 1024 * 1024,
  imageQuality: 'medium',
  enableAutoResize: true,
};

export interface ResourceTypeDetection {
  type: MCPResourceType;
  mimeType: string;
  extension?: string;
}

/**
 * MCP资源类型管理器（处理资源类型检测和转换）
 */
export class MCPResourceManager {
  private config: ResourceProcessingConfig;

  constructor(config: Partial<ResourceProcessingConfig> = {}) {
    this.config = { ...DEFAULT_RESOURCE_CONFIG, ...config };
  }

  detectResourceType(data: string, mimeType?: string): ResourceTypeDetection {
    if (mimeType) {
      return {
        type: this.getTypeFromMime(mimeType),
        mimeType,
        extension: this.getExtensionFromMime(mimeType),
      };
    }

    const trimmed = data.trim();

    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        JSON.parse(trimmed);
        return { type: 'json', mimeType: 'application/json' };
      } catch {
        // 不是有效的JSON
      }
    }

    if (this.isBase64Image(trimmed)) {
      const detectedMime = this.detectImageMimeFromBase64(trimmed);
      return {
        type: 'image',
        mimeType: detectedMime,
        extension: this.getExtensionFromMime(detectedMime),
      };
    }

    if (this.isTextData(data)) {
      return { type: 'text', mimeType: 'text/plain' };
    }

    return { type: 'unknown', mimeType: 'application/octet-stream' };
  }

  async processResource(data: string, mimeType?: string): Promise<MCPResource> {
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

  async processImageResource(
    data: string,
    mimeType: string
  ): Promise<MCPImageResource> {
    let imageData = data;
    if (imageData.includes(',')) {
      const parts = imageData.split(',');
      imageData = parts[parts.length - 1];
    }
    return {
      type: 'image',
      mimeType,
      data: imageData,
      size: this.getBase64Size(imageData),
    };
  }

  processBinaryResource(data: string, mimeType: string): MCPBinaryResource {
    let binaryData = data;
    if (binaryData.includes(',')) {
      const parts = binaryData.split(',');
      binaryData = parts[parts.length - 1];
    }
    return {
      type: 'binary',
      mimeType,
      data: binaryData,
      size: this.getBase64Size(binaryData),
    };
  }

  processTextResource(data: string, mimeType: string): MCPTextResource {
    let textData = data;
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

  private getTypeFromMime(mimeType: string): MCPResourceType {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('text/') || mimeType === 'application/json')
      return 'text';
    if (
      mimeType.startsWith('audio/') ||
      mimeType.startsWith('video/') ||
      mimeType.startsWith('application/')
    )
      return 'binary';
    return 'unknown';
  }

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

  private detectImageMimeFromBase64(data: string): string {
    if (data.startsWith('iVBOR')) return 'image/png';
    if (data.startsWith('/9j/')) return 'image/jpeg';
    if (data.startsWith('R0lGO')) return 'image/gif';
    if (data.startsWith('UklGR')) return 'image/webp';
    return 'image/png';
  }

  private isBase64Image(data: string): boolean {
    if (!data || data.length < 20) return false;
    const patterns = [/^data:image\//, /^iVBOR/, /^\/9j\//, /^R0lGO/, /^UklGR/];
    return patterns.some((p) => p.test(data));
  }

  private isTextData(data: string): boolean {
    try {
      const decoded = atob(data.substring(0, 100));
      return /^[\x20-\x7E\n\r\t]*$/.test(decoded);
    } catch {
      return /^[\x20-\x7E\n\r\t]*$/.test(data);
    }
  }

  private getBase64Size(data: string): number {
    const padding = (data.match(/=/g) || []).length;
    return Math.floor((data.length * 3) / 4) - padding;
  }
}

// ----- 标准层：资源集合管理 -----

/**
 * 资源管理器（集合管理）
 */
export class ResourceManager {
  private resources: Map<string, ServerResource[]> = new Map();

  /**
   * 从MCP服务器加载资源
   */
  async loadResourcesFromServer(
    client: Client,
    serverName: string
  ): Promise<ServerResource[]> {
    try {
      const resources = await (client as any).resources.list();
      const serverResources: ServerResource[] = (resources as any[]).map(
        (resource: any) => ({
          ...resource,
          server: serverName,
        })
      );

      this.resources.set(serverName, serverResources);
      logger.info(
        `Loaded ${serverResources.length} resources from server ${serverName}`
      );
      return serverResources;
    } catch (error) {
      logger.error(
        `Failed to load resources from server ${serverName}:`,
        error instanceof Error ? error : new Error(String(error))
      );
      return [];
    }
  }

  /**
   * 获取所有资源
   */
  getResources(): ServerResource[] {
    return Array.from(this.resources.values()).flat();
  }

  /**
   * 获取服务器的资源
   */
  getServerResources(serverName: string): ServerResource[] {
    return this.resources.get(serverName) || [];
  }

  /**
   * 获取单个资源
   */
  getResource(
    serverName: string,
    resourceUri: string
  ): ServerResource | undefined {
    const resources = this.resources.get(serverName);
    return resources?.find((r) => r.uri === resourceUri);
  }

  /**
   * 移除服务器的所有资源
   */
  removeServerResources(serverName: string): void {
    this.resources.delete(serverName);
    logger.info(`Removed resources from server ${serverName}`);
  }

  /**
   * 清空所有资源
   */
  clear(): void {
    this.resources.clear();
    logger.info('Cleared all resources');
  }
}

// 导出单例
export const resourceManager = new ResourceManager();
export const mcpResourceManager = new MCPResourceManager();
