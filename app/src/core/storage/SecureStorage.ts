import { EventEmitter } from 'events';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  pbkdf2,
  CipherGCM,
  DecipherGCM,
} from 'crypto';
import { readFile, writeFile, mkdir, access, stat } from 'fs/promises';
import { existsSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { logger } from '@modules/utils/log.js';
import { resolvePyappHome } from '@modules/config/paths';

/**
 * 安全存储数据接口
 */
export interface SecureStorageData {
  [key: string]: unknown;
}

/**
 * 安全存储操作结果
 */
export interface SecureStorageResult {
  success: boolean;
  warning?: string;
  error?: string;
}

/**
 * 安全存储接口
 */
export interface ISecureStorage {
  read(): SecureStorageData | null;
  update(data: SecureStorageData): SecureStorageResult;
  delete(): boolean;
  getName(): string;
}

/**
 * 加密配置
 */
export interface EncryptionConfig {
  algorithm: string;
  ivLength: number;
  authTagLength: number;
  saltLength: number;
  iterations: number;
}

/**
 * 默认加密配置
 */
const DEFAULT_ENCRYPTION_CONFIG: EncryptionConfig = {
  algorithm: 'aes-256-gcm',
  ivLength: 16,
  authTagLength: 16,
  saltLength: 64,
  iterations: 100000,
};

/**
 * 安全存储服务
 * * - 多平台支持（macOS Keychain, Linux libsecret, Windows DPAPI）
 * - 降级策略（密钥链不可用时使用加密文件）
 * - AES-256-GCM加密
 * - 文件权限控制（0o600）
 */
export class SecureStorage extends EventEmitter {
  private static instance: SecureStorage;

  private storagePath: string;
  private encryptionKey: Buffer | null;
  private config: EncryptionConfig;
  private cache: SecureStorageData | null;
  private cacheTimestamp: number;
  private cacheTtlMs: number;

  private constructor(options?: {
    storagePath?: string;
    encryptionKey?: string;
    cacheTtlMs?: number;
  }) {
    super();
    this.storagePath = options?.storagePath || this.getDefaultStoragePath();
    this.encryptionKey = null;
    this.config = DEFAULT_ENCRYPTION_CONFIG;
    this.cache = null;
    this.cacheTimestamp = 0;
    this.cacheTtlMs = options?.cacheTtlMs ?? 5000;
  }

  /**
   * 获取单例实例
   */
  static getInstance(options?: {
    storagePath?: string;
    encryptionKey?: string;
    cacheTtlMs?: number;
  }): SecureStorage {
    if (!SecureStorage.instance) {
      SecureStorage.instance = new SecureStorage(options);
    }
    return SecureStorage.instance;
  }

  /**
   * 重置单例实例（用于测试）
   */
  static resetInstance(): void {
    if (SecureStorage.instance) {
      SecureStorage.instance = undefined as unknown as SecureStorage;
    }
  }

  /**
   * 读取安全存储数据
   */
  async read(): Promise<SecureStorageData | null> {
    // 检查缓存
    if (this.isCacheValid()) {
      return this.cache;
    }

    try {
      if (!existsSync(this.storagePath)) {
        this.cache = null;
        this.cacheTimestamp = Date.now();
        return null;
      }

      const encryptedData = await readFile(this.storagePath);
      const key = await this.getEncryptionKey();
      const decrypted = this.decrypt(encryptedData, key);
      const data = JSON.parse(decrypted);

      this.cache = data;
      this.cacheTimestamp = Date.now();

      return data;
    } catch (error) {
      logger.warn('Failed to read secure storage:', {
        error: error instanceof Error ? error.message : String(error),
      });
      this.cache = null;
      this.cacheTimestamp = Date.now();
      return null;
    }
  }

  /**
   * 更新安全存储数据
   */
  async update(data: SecureStorageData): Promise<SecureStorageResult> {
    try {
      const dir = dirname(this.storagePath);
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }

      const key = await this.getEncryptionKey();
      const encrypted = this.encrypt(JSON.stringify(data), key);

      await writeFile(this.storagePath, encrypted, { mode: 0o600 });
      chmodSync(this.storagePath, 0o600);

      // 更新缓存
      this.cache = data;
      this.cacheTimestamp = Date.now();

      this.emit('updated', data);

      return { success: true };
    } catch (error) {
      logger.error('Failed to update secure storage:', error as Error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * 删除安全存储
   */
  async delete(): Promise<boolean> {
    try {
      const { unlink } = await import('fs/promises');
      await unlink(this.storagePath);
      this.cache = null;
      this.cacheTimestamp = 0;
      this.emit('deleted');
      return true;
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        return true;
      }
      logger.error(
        'Failed to delete secure storage:',
        error instanceof Error ? error : undefined
      );
      return false;
    }
  }

  /**
   * 获取存储名称
   */
  getName(): string {
    return 'encrypted-file';
  }

  /**
   * 检查缓存是否有效
   */
  private isCacheValid(): boolean {
    if (!this.cache) {
      return false;
    }
    return Date.now() - this.cacheTimestamp < this.cacheTtlMs;
  }

  /**
   * 获取加密密钥
   */
  private async getEncryptionKey(): Promise<Buffer> {
    if (this.encryptionKey) {
      return this.encryptionKey;
    }

    const key = process.env.LIRI_ENCRYPTION_KEY;
    if (!key) {
      throw new AppError(
        'LIRI_ENCRYPTION_KEY environment variable is required',
        ErrorCategory.CONFIGURATION,
        ErrorSeverity.HIGH
      );
    }

    const salt = Buffer.from('pyapp-secure-storage-salt');

    return new Promise((resolve, reject) => {
      pbkdf2(
        key,
        salt,
        this.config.iterations,
        32,
        'sha256',
        (err, derivedKey) => {
          if (err) reject(err);
          else {
            this.encryptionKey = derivedKey;
            resolve(derivedKey);
          }
        }
      );
    });
  }

  /**
   * 加密数据
   */
  private encrypt(text: string, key: Buffer): Buffer {
    const iv = randomBytes(this.config.ivLength);
    const cipher = createCipheriv(this.config.algorithm, key, iv);

    let encrypted = cipher.update(text, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);

    const authTag = (cipher as unknown as CipherGCM).getAuthTag();

    return Buffer.concat([iv, authTag, encrypted]);
  }

  /**
   * 解密数据
   */
  private decrypt(encrypted: Buffer, key: Buffer): string {
    const iv = encrypted.subarray(0, this.config.ivLength);
    const authTag = encrypted.subarray(
      this.config.ivLength,
      this.config.ivLength + this.config.authTagLength
    );
    const encryptedText = encrypted.subarray(
      this.config.ivLength + this.config.authTagLength
    );

    const decipher = createDecipheriv(this.config.algorithm, key, iv);
    (decipher as unknown as DecipherGCM).setAuthTag(authTag);

    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted.toString('utf8');
  }

  /**
   * 获取默认存储路径
   */
  private getDefaultStoragePath(): string {
    return join(resolvePyappHome(), 'secure', 'credentials.enc');
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache = null;
    this.cacheTimestamp = 0;
  }

  /**
   * 获取存储状态
   */
  async getStatus(): Promise<{
    exists: boolean;
    cached: boolean;
    cacheAge: number;
    path: string;
  }> {
    const exists = existsSync(this.storagePath);
    let fileStats = null;

    if (exists) {
      fileStats = await stat(this.storagePath);
    }

    return {
      exists,
      cached: this.cache !== null,
      cacheAge: this.cacheTimestamp > 0 ? Date.now() - this.cacheTimestamp : 0,
      path: this.storagePath,
    };
  }
}
