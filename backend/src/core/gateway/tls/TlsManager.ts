/**
 * TlsManager 网关 TLS 管理
 * 对标 CC 的 TLS 证书管理能力
 */
import fs from 'node:fs';
import tls from 'node:tls';
import path from 'node:path';

/**
 * TLS 配置
 */
export interface TlsConfig {
  certPath: string;
  keyPath: string;
  caPath?: string;
  minVersion?: string;
  renewThreshold: number;
}

/**
 * TLS 状态
 */
export interface TlsStatus {
  enabled: boolean;
  certPath: string;
  expiresAt: number | null;
  daysRemaining: number | null;
  valid: boolean;
  issuer: string | null;
  subject: string | null;
}

/**
 * TLS 管理器
 */
export class TlsManager {
  private config: TlsConfig;

  constructor(config?: Partial<TlsConfig>) {
    this.config = {
      certPath: config?.certPath || '',
      keyPath: config?.keyPath || '',
      caPath: config?.caPath,
      minVersion: config?.minVersion || 'TLSv1.2',
      renewThreshold: config?.renewThreshold || 30,
    };
  }

  /**
   * 创建 TLS 选项
   */
  createOptions(): tls.SecureContextOptions | null {
    try {
      if (!this.config.certPath || !this.config.keyPath) return null;

      const options: tls.SecureContextOptions = {
        cert: fs.readFileSync(this.config.certPath),
        key: fs.readFileSync(this.config.keyPath),
        minVersion: this.config.minVersion as tls.SecureVersion,
      };

      if (this.config.caPath) {
        options.ca = fs.readFileSync(this.config.caPath);
      }

      return options;
    } catch {
      return null;
    }
  }

  /**
   * 获取证书状态
   */
  getStatus(): TlsStatus {
    try {
      if (!this.config.certPath || !fs.existsSync(this.config.certPath)) {
        return { enabled: false, certPath: this.config.certPath, expiresAt: null, daysRemaining: null, valid: false, issuer: null, subject: null };
      }

      const certData = fs.readFileSync(this.config.certPath, 'utf-8');

      const subjectMatch = certData.match(/Subject:\s*(.+)/i);
      const issuerMatch = certData.match(/Issuer:\s*(.+)/i);
      const notAfterMatch = certData.match(/Not After\s*:\s*(.+)/i);

      let expiresAt: number | null = null;
      if (notAfterMatch) {
        expiresAt = new Date(notAfterMatch[1].trim()).getTime();
      }

      const daysRemaining = expiresAt ? Math.round((expiresAt - Date.now()) / (24 * 60 * 60 * 1000)) : null;

      return {
        enabled: true,
        certPath: this.config.certPath,
        expiresAt,
        daysRemaining,
        valid: daysRemaining !== null && daysRemaining > 0,
        issuer: issuerMatch ? issuerMatch[1].trim() : null,
        subject: subjectMatch ? subjectMatch[1].trim() : null,
      };
    } catch {
      return { enabled: false, certPath: this.config.certPath, expiresAt: null, daysRemaining: null, valid: false, issuer: null, subject: null };
    }
  }

  /**
   * 检查是否需要续期
   */
  needsRenewal(): boolean {
    const status = this.getStatus();

    return status.enabled && status.daysRemaining !== null && status.daysRemaining < this.config.renewThreshold;
  }

  /**
   * 更新配置
   */
  updateConfig(partial: Partial<TlsConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  /**
   * 获取配置
   */
  getConfig(): TlsConfig {
    return { ...this.config };
  }
}

export const tlsManager = new TlsManager();
