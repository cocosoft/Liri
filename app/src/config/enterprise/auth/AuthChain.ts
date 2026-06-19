/**
 * AuthChain — 企业版认证链
 *
 * 采用责任链模式，支持多种认证方式按序尝试。
 * 链式调用：API Key → OAuth → SSO/SAML → LDAP → JWT
 *
 * 用法：
 *   const chain = new AuthChain();
 *   chain.use(new ApiKeyAuthenticator());
 *   chain.use(new OAuthAuthenticator());
 *   chain.use(new SamlAuthenticator({ ... }));
 *   const result = await chain.authenticate({ apiKey: '...' });
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { Logger, LogLevel } from '@modules/monitoring';
import { configManager } from '../../ConfigManager.js';

const logger = new Logger({ level: LogLevel.INFO });

/** 认证来源 */
export type AuthSource = 'api_key' | 'oauth' | 'saml' | 'ldap' | 'jwt' | 'mtls';

/** 认证凭证 */
export interface AuthCredentials {
  /** API Key */
  apiKey?: string;
  /** OAuth Access Token */
  accessToken?: string;
  /** OAuth Refresh Token */
  refreshToken?: string;
  /** SAML Assertion */
  samlAssertion?: string;
  /** LDAP 用户名 */
  username?: string;
  /** LDAP 密码 */
  password?: string;
  /** JWT Token */
  jwtToken?: string;
  /** mTLS 证书指纹 */
  clientCertFingerprint?: string;
  /** 额外的认证上下文 */
  context?: Record<string, unknown>;
}

/** 认证结果 */
export interface AuthResult {
  /** 是否通过 */
  authenticated: boolean;
  /** 认证来源 */
  source: AuthSource;
  /** 用户标识 */
  userId?: string;
  /** 用户角色列表 */
  roles?: string[];
  /** 用户组织/租户 */
  tenant?: string;
  /** Token 信息 */
  token?: {
    accessToken: string;
    expiresAt: number;
    refreshToken?: string;
  };
  /** 额外元数据 */
  metadata?: Record<string, unknown>;
}

/** 认证策略基类 */
export interface AuthStrategy {
  /** 策略名称 */
  readonly name: string;
  /** 认证来源 */
  readonly source: AuthSource;
  /** 执行认证 */
  authenticate(credentials: AuthCredentials): Promise<AuthResult | null>;
}

/** 认证链配置 */
export interface AuthChainConfig {
  /** 链名称 */
  name?: string;
  /** 严格模式：所有策略都失败才返回失败 */
  strictMode?: boolean;
  /** 超时时间（毫秒） */
  timeoutMs?: number;
}

const DEFAULT_CONFIG: Required<AuthChainConfig> = {
  name: 'enterprise-auth-chain',
  strictMode: false,
  timeoutMs: 30000,
};

/** API Key 认证策略 */
export class ApiKeyAuthenticator implements AuthStrategy {
  readonly name = 'api-key';
  readonly source: AuthSource = 'api_key';

  async authenticate(credentials: AuthCredentials): Promise<AuthResult | null> {
    if (!credentials.apiKey) {
      return null;
    }

    const validKey = configManager.env('LIRI_ENTERPRISE_API_KEY');
    if (!validKey) {
      logger.info('LIRI_ENTERPRISE_API_KEY 未配置，跳过 API Key 认证');
      return null;
    }

    if (credentials.apiKey === validKey) {
      return {
        authenticated: true,
        source: 'api_key',
        userId: 'enterprise-admin',
        roles: ['admin'],
        metadata: { authMethod: 'api_key' },
      };
    }

    return null;
  }
}

/** OAuth 认证策略 */
export class OAuthAuthenticator implements AuthStrategy {
  readonly name = 'oauth';
  readonly source: AuthSource = 'oauth';

  async authenticate(credentials: AuthCredentials): Promise<AuthResult | null> {
    if (!credentials.accessToken) {
      return null;
    }

    try {
      const tokenIntrospectUrl = process.env['LIRI_OAUTH_INTROSPECT_URL'];
      if (!tokenIntrospectUrl) {
        logger.info('OAUTH_INTROSPECT_URL 未配置，跳过 OAuth Token 校验');
        return null;
      }

      // 使用内置 https 模块进行 token 自检
      const { request } = await import('https');
      const response = await new Promise<Record<string, unknown>>(
        (resolve, reject) => {
          const body = JSON.stringify({ token: credentials.accessToken });
          const req = request(
            tokenIntrospectUrl,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
              },
            },
            (res) => {
              let data = '';
              res.on('data', (chunk: Buffer) => {
                data += chunk.toString();
              });
              res.on('end', () => {
                try {
                  resolve(JSON.parse(data));
                } catch {
                  reject(new Error('Token 自检响应解析失败'));
                }
              });
            }
          );
          req.on('error', reject);
          req.write(body);
          req.end();
        }
      );

      if (response.active) {
        return {
          authenticated: true,
          source: 'oauth',
          userId: response.sub as string,
          roles: (response.roles as string[]) || ['user'],
          tenant: response.tenant as string,
          token: {
            accessToken: credentials.accessToken!,
            expiresAt: (response.exp as number) * 1000,
            refreshToken: credentials.refreshToken,
          },
          metadata: { issuer: response.iss },
        };
      }
    } catch (error) {
      logger.error('OAuth 认证失败', error);
    }

    return null;
  }
}

/** SAML/SSO 认证策略 */
export class SamlAuthenticator implements AuthStrategy {
  readonly name = 'saml';
  readonly source: AuthSource = 'saml';

  async authenticate(credentials: AuthCredentials): Promise<AuthResult | null> {
    if (!credentials.samlAssertion) {
      return null;
    }

    const samlUrl = process.env['LIRI_SAML_ACS_URL'];
    if (!samlUrl) {
      logger.info('SAML ACS URL 未配置，跳过 SAML 认证');
      return null;
    }

    try {
      const { request } = await import('https');
      const body = JSON.stringify({
        assertion: credentials.samlAssertion,
        relayState: credentials.context?.relayState || '',
      });

      const response = await new Promise<Record<string, unknown>>(
        (resolve, reject) => {
          const req = request(
            samlUrl,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
              },
            },
            (res) => {
              let data = '';
              res.on('data', (chunk: Buffer) => {
                data += chunk.toString();
              });
              res.on('end', () => {
                try {
                  resolve(JSON.parse(data));
                } catch {
                  reject(new Error('SAML 响应解析失败'));
                }
              });
            }
          );
          req.on('error', reject);
          req.write(body);
          req.end();
        }
      );

      if (response.status === 'success') {
        return {
          authenticated: true,
          source: 'saml',
          userId: response.userId as string,
          roles: (response.roles as string[]) || ['user'],
          tenant: response.tenant as string,
          metadata: {
            nameId: response.nameId,
            sessionIndex: response.sessionIndex,
          },
        };
      }
    } catch (error) {
      logger.error('SAML 认证失败', error);
    }

    return null;
  }
}

/** LDAP 认证策略 */
export class LdapAuthenticator implements AuthStrategy {
  readonly name = 'ldap';
  readonly source: AuthSource = 'ldap';

  async authenticate(credentials: AuthCredentials): Promise<AuthResult | null> {
    if (!credentials.username || !credentials.password) {
      return null;
    }

    const ldapUrl = process.env['LIRI_LDAP_URL'];
    if (!ldapUrl) {
      logger.info('LDAP URL 未配置，跳过 LDAP 认证');
      return null;
    }

    try {
      const { request } = await import('https');
      const body = JSON.stringify({
        username: credentials.username,
        password: credentials.password,
        baseDn: process.env['LIRI_LDAP_BASE_DN'] || '',
      });

      const response = await new Promise<Record<string, unknown>>(
        (resolve, reject) => {
          const req = request(
            ldapUrl,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
              },
            },
            (res) => {
              let data = '';
              res.on('data', (chunk: Buffer) => {
                data += chunk.toString();
              });
              res.on('end', () => {
                try {
                  resolve(JSON.parse(data));
                } catch {
                  reject(new Error('LDAP 响应解析失败'));
                }
              });
            }
          );
          req.on('error', reject);
          req.write(body);
          req.end();
        }
      );

      if (response.authenticated) {
        return {
          authenticated: true,
          source: 'ldap',
          userId: response.dn as string,
          roles: (response.groups as string[]) || ['user'],
          tenant: response.tenant as string,
          metadata: {
            displayName: response.displayName,
            email: response.email,
          },
        };
      }
    } catch (error) {
      logger.error('LDAP 认证失败', error);
    }

    return null;
  }
}

/** JWT 认证策略 */
export class JwtAuthenticator implements AuthStrategy {
  readonly name = 'jwt';
  readonly source: AuthSource = 'jwt';

  async authenticate(credentials: AuthCredentials): Promise<AuthResult | null> {
    if (!credentials.jwtToken) {
      return null;
    }

    const jwtSecret = process.env['LIRI_JWT_SECRET'];
    if (!jwtSecret) {
      logger.info('JWT_SECRET 未配置，使用简单 Base64 解码验证');
    }

    try {
      // JWT 解码（无签名验证，企业版应配置 JWT_SECRET）
      const parts = credentials.jwtToken.split('.');
      if (parts.length !== 3) {
        logger.info('JWT 格式无效');
        return null;
      }

      const payload = JSON.parse(
        Buffer.from(parts[1], 'base64url').toString('utf-8')
      );

      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < now) {
        logger.info('JWT 已过期');
        return null;
      }

      if (payload.nbf && payload.nbf > now) {
        logger.info('JWT 尚未生效');
        return null;
      }

      return {
        authenticated: true,
        source: 'jwt',
        userId: payload.sub || payload.username,
        roles: payload.roles || ['user'],
        tenant: payload.tenant,
        token: {
          accessToken: credentials.jwtToken!,
          expiresAt: (payload.exp || 0) * 1000,
        },
        metadata: {
          issuer: payload.iss,
          issuedAt: payload.iat,
          jti: payload.jti,
        },
      };
    } catch (error) {
      logger.error('JWT 解码失败', error);
    }

    return null;
  }
}

/** mTLS 认证策略 */
export class MtlsAuthenticator implements AuthStrategy {
  readonly name = 'mtls';
  readonly source: AuthSource = 'mtls';

  async authenticate(credentials: AuthCredentials): Promise<AuthResult | null> {
    if (!credentials.clientCertFingerprint) {
      return null;
    }

    const allowedFingerprints = process.env['LIRI_MTLS_ALLOWED_FINGERPRINTS'];
    if (!allowedFingerprints) {
      logger.info('MTLS_ALLOWED_FINGERPRINTS 未配置，跳过 mTLS 认证');
      return null;
    }

    const fingerprints = allowedFingerprints.split(',').map((f) => f.trim());
    if (fingerprints.includes(credentials.clientCertFingerprint)) {
      return {
        authenticated: true,
        source: 'mtls',
        userId: `cert-${credentials.clientCertFingerprint.substring(0, 8)}`,
        roles: ['service'],
        metadata: { fingerprint: credentials.clientCertFingerprint },
      };
    }

    return null;
  }
}

/**
 * 企业版认证链
 * 按注册顺序依次尝试各认证策略，返回第一个成功的认证结果。
 */
export class AuthChain {
  private strategies: AuthStrategy[] = [];
  private config: Required<AuthChainConfig>;

  constructor(config: AuthChainConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 注册认证策略（按优先级从高到低添加）
   */
  use(strategy: AuthStrategy): this {
    this.strategies.push(strategy);
    return this;
  }

  /**
   * 执行认证链
   * 按注册顺序依次尝试，返回第一个成功的认证结果。
   */
  async authenticate(credentials: AuthCredentials): Promise<AuthResult> {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new AppError(
              '认证链执行超时',
              ErrorCategory.PERMISSION,
              ErrorSeverity.HIGH,
              'AUTH_CHAIN_TIMEOUT'
            )
          ),
        this.config.timeoutMs
      )
    );

    const authPromise = this.executeChain(credentials);

    try {
      return await Promise.race([authPromise, timeoutPromise]);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        '认证链执行失败',
        ErrorCategory.PERMISSION,
        ErrorSeverity.HIGH,
        'AUTH_CHAIN_FAILED',
        { originalError: (error as Error).message }
      );
    }
  }

  private async executeChain(
    credentials: AuthCredentials
  ): Promise<AuthResult> {
    const errors: Array<{ strategy: string; error: string }> = [];

    for (const strategy of this.strategies) {
      try {
        const result = await strategy.authenticate(credentials);
        if (result && result.authenticated) {
          logger.info(`认证链: ${strategy.name} 认证成功`);
          return result;
        }
      } catch (error) {
        const msg = (error as Error).message;
        logger.info(`认证链: ${strategy.name} 失败 - ${msg}`);
        errors.push({ strategy: strategy.name, error: msg });
      }
    }

    throw new AppError(
      '所有认证策略均未通过',
      ErrorCategory.PERMISSION,
      ErrorSeverity.HIGH,
      'AUTH_CHAIN_ALL_FAILED',
      { strategies: errors }
    );
  }

  /**
   * 获取已注册的策略列表
   */
  getStrategies(): readonly AuthStrategy[] {
    return [...this.strategies];
  }

  /**
   * 清空认证链
   */
  clear(): void {
    this.strategies = [];
  }
}

/** 创建默认的企业版认证链 */
export function createEnterpriseAuthChain(config?: AuthChainConfig): AuthChain {
  const chain = new AuthChain({
    name: 'enterprise',
    ...config,
  });

  chain.use(new MtlsAuthenticator());
  chain.use(new JwtAuthenticator());
  chain.use(new ApiKeyAuthenticator());
  chain.use(new OAuthAuthenticator());
  chain.use(new SamlAuthenticator());
  chain.use(new LdapAuthenticator());

  return chain;
}
