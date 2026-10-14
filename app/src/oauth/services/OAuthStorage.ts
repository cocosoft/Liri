// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * OAuth Token 安全存储服务（唯一实现）
 *
 * 使用 AES-256-GCM + PBKDF2(100k iterations) 加密存储每个 Token 到独立文件。
 * 文件权限 0o600，每个 Token 独立加密。
 *
 * TokenManager 是唯一的 Token 管理入口，本存储是唯一的持久化实现。
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { readFile, writeFile, mkdir, access } from 'fs/promises';
import { join } from 'path';
import { getLogger } from '@modules/monitoring';
import { resolvePyappHome } from '@modules/core';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { configManager } from '@modules/config';
// AES-256-GCM 参数统一到真源 `../utils/OAuthCrypto.ts`（硬编码治理「同名常量」B2b）——
// 以**别名导入**保留原有局部名 ⇒ 加解密实现**逐字不动**（用法零改动，降低安全代码 review 风险）。
import {
  OAUTH_CIPHER_ALGORITHM as ALGORITHM,
  OAUTH_CIPHER_IV_LENGTH as IV_LENGTH,
  OAUTH_CIPHER_AUTH_TAG_LENGTH as AUTH_TAG_LENGTH,
  OAUTH_CIPHER_KEY_LENGTH as KEY_LENGTH,
  OAUTH_PBKDF2_ITERATIONS as ITERATIONS,
} from '../utils/OAuthCrypto.js';

const logger = getLogger('OAuthStorage');

/**
 * PBKDF2 盐（**本存储专用**；密钥强度依赖 `OAUTH_ENCRYPTION_KEY`）。
 * 硬编码治理「同名常量」B2b：与 `OAuthProviderStore.ts` 的盐**值不同**（不同事实）
 * ⇒ 原同名 `PBKDF2_SALT` 具误导性，改名消歧（**值不变** ⇒ 存量密文照常解密）。
 */
const TOKEN_PBKDF2_SALT = Buffer.from('pyapp-oauth-salt-v2');

/**
 * OAuth Token 数据结构（唯一版本）
 */
export interface OAuthTokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  tokenType?: string;
  scopes?: string[];
  subscriptionType?: string | null;
  rateLimitTier?: string | null;
}

/**
 * OAuth 存储服务接口
 */
export interface OAuthStorage {
  saveToken(serverKey: string, token: OAuthTokenData): Promise<void>;
  loadToken(serverKey: string): Promise<OAuthTokenData | null>;
  deleteToken(serverKey: string): Promise<void>;
  deleteAllTokens(): Promise<void>;
  /** 列出所有已存储的 serverKey */
  listKeys(): Promise<string[]>;
}

/**
 * OAuth 存储服务实现（AES-256-GCM 加密，每 Token 独立文件）
 */
class OAuthStorageImpl implements OAuthStorage {
  private storageDir: string;

  constructor(storagePath?: string) {
    this.storageDir =
      storagePath || join(resolvePyappHome(), 'oauth', 'tokens');
  }

  /** 确保存储目录存在 */
  private async ensureDir(): Promise<void> {
    await mkdir(this.storageDir, { recursive: true });
  }

  /** 获取 Token 文件路径（安全化文件名） */
  private filePath(serverKey: string): string {
    const safe = serverKey.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.storageDir, `${safe}.token.enc`);
  }

  async saveToken(serverKey: string, token: OAuthTokenData): Promise<void> {
    await this.ensureDir();
    const key = await this.getEncryptionKey();
    const encrypted = this.encrypt(JSON.stringify(token), key);
    await writeFile(this.filePath(serverKey), encrypted, { mode: 0o600 });
    logger.debug(`Token saved for ${serverKey}`);
  }

  async loadToken(serverKey: string): Promise<OAuthTokenData | null> {
    try {
      const filePath = this.filePath(serverKey);
      await access(filePath);
      const encrypted = await readFile(filePath);
      const key = await this.getEncryptionKey();
      const decrypted = this.decrypt(encrypted, key);
      return JSON.parse(decrypted) as OAuthTokenData;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      logger.error(`Failed to load token for ${serverKey}:`, error);
      throw error;
    }
  }

  async deleteToken(serverKey: string): Promise<void> {
    try {
      const { unlink } = await import('fs/promises');
      await unlink(this.filePath(serverKey));
      logger.debug(`Token deleted for ${serverKey}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  async listKeys(): Promise<string[]> {
    try {
      await access(this.storageDir);
      const { readdir } = await import('fs/promises');
      const files = await readdir(this.storageDir);
      return files
        .filter((f) => f.endsWith('.token.enc'))
        .map((f) => f.replace('.token.enc', ''));
    } catch {
      return [];
    }
  }

  async deleteAllTokens(): Promise<void> {
    const keys = await this.listKeys();
    for (const key of keys) {
      await this.deleteToken(key);
    }
    logger.info('All tokens deleted');
  }

  // ─── 加密层 ──────────────────────────────────────────

  /** PBKDF2 密钥派生（100,000 迭代） */
  private async getEncryptionKey(): Promise<Buffer> {
    const envKey = configManager.env('OAUTH_ENCRYPTION_KEY');
    if (!envKey) {
      throw new AppError(
        'OAUTH_ENCRYPTION_KEY 环境变量未配置，OAuth Token 加密存储无法安全初始化',
        ErrorCategory.EXECUTION,
        ErrorSeverity.CRITICAL,
        'OAUTH_ENCRYPTION_KEY_MISSING'
      );
    }
    if (envKey.length < 32) {
      throw new AppError(
        'OAUTH_ENCRYPTION_KEY 长度不足 32 字符',
        ErrorCategory.EXECUTION,
        ErrorSeverity.CRITICAL,
        'OAUTH_ENCRYPTION_KEY_TOO_SHORT'
      );
    }

    const { pbkdf2 } = await import('crypto');
    return new Promise((resolve, reject) => {
      pbkdf2(
        envKey,
        TOKEN_PBKDF2_SALT,
        ITERATIONS,
        KEY_LENGTH,
        'sha256',
        (err, key) => {
          if (err) reject(err);
          else resolve(key);
        }
      );
    });
  }

  /** AES-256-GCM 加密 */
  private encrypt(plaintext: string, key: Buffer): Buffer {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, encrypted]);
  }

  /** AES-256-GCM 解密 */
  private decrypt(data: Buffer, key: Buffer): string {
    const iv = data.subarray(0, IV_LENGTH);
    const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  }
}

/**
 * 创建 OAuth 存储服务实例（唯一工厂）
 */
export function createOAuthStorage(storagePath?: string): OAuthStorage {
  return new OAuthStorageImpl(storagePath);
}
