import { handleError } from '@modules/error';
/**
 * GatewayConfigManager 网关配置管理
 * 对标 CC 的网关配置管理能力
 */

/**
 * 网关配置
 */
export interface GatewayConfig {
  host: string;
  port: number;
  tls: boolean;
  tlsCert?: string;
  tlsKey?: string;
  auth: {
    enabled: boolean;
    provider: 'none' | 'bearer' | 'basic' | 'oauth2';
    tokens?: string[];
  };
  cors: {
    enabled: boolean;
    allowedOrigins: string[];
    allowedMethods: string[];
  };
  limits: {
    maxConnections: number;
    maxPayloadSize: number;
    rateLimit: number;
  };
}

/**
 * 网关配置管理器
 */
export class GatewayConfigManager {
  private config: GatewayConfig;
  private listeners: Array<(config: GatewayConfig) => void> = [];

  constructor(config?: Partial<GatewayConfig>) {
    this.config = {
      host: config?.host || '0.0.0.0',
      port: config?.port || 3000,
      tls: config?.tls || false,
      tlsCert: config?.tlsCert,
      tlsKey: config?.tlsKey,
      auth: {
        enabled: config?.auth?.enabled || false,
        provider: config?.auth?.provider || 'none',
        tokens: config?.auth?.tokens,
      },
      cors: {
        enabled: config?.cors?.enabled !== false,
        allowedOrigins: config?.cors?.allowedOrigins || ['*'],
        allowedMethods: config?.cors?.allowedMethods || [
          'GET',
          'POST',
          'PUT',
          'DELETE',
          'OPTIONS',
        ],
      },
      limits: {
        maxConnections: config?.limits?.maxConnections || 100,
        maxPayloadSize: config?.limits?.maxPayloadSize || 10 * 1024 * 1024,
        rateLimit: config?.limits?.rateLimit || 100,
      },
    };
  }

  /**
   * 获取配置
   */
  get(): GatewayConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  update(partial: Partial<GatewayConfig>): void {
    this.config = this.mergeConfig(this.config, partial);
    this.notify();
  }

  /**
   * 监听配置变更
   */
  onChange(listener: (config: GatewayConfig) => void): () => void {
    this.listeners.push(listener);

    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /**
   * 验证配置
   */
  validate(): string[] {
    const errors: string[] = [];

    if (this.config.port < 1 || this.config.port > 65535) {
      errors.push('端口号必须在 1-65535 之间');
    }

    if (this.config.tls) {
      if (!this.config.tlsCert) errors.push('TLS 启用但未配置证书');
      if (!this.config.tlsKey) errors.push('TLS 启用但未配置密钥');
    }

    if (this.config.limits.maxConnections < 1) {
      errors.push('最大连接数必须大于 0');
    }

    return errors;
  }

  /**
   * 获取 URL
   */
  getUrl(): string {
    const protocol = this.config.tls ? 'https' : 'http';

    return `${protocol}://${this.config.host}:${this.config.port}`;
  }

  /**
   * 通知监听器
   */
  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.config);
      } catch (err) {
        void handleError(err, {
          module: 'core:gateway',
          action: 'catch_error',
        });
      }
    }
  }

  /**
   * 合并配置
   */
  private mergeConfig(
    base: GatewayConfig,
    partial: Partial<GatewayConfig>
  ): GatewayConfig {
    return {
      ...base,
      ...partial,
      auth: { ...base.auth, ...partial.auth },
      cors: { ...base.cors, ...partial.cors },
      limits: { ...base.limits, ...partial.limits },
    };
  }
}

export const gatewayConfigManager = new GatewayConfigManager();
