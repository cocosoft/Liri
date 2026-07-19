/**
 * OAuth 核心类型定义
 *
 * 类型统一原则:
 *   OAuthServerMetadata → OAuthDiscoveryTypes.ts（RFC 8414 完整版，唯一来源）
 *   OAuthTokenData     → services/OAuthStorage.ts（唯一来源）
 *   OAuthConfig        → 本文件（唯一来源）
 */

import type { OAuthServerMetadata } from './OAuthDiscoveryTypes';
import type { OAuthTokenData } from '../services/OAuthStorage.js';

// Re-export canonical types
export type { OAuthServerMetadata };
export type { OAuthTokenData };

export type OAuthTokens = OAuthTokenData;

/**
 * OAuth 配置
 */
export interface OAuthConfig {
  authorizeUrl: string;
  tokenUrl: string;
  profileUrl: string;
  successUrl?: string;
  manualRedirectUrl?: string;
  clientId: string;
  clientSecret?: string;
  scopes: string[];
  redirectUri?: string;
}

/**
 * OAuth 认证结果
 */
export interface OAuthAuthResult {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  tokenType: string;
  scopes: string[];
}

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'oauth\types\OAuthTypes',
  level: LogLevel.INFO,
});

/**
 * OAuth 错误类型
 */
export class OAuthError extends AppError {
  constructor(
    message: string,
    code: string,
    public statusCode?: number
  ) {
    super(message, ErrorCategory.API, ErrorSeverity.MEDIUM, code);
    this.name = 'OAuthError';
  }
}
