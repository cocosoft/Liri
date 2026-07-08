import fs from 'node:fs';
import tls from 'tls';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({
  module: 'services:mcp:tlsManager',
  level: LogLevel.INFO,
});

/**
 * MCP TLS 配置
 */
export interface McpTlsConfig {
  enabled: boolean;
  certPath?: string;
  keyPath?: string;
  caPath?: string;
  minVersion?: string;
  rejectUnauthorized?: boolean;
  requestCert?: boolean;
}

/**
 * MCP TLS 管理器
 * 为 MCP 传输层提供 TLS/mTLS 支持
 */
export class McpTlsManager {
  private config: McpTlsConfig;

  constructor(config?: Partial<McpTlsConfig>) {
    this.config = {
      enabled: config?.enabled ?? false,
      certPath: config?.certPath,
      keyPath: config?.keyPath,
      caPath: config?.caPath,
      minVersion: config?.minVersion ?? 'TLSv1.2',
      rejectUnauthorized: config?.rejectUnauthorized ?? true,
      requestCert: config?.requestCert ?? false,
    };
  }

  /**
   * 创建 TLS 客户端选项
   */
  createClientOptions(): tls.ConnectionOptions | null {
    if (!this.config.enabled) return null;

    const options: tls.ConnectionOptions = {
      minVersion: this.config.minVersion as tls.SecureVersion,
      rejectUnauthorized: this.config.rejectUnauthorized,
    };

    if (this.config.certPath && this.config.keyPath) {
      try {
        options.cert = fs.readFileSync(this.config.certPath);
        options.key = fs.readFileSync(this.config.keyPath);
      } catch (err) {
        logger.error('读取客户端证书失败', { error: err });
        return null;
      }
    }

    if (this.config.caPath) {
      try {
        options.ca = fs.readFileSync(this.config.caPath);
      } catch (err) {
        logger.error('读取 CA 证书失败', { error: err });
        return null;
      }
    }

    return options;
  }

  /**
   * 创建 TLS 服务端选项
   */
  createServerOptions(): tls.TlsOptions | null {
    if (!this.config.enabled) return null;
    if (!this.config.certPath || !this.config.keyPath) {
      logger.warn('TLS 启用但缺少证书或密钥路径');
      return null;
    }

    const options: tls.TlsOptions = {
      cert: fs.readFileSync(this.config.certPath),
      key: fs.readFileSync(this.config.keyPath),
      minVersion: this.config.minVersion as tls.SecureVersion,
      requestCert: this.config.requestCert,
      rejectUnauthorized: this.config.requestCert ? true : false,
    };

    if (this.config.caPath) {
      options.ca = fs.readFileSync(this.config.caPath);
    }

    return options;
  }

  /**
   * 是否为 HTTPS/WSS URL 创建带 TLS 的 fetch 选项
   */
  createFetchAgentOptions(): Record<string, unknown> | null {
    if (!this.config.enabled) return null;

    const cert = this.config.certPath
      ? fs.readFileSync(this.config.certPath, 'utf-8')
      : undefined;
    const key = this.config.keyPath
      ? fs.readFileSync(this.config.keyPath, 'utf-8')
      : undefined;
    const ca = this.config.caPath
      ? fs.readFileSync(this.config.caPath, 'utf-8')
      : undefined;

    if (!cert && !key && !ca) return null;

    return {
      cert,
      key,
      ca,
      rejectUnauthorized: this.config.rejectUnauthorized,
    };
  }

  /**
   * 检查 TLS 是否启用
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * 获取当前配置
   */
  getConfig(): McpTlsConfig {
    return { ...this.config };
  }
}
