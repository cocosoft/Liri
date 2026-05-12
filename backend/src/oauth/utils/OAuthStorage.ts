/**
 * OAuth Token加密存储
 * 提供安全的Token持久化功能
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { readFile, writeFile, mkdir, access } from 'fs/promises';
import { join } from 'path';
import { logger } from '@modules/infrastructure';
import type {
  StoredTokenData,
  ITokenStorage,
} from '../types/OAuthStorageTypes';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 64;
const ITERATIONS = 100000;

/**
 * 创建OAuth存储实例
 */
export function createOAuthStorage(storagePath?: string): ITokenStorage {
  const path = storagePath || getDefaultStoragePath();
  return new OAuthTokenStorage(path);
}

/**
 * OAuth Token存储实现
 */
class OAuthTokenStorage implements ITokenStorage {
  private storagePath: string;

  constructor(storagePath: string) {
    this.storagePath = storagePath;
  }

  /**
   * 保存Token
   */
  async saveToken(
    serverKey: string,
    tokenData: StoredTokenData
  ): Promise<void> {
    try {
      const filePath = this.getTokenFilePath(serverKey);
      const encryptionKey = await this.getEncryptionKey();
      const encrypted = this.encrypt(JSON.stringify(tokenData), encryptionKey);

      await mkdir(this.storagePath, { recursive: true });
      await writeFile(filePath, encrypted, { mode: 0o600 });

      logger.info(`Token saved for ${serverKey}`);
    } catch (error) {
      logger.error(`Failed to save token for ${serverKey}:`, error);
      throw error;
    }
  }

  /**
   * 加载Token
   */
  async loadToken(serverKey: string): Promise<StoredTokenData | null> {
    try {
      const filePath = this.getTokenFilePath(serverKey);
      await access(filePath);

      const encrypted = await readFile(filePath);
      const encryptionKey = await this.getEncryptionKey();
      const decrypted = this.decrypt(encrypted, encryptionKey);

      const tokenData = JSON.parse(decrypted) as StoredTokenData;
      logger.debug(`Token loaded for ${serverKey}`);

      return tokenData;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      logger.error(`Failed to load token for ${serverKey}:`, error);
      throw error;
    }
  }

  /**
   * 删除Token
   */
  async deleteToken(serverKey: string): Promise<void> {
    try {
      const { unlink } = await import('fs/promises');
      const filePath = this.getTokenFilePath(serverKey);
      await unlink(filePath);
      logger.info(`Token deleted for ${serverKey}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.error(`Failed to delete token for ${serverKey}:`, error);
        throw error;
      }
    }
  }

  /**
   * 列出所有Token
   */
  async listTokens(): Promise<string[]> {
    try {
      const { readdir } = await import('fs/promises');
      await access(this.storagePath);

      const files = await readdir(this.storagePath);
      return files
        .filter((file) => file.endsWith('.token.enc'))
        .map((file) => file.replace('.token.enc', ''));
    } catch {
      return [];
    }
  }

  /**
   * 清除所有Token
   */
  async clearAllTokens(): Promise<void> {
    try {
      const { rm } = await import('fs/promises');
      await rm(this.storagePath, { recursive: true, force: true });
      logger.info('All tokens cleared');
    } catch (error) {
      logger.error('Failed to clear all tokens:', error);
      throw error;
    }
  }

  /**
   * 获取Token文件路径
   */
  private getTokenFilePath(serverKey: string): string {
    const safeKey = serverKey.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.storagePath, `${safeKey}.token.enc`);
  }

  /**
   * 获取加密密钥
   */
  private async getEncryptionKey(): Promise<Buffer> {
    const key = process.env.OAUTH_ENCRYPTION_KEY;
    if (!key) {
      throw new AppError(
        'OAUTH_ENCRYPTION_KEY environment variable is required',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const { pbkdf2 } = await import('crypto');
    const salt = Buffer.from('pyapp-oauth-salt');

    return new Promise((resolve, reject) => {
      pbkdf2(key, salt, ITERATIONS, 32, 'sha256', (err, derivedKey) => {
        if (err) reject(err);
        else resolve(derivedKey);
      });
    });
  }

  /**
   * 加密数据
   */
  private encrypt(text: string, key: Buffer): Buffer {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(text, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);

    const authTag = cipher.getAuthTag();

    return Buffer.concat([iv, authTag, encrypted]);
  }

  /**
   * 解密数据
   */
  private decrypt(encrypted: Buffer, key: Buffer): string {
    const iv = encrypted.subarray(0, IV_LENGTH);
    const authTag = encrypted.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const encryptedText = encrypted.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted.toString('utf8');
  }
}

/**
 * 获取默认存储路径
 */
function getDefaultStoragePath(): string {
  const { homedir } = require('os');
  const { join } = require('path');
  return join(homedir(), '.pyapp', 'oauth', 'tokens');
}
