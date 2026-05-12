/**
 * OAuth Discovery服务
 * 实现RFC 8414 OAuth 2.0授权服务器元数据发现
 * 参考CC源码的多环境配置模式
 */

import { logger } from '@modules/utils/log.js';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

/**
 * OAuth授权服务器元数据
 * 符合RFC 8414规范
 */
export interface OAuthMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri?: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  response_types_supported: string[];
  response_modes_supported?: string[];
  grant_types_supported?: string[];
  token_endpoint_auth_methods_supported?: string[];
  token_endpoint_auth_signing_alg_values_supported?: string[];
  service_documentation?: string;
  ui_locales_supported?: string[];
  op_policy_uri?: string;
  op_tos_uri?: string;
  revocation_endpoint?: string;
  revocation_endpoint_auth_methods_supported?: string[];
  revocation_endpoint_auth_signing_alg_values_supported?: string[];
  introspection_endpoint?: string;
  introspection_endpoint_auth_methods_supported?: string[];
  introspection_endpoint_auth_signing_alg_values_supported?: string[];
  code_challenge_methods_supported?: string[];
}

/**
 * OAuth Discovery服务
 * 自动发现OAuth授权服务器元数据
 */
export class OAuthDiscovery {
  private metadataCache: MetadataCache;

  constructor() {
    this.metadataCache = new MetadataCache();
  }

  /**
   * 发现OAuth授权服务器元数据
   * 参考RFC 8414规范，从.well-known/oauth-authorization-server获取元数据
   * @param issuer OAuth发行者URL
   */
  async discoverMetadata(issuer: string): Promise<OAuthMetadata> {
    // 尝试从缓存获取
    const cached = await this.metadataCache.get(issuer);
    if (cached) {
      logger.debug(`Using cached OAuth metadata for ${issuer}`);
      return cached;
    }

    // 缓存未命中，执行Discovery
    logger.info(`Discovering OAuth metadata for ${issuer}`);
    const metadata = await this.fetchMetadata(issuer);

    // 验证元数据
    this.validateMetadata(metadata);

    // 缓存元数据
    await this.metadataCache.set(issuer, metadata);

    return metadata;
  }

  /**
   * 从.well-known端点获取元数据
   */
  private async fetchMetadata(issuer: string): Promise<OAuthMetadata> {
    // 构建.well-known URL
    const wellKnownUrl = this.buildWellKnownUrl(issuer);
    logger.debug(`Fetching metadata from: ${wellKnownUrl}`);

    try {
      const response = await fetch(wellKnownUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(10000), // 10秒超时
      });

      if (!response.ok) {
        throw new AppError(
          `OAuth Discovery failed: ${response.status} ${response.statusText}`
        , ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
      }

      const metadata = await response.json();
      logger.info(`Successfully discovered OAuth metadata for ${issuer}`);
      return metadata;
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      logger.error(`OAuth Discovery failed for ${issuer}:`, e);
      throw new AppError(
        `Failed to discover OAuth metadata: ${error instanceof Error ? error.message : 'Unknown error'}`
      , ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
    }
  }

  /**
   * 构建.well-known URL
   * 参考RFC 8414规范
   */
  private buildWellKnownUrl(issuer: string): string {
    // 确保issuer URL没有尾部斜杠
    const normalizedIssuer = issuer.replace(/\/$/, '');
    return `${normalizedIssuer}/.well-known/oauth-authorization-server`;
  }

  /**
   * 验证OAuth元数据
   * 确保必要的字段存在
   */
  private validateMetadata(metadata: OAuthMetadata): void {
    const requiredFields = [
      'issuer',
      'authorization_endpoint',
      'token_endpoint',
      'response_types_supported',
    ];

    for (const field of requiredFields) {
      if (!metadata[field as keyof OAuthMetadata]) {
        throw new AppError(`Missing required OAuth metadata field: ${field}`, ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
      }
    }

    // 验证issuer URL格式
    try {
      new URL(metadata.issuer);
    } catch {
      throw new AppError(`Invalid issuer URL: ${metadata.issuer}`, ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
    }

    // 验证端点URL格式
    const endpoints = [
      metadata.authorization_endpoint,
      metadata.token_endpoint,
    ];

    for (const endpoint of endpoints) {
      try {
        new URL(endpoint);
      } catch {
        throw new AppError(`Invalid endpoint URL: ${endpoint}`, ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
      }
    }

    logger.debug('OAuth metadata validation passed');
  }

  /**
   * 清除指定发行者的缓存
   */
  async clearCache(issuer: string): Promise<void> {
    await this.metadataCache.delete(issuer);
    logger.info(`OAuth metadata cache cleared for ${issuer}`);
  }

  /**
   * 清除所有缓存
   */
  async clearAllCache(): Promise<void> {
    await this.metadataCache.clear();
    logger.info('All OAuth metadata cache cleared');
  }

  /**
   * 获取缓存状态
   */
  getCacheStatus(): { size: number; entries: string[] } {
    return this.metadataCache.getStatus();
  }
}

/**
 * OAuth元数据缓存
 * 缓存Discovery结果，避免重复网络请求
 */
export class MetadataCache {
  private cache: Map<string, CachedMetadata>;
  private readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24小时

  constructor() {
    this.cache = new Map();
  }

  /**
   * 获取缓存的元数据
   * @param issuer OAuth发行者URL
   */
  async get(issuer: string): Promise<OAuthMetadata | null> {
    const cached = this.cache.get(issuer);

    if (!cached) {
      return null;
    }

    if (this.isExpired(cached)) {
      logger.debug(`OAuth metadata cache expired for ${issuer}`);
      this.cache.delete(issuer);
      return null;
    }

    return cached.metadata;
  }

  /**
   * 缓存元数据
   * @param issuer OAuth发行者URL
   * @param metadata OAuth元数据
   */
  async set(issuer: string, metadata: OAuthMetadata): Promise<void> {
    this.cache.set(issuer, {
      metadata,
      cachedAt: Date.now(),
    });
    logger.debug(`OAuth metadata cached for ${issuer}`);
  }

  /**
   * 删除缓存
   */
  async delete(issuer: string): Promise<void> {
    this.cache.delete(issuer);
  }

  /**
   * 清除所有缓存
   */
  async clear(): Promise<void> {
    this.cache.clear();
  }

  /**
   * 检查缓存是否过期
   */
  private isExpired(cached: CachedMetadata): boolean {
    return Date.now() - cached.cachedAt > this.CACHE_TTL_MS;
  }

  /**
   * 获取缓存状态
   */
  getStatus(): { size: number; entries: string[] } {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys()),
    };
  }
}

/**
 * 缓存的元数据接口
 */
interface CachedMetadata {
  metadata: OAuthMetadata;
  cachedAt: number;
}

/**
 * 创建OAuth Discovery服务实例
 */
export function createOAuthDiscovery(): OAuthDiscovery {
  return new OAuthDiscovery();
}
