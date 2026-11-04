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

import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@openliri/infra/error';
import { getLogger } from '@openliri/kernel/loggerFacade';
import { configManager } from '../../ConfigManager.js';
// A5：JWT 验签。此处直接用 node:crypto 而非 `security/services/HashUtils`：
// 后者只能经 `@openliri/infra/security` 桶文件导入（R03-002 禁止子目录直连），
// 而该桶会把审计/扫描等整条安全子系统拉进认证模块，得不偿失（CS01 允许的
// 「三行胜过过度抽象」取舍）。
import { createHmac, timingSafeEqual } from 'crypto';

const logger = getLogger('config:authChain');

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
      void handleError(error, {
        module: 'config:enterprise:auth',
        action: 'OAuth 认证失败',
      });
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
      void handleError(error, {
        module: 'config:enterprise:auth',
        action: 'SAML 认证失败',
      });
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
      void handleError(error, {
        module: 'config:enterprise:auth',
        action: 'LDAP 认证失败',
      });
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
      // A5 安全基线（2026-11-04）：无密钥 ⇒ 无法验签 ⇒ **fail-closed**。
      // 原实现（"未配置则跳过签名校验，直接信任 payload"）等于允许任意伪造
      // `sub` / `roles` / `tenant` —— 只要构造 `{"sub":"admin","roles":["admin"]}`
      // 的三段式字符串即可通过认证。与 `VERIFIER_FAIL_CLOSED` / `REQUIRE_BEARER`
      // 同一口径：配置缺失不得静默降级为"全部放行"。
      logger.warning(
        'JWT 认证被拒绝：LIRI_JWT_SECRET 未配置（fail-closed，不再跳过签名校验）'
      );
      return null;
    }

    try {
      const parts = credentials.jwtToken.split('.');
      if (parts.length !== 3) {
        logger.info('JWT 格式无效');
        return null;
      }

      // 只接受 HS256：显式拒绝 `alg: none` 与算法混淆（RS256 token 用 HS256 校验的经典绕过）
      let header: { alg?: string };
      try {
        header = JSON.parse(
          Buffer.from(parts[0], 'base64url').toString('utf-8')
        ) as { alg?: string };
      } catch {
        logger.info('JWT 头部无法解析，已拒绝');
        return null;
      }
      if (header.alg !== 'HS256') {
        logger.warning('JWT 签名算法不受支持，已拒绝', { alg: header.alg });
        return null;
      }

      // 签名校验：HMAC-SHA256(base64url(header) + "." + base64url(payload))
      const signingInput = `${parts[0]}.${parts[1]}`;
      const expected = createHmac('sha256', jwtSecret)
        .update(signingInput)
        .digest();
      const actual = Buffer.from(parts[2], 'base64url');
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      ) {
        logger.warning('JWT 签名校验失败，已拒绝');
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
      void handleError(error, {
        module: 'config:enterprise:auth',
        action: 'JWT 解码失败',
      });
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
