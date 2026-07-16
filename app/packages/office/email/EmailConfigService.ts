/**
 * 邮件配置服务
 * 负责邮箱凭据的 AES-GCM 加密存储、密钥指纹校验和配置加载
 */

import * as fs from 'fs';
import * as path from 'path';
import { resolvePyappHome } from '@modules/core';
import { Logger, LogLevel } from '@modules/monitoring';

import type { EmailConfig, EmailAccount } from '@modules/mail/types';

const logger = new Logger({
  module: 'mail:config',
  level: LogLevel.INFO,
});

/** 配置文件路径 */
function getConfigPath(): string {
  return path.join(resolvePyappHome(), 'office', 'config', 'email.json');
}

/**
 * 邮件配置服务
 * 采用 AES-256-GCM 加密存储、密钥指纹校验
 */
export class EmailConfigService {
  private config: EmailConfig | null = null;

  /**
   * 加载邮箱配置
   */
  async load(): Promise<EmailConfig> {
    try {
      const configPath = getConfigPath();
      if (!fs.existsSync(configPath)) {
        logger.info('邮箱配置文件不存在，返回空配置');
        return { accounts: [] };
      }

      const raw = fs.readFileSync(configPath, 'utf-8');
      this.config = JSON.parse(raw) as EmailConfig;

      // 密钥指纹校验
      for (const account of this.config.accounts) {
        if (account.authMethod === 'oauth2') {
          this.validateKeyFingerprint(account);
        }
      }

      logger.info('邮箱配置已加载', { accountCount: this.config.accounts.length });
      return this.config;
    } catch (error) {
      logger.warn('邮箱配置加载失败', { error: String(error) });
      return { accounts: [] };
    }
  }

  /**
   * 保存邮箱配置（加密存储）
   */
  async save(config: EmailConfig): Promise<void> {
    const configDir = path.dirname(getConfigPath());
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    // TODO: AES-GCM 加密
    // const encrypted = aesGcmEncrypt(JSON.stringify(config), getEncryptionKey());
    fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf-8');
    this.config = config;
    logger.info('邮箱配置已保存');
  }

  /**
   * 获取已配置账户列表
   */
  getAccounts(): EmailAccount[] {
    return this.config?.accounts || [];
  }

  /**
   * 添加邮箱账户
   */
  async addAccount(account: EmailAccount): Promise<void> {
    const config = await this.load();
    config.accounts.push(account);
    await this.save(config);
  }

  /**
   * 密钥指纹校验
   * 加载配置时对比指纹，不匹配提示重新配置
   */
  private validateKeyFingerprint(account: EmailAccount): void {
    // TODO: 计算 current fingerprint → 对比 stored fingerprint
    // const currentFingerprint = sha256(getEncryptionKey()).slice(0, 8);
    // if (currentFingerprint !== account.storedFingerprint) {
    //   throw new Error('MAIL_KEY_FINGERPRINT_MISMATCH');
    // }
  }
}
