/**
 * OAuth Device Authorization Flow (设备授权流程)
 * 实现 RFC 8628 - OAuth 2.0 Device Authorization Grant
 */

import { request as httpsRequest } from 'https';
import { request as httpRequest } from 'http';
import { OAuthClient } from '../services/OAuthClient';
import type { OAuthConfig, OAuthAuthResult } from '../types/OAuthTypes';
import { OAuthError } from '../types/OAuthTypes';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';

const logger = new Logger({ module: 'oauth:flows:deviceAuth', level: LogLevel.INFO });

export interface DeviceAuthorizationResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresIn: number;
  interval: number;
}

export interface DeviceFlowOptions {
  scopes?: string[];
  clientId?: string;
  additionalParams?: Record<string, string>;
}

export class DeviceAuthorizationFlow {
  private client: OAuthClient;
  private config: OAuthConfig;

  constructor(config: OAuthConfig, client?: OAuthClient) {
    this.config = config;
    this.client = client || new OAuthClient(config);
  }

  /**
   * 启动设备授权流程
   * 向授权服务器请求 device_code 和 user_code
   */
  async startDeviceAuthorization(
    options?: DeviceFlowOptions
  ): Promise<DeviceAuthorizationResponse> {
    const deviceAuthUrl = this.getDeviceAuthUrl();
    const requestBody: Record<string, unknown> = {
      client_id: options?.clientId || this.config.clientId,
    };

    const scopes = options?.scopes || this.config.scopes;
    if (scopes.length > 0) {
      requestBody.scope = scopes.join(' ');
    }

    if (options?.additionalParams) {
      Object.assign(requestBody, options.additionalParams);
    }

    const raw = await this.httpPostForm(deviceAuthUrl, requestBody);

    const deviceCode = raw.device_code as string;
    const userCode = raw.user_code as string;
    const verificationUri = raw.verification_uri as string;

    if (!deviceCode || !userCode || !verificationUri) {
      logger.error('Device authorization response missing required fields', {
        hasDeviceCode: !!deviceCode,
        hasUserCode: !!userCode,
        hasVerificationUri: !!verificationUri,
      });
      throw new OAuthError(
        '设备授权响应缺少必要字段',
        'OAUTH_DEVICE_AUTH_INVALID_RESPONSE'
      );
    }

    return {
      deviceCode,
      userCode,
      verificationUri,
      verificationUriComplete: raw.verification_uri_complete as
        | string
        | undefined,
      expiresIn: (raw.expires_in as number) || 1800,
      interval: (raw.interval as number) || 5,
    };
  }

  /**
   * 轮询 Token 端点，等待用户授权完成
   */
  async pollForToken(
    deviceCode: string,
    interval: number = 5,
    timeoutMs: number = 300000
  ): Promise<OAuthAuthResult> {
    const tokenUrl = this.config.tokenUrl;
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      await this.sleep(interval * 1000);

      const requestBody: Record<string, unknown> = {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: deviceCode,
        client_id: this.config.clientId,
      };

      if (this.config.clientSecret) {
        requestBody.client_secret = this.config.clientSecret;
      }

      try {
        const raw = await this.httpPostForm(tokenUrl, requestBody);
        const accessToken = raw.access_token as string;

        if (accessToken) {
          const expiresIn = (raw.expires_in as number) || 3600;

          return {
            accessToken,
            refreshToken: (raw.refresh_token as string) || '',
            expiresAt: Date.now() + expiresIn * 1000,
            tokenType: (raw.token_type as string) || 'Bearer',
            scopes: ((raw.scope as string) || '').split(' ').filter(Boolean),
          };
        }
      } catch (error) {
        if (error instanceof OAuthError) {
          if (error.code === 'OAUTH_AUTHORIZATION_PENDING') {
            continue;
          }
          if (error.code === 'OAUTH_SLOW_DOWN') {
            interval += 5;
            continue;
          }
          if (error.code === 'OAUTH_ACCESS_DENIED') {
            logger.warn('User denied device authorization');
            throw new OAuthError('用户拒绝了授权请求', 'OAUTH_ACCESS_DENIED');
          }
          if (error.code === 'OAUTH_EXPIRED_TOKEN') {
            logger.warn('Device authorization code expired');
            throw new OAuthError(
              '设备授权码已过期，请重新开始',
              'OAUTH_EXPIRED_TOKEN'
            );
          }
        }
        await handleError(error, {
          module: 'oauth:flows:deviceAuth',
          action: 'pollForToken',
        });
        throw error;
      }
    }

    throw new OAuthError('设备授权轮询超时', 'OAUTH_DEVICE_TIMEOUT');
  }

  /**
   * 获取设备授权端点 URL
   */
  private getDeviceAuthUrl(): string {
    const config = this.config;
    if (config.authorizeUrl.includes('/authorize')) {
      return config.authorizeUrl.replace('/authorize', '/device_authorization');
    }
    if (config.authorizeUrl.includes('/auth')) {
      return config.authorizeUrl.replace('/auth', '/device_authorization');
    }
    return `${new URL(config.authorizeUrl).origin}/oauth/device_authorization`;
  }

  /**
   * POST application/x-www-form-urlencoded 请求
   */
  private async httpPostForm(
    url: string,
    body: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const isHttps = parsedUrl.protocol === 'https:';
      const requester = isHttps ? httpsRequest : httpRequest;
      const encodedBody = new URLSearchParams(
        Object.entries(body).map(([k, v]) => [k, String(v)])
      ).toString();

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(encodedBody).toString(),
          Accept: 'application/json',
        },
        timeout: 10000,
      };

      const req = requester(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const data = Buffer.concat(chunks).toString();

          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch {
              const params = new URLSearchParams(data);
              const parsed: Record<string, unknown> = {};
              for (const [key, value] of params) {
                parsed[key] = value;
              }
              resolve(parsed);
            }
          } else {
            let errorData: Record<string, unknown> = {};
            try {
              errorData = JSON.parse(data);
            } catch {
              const params = new URLSearchParams(data);
              for (const [key, value] of params) {
                errorData[key] = value;
              }
            }

            const errorCode = (errorData.error as string) || 'unknown_error';
            const errorDesc = (errorData.error_description as string) || data;

            if (errorCode === 'authorization_pending') {
              reject(
                new OAuthError(
                  errorDesc,
                  'OAUTH_AUTHORIZATION_PENDING',
                  res.statusCode
                )
              );
            } else if (errorCode === 'slow_down') {
              reject(
                new OAuthError(errorDesc, 'OAUTH_SLOW_DOWN', res.statusCode)
              );
            } else if (errorCode === 'access_denied') {
              reject(
                new OAuthError(errorDesc, 'OAUTH_ACCESS_DENIED', res.statusCode)
              );
            } else if (errorCode === 'expired_token') {
              reject(
                new OAuthError(errorDesc, 'OAUTH_EXPIRED_TOKEN', res.statusCode)
              );
            } else {
              reject(
                new OAuthError(
                  `设备授权错误 HTTP ${res.statusCode}: ${errorDesc}`,
                  `OAUTH_${errorCode.toUpperCase()}`,
                  res.statusCode
                )
              );
            }
          }
        });
      });

      req.on('error', async (error) => {
        await handleError(error, {
          module: 'oauth:flows:deviceAuth',
          action: 'httpPostForm',
        });
        reject(
          new OAuthError(
            `设备授权请求失败: ${error.message}`,
            'OAUTH_DEVICE_REQUEST_FAILED'
          )
        );
      });

      req.on('timeout', () => {
        logger.warn('Device authorization request timed out');
        req.destroy();
        reject(new OAuthError('设备授权请求超时', 'OAUTH_DEVICE_TIMEOUT'));
      });

      req.write(encodedBody);
      req.end();
    });
  }

  /**
   * 休眠
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export function createDeviceAuthorizationFlow(
  config: OAuthConfig,
  client?: OAuthClient
): DeviceAuthorizationFlow {
  return new DeviceAuthorizationFlow(config, client);
}
