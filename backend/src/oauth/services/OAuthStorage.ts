/**
 * OAuth Token安全存储服务
 * 提供Token的加密存储和读取功能
 */

import { logger } from '@modules/utils/log.js';
import { CryptoUtils } from '@modules/security/services/CryptoUtils.js';

/**
 * OAuth Token数据结构
 */
export interface OAuthTokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
  subscriptionType?: string | null;
  rateLimitTier?: string | null;
}

/**
 * OAuth存储服务接口
 */
export interface OAuthStorage {
  saveToken(serverKey: string, token: OAuthTokenData): Promise<void>;
  loadToken(serverKey: string): Promise<OAuthTokenData | null>;
  loadAllTokens(): Promise<Record<string, OAuthTokenData>>;
  deleteToken(serverKey: string): Promise<void>;
  deleteAllTokens(): Promise<void>;
}

/**
 * OAuth存储服务实现
 * 使用AES-256-GCM加密存储Token
 */
export class OAuthStorageImpl implements OAuthStorage {
  private storagePath: string;
  private encryptionKey: string;

  constructor(options?: { storagePath?: string; encryptionKey?: string }) {
    this.storagePath = options?.storagePath || './data/oauth-tokens.json';
    this.encryptionKey = options?.encryptionKey || this.getDefaultEncryptionKey();
  }

  /**
   * 保存Token
   */
  async saveToken(serverKey: string, token: OAuthTokenData): Promise<void> {
    try {
      const allTokens = await this.loadAllTokens();
      
      // 加密Token数据
      const encryptedToken = await CryptoUtils.encrypt(
        JSON.stringify(token),
        this.encryptionKey
      );
      
      allTokens[serverKey] = {
        ...token,
        accessToken: encryptedToken,
      };
      
      await this.writeToStorage(allTokens);
      logger.debug(`Token saved for ${serverKey}`);
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      logger.error(`Failed to save token for ${serverKey}:`, e);
      throw error;
    }
  }

  /**
   * 加载指定服务器的Token
   */
  async loadToken(serverKey: string): Promise<OAuthTokenData | null> {
    try {
      const allTokens = await this.loadAllTokens();
      const encryptedToken = allTokens[serverKey];
      
      if (!encryptedToken) {
        return null;
      }
      
      // 解密Token数据
      const decryptedToken = await CryptoUtils.decrypt(
        encryptedToken.accessToken,
        this.encryptionKey
      );
      
      return JSON.parse(decryptedToken);
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      logger.error(`Failed to load token for ${serverKey}:`, e);
      return null;
    }
  }

  /**
   * 加载所有Token
   */
  async loadAllTokens(): Promise<Record<string, OAuthTokenData>> {
    try {
      const fs = await import('fs/promises');
      const data = await fs.readFile(this.storagePath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      // 文件不存在或解析错误，返回空对象
      return {};
    }
  }

  /**
   * 删除指定服务器的Token
   */
  async deleteToken(serverKey: string): Promise<void> {
    try {
      const allTokens = await this.loadAllTokens();
      delete allTokens[serverKey];
      await this.writeToStorage(allTokens);
      logger.debug(`Token deleted for ${serverKey}`);
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      logger.error(`Failed to delete token for ${serverKey}:`, e);
      throw error;
    }
  }

  /**
   * 删除所有Token
   */
  async deleteAllTokens(): Promise<void> {
    try {
      await this.writeToStorage({});
      logger.debug('All tokens deleted');
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to delete all tokens:', e);
      throw error;
    }
  }

  /**
   * 写入存储
   */
  private async writeToStorage(data: Record<string, any>): Promise<void> {
    const fs = await import('fs/promises');
    const path = await import('path');
    
    // 确保目录存在
    const dir = path.dirname(this.storagePath);
    await fs.mkdir(dir, { recursive: true });
    
    await fs.writeFile(this.storagePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * 获取默认加密密钥
   * 实际应用中应从环境变量或安全配置中获取
   */
  private getDefaultEncryptionKey(): string {
    const key = process.env.OAUTH_ENCRYPTION_KEY;
    if (!key) {
      logger.warn('OAUTH_ENCRYPTION_KEY not set, using default key (NOT SECURE FOR PRODUCTION)');
      return 'default-oauth-encryption-key-change-in-production';
    }
    return key;
  }
}

/**
 * 创建OAuth存储服务实例
 */
export function createOAuthStorage(options?: {
  storagePath?: string;
  encryptionKey?: string;
}): OAuthStorage {
  return new OAuthStorageImpl(options);
}
