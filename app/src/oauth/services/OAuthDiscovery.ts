// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * OAuth Discovery 服务
 * 实现 RFC 8414 OAuth 2.0 授权服务器元数据发现
 *
 * 类型统一: 使用 types/OAuthDiscoveryTypes.ts 中的 OAuthServerMetadata（唯一来源）
 */

import { Logger } from '@modules/monitoring';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { TTLCache } from '@modules/utils/cache';
import type { OAuthServerMetadata } from '../types/OAuthDiscoveryTypes';

const logger = new Logger({ module: 'OAuthDiscovery' });

/**
 * OAuth Discovery 服务
 * 自动发现 OAuth 授权服务器元数据
 */
export class OAuthDiscovery {
  private metadataCache: MetadataCache;

  constructor() {
    this.metadataCache = new MetadataCache();
  }

  /**
   * 发现 OAuth 授权服务器元数据
   * 参考 RFC 8414 规范，从 .well-known/oauth-authorization-server 获取
   */
  async discoverMetadata(issuer: string): Promise<OAuthServerMetadata> {
    const cached = await this.metadataCache.get(issuer);
    if (cached) {
      logger.debug(`Using cached OAuth metadata for ${issuer}`);
      return cached;
    }

    logger.info(`Discovering OAuth metadata for ${issuer}`);
    const raw = await this.fetchRawMetadata(issuer);
    const metadata = this.normalizeMetadata(raw);
    this.validateMetadata(metadata);
    await this.metadataCache.set(issuer, metadata);
    return metadata;
  }

  /** 从 .well-known 端点获取原始响应（server 返回 snake_case） */
  private async fetchRawMetadata(
    issuer: string
  ): Promise<Record<string, unknown>> {
    const wellKnownUrl = this.buildWellKnownUrl(issuer);
    logger.debug(`Fetching metadata from: ${wellKnownUrl}`);

    try {
      const response = await fetch(wellKnownUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        throw new AppError(
          `OAuth Discovery failed: ${response.status} ${response.statusText}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }

      return await response.json();
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      logger.error(`OAuth Discovery failed for ${issuer}:`, e);
      throw new AppError(
        `Failed to discover OAuth metadata: ${e.message}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
  }

  /** snake_case → camelCase 映射（RFC 8414 服务器响应 → ESNext 命名规范） */
  private normalizeMetadata(raw: Record<string, unknown>): OAuthServerMetadata {
    return {
      issuer: raw.issuer as string,
      authorizationEndpoint: raw.authorization_endpoint as string,
      tokenEndpoint: raw.token_endpoint as string,
      userinfoEndpoint: raw.userinfo_endpoint as string | undefined,
      jwksUri: raw.jwks_uri as string | undefined,
      registrationEndpoint: raw.registration_endpoint as string | undefined,
      scopesSupported: raw.scopes_supported as string[] | undefined,
      responseTypesSupported: raw.response_types_supported as string[],
      responseModesSupported: raw.response_modes_supported as
        | string[]
        | undefined,
      grantTypesSupported: raw.grant_types_supported as string[] | undefined,
      tokenEndpointAuthMethodsSupported:
        raw.token_endpoint_auth_methods_supported as string[] | undefined,
      tokenEndpointAuthSigningAlgValuesSupported:
        raw.token_endpoint_auth_signing_alg_values_supported as
          | string[]
          | undefined,
      codeChallengeMethodsSupported: raw.code_challenge_methods_supported as
        | string[]
        | undefined,
      revocationEndpoint: raw.revocation_endpoint as string | undefined,
      introspectionEndpoint: raw.introspection_endpoint as string | undefined,
      serviceDocumentation: raw.service_documentation as string | undefined,
      opPolicyUri: raw.op_policy_uri as string | undefined,
      opTosUri: raw.op_tos_uri as string | undefined,
    };
  }

  private buildWellKnownUrl(issuer: string): string {
    const normalized = issuer.replace(/\/$/, '');
    return `${normalized}/.well-known/oauth-authorization-server`;
  }

  private validateMetadata(metadata: OAuthServerMetadata): void {
    const required: (keyof OAuthServerMetadata)[] = [
      'issuer',
      'authorizationEndpoint',
      'tokenEndpoint',
      'responseTypesSupported',
    ];

    for (const field of required) {
      if (!metadata[field]) {
        throw new AppError(
          `Missing required OAuth metadata field: ${field}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }
    }

    try {
      new URL(metadata.issuer);
    } catch {
      throw new AppError(
        `Invalid issuer URL: ${metadata.issuer}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    for (const ep of [metadata.authorizationEndpoint, metadata.tokenEndpoint]) {
      try {
        new URL(ep);
      } catch {
        throw new AppError(
          `Invalid endpoint URL: ${ep}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }
    }
  }

  async clearCache(issuer: string): Promise<void> {
    await this.metadataCache.delete(issuer);
    logger.info(`OAuth metadata cache cleared for ${issuer}`);
  }

  async clearAllCache(): Promise<void> {
    await this.metadataCache.clear();
    logger.info('All OAuth metadata cache cleared');
  }

  getCacheStatus(): { size: number; entries: string[] } {
    return this.metadataCache.getStatus();
  }
}

/** OAuth 元数据缓存（TTL 24小时） */
export class MetadataCache {
  private cache: TTLCache<OAuthServerMetadata>;

  constructor() {
    this.cache = new TTLCache<OAuthServerMetadata>(100, 24 * 60 * 60 * 1000);
  }

  async get(issuer: string): Promise<OAuthServerMetadata | null> {
    return this.cache.get(issuer);
  }

  async set(issuer: string, metadata: OAuthServerMetadata): Promise<void> {
    this.cache.set(issuer, metadata);
    logger.debug(`OAuth metadata cached for ${issuer}`);
  }

  async delete(issuer: string): Promise<void> {
    this.cache.delete(issuer);
  }

  async clear(): Promise<void> {
    this.cache.clear();
  }

  getStatus(): { size: number; entries: string[] } {
    return { size: this.cache.size(), entries: [] };
  }
}

export function createOAuthDiscovery(): OAuthDiscovery {
  return new OAuthDiscovery();
}
