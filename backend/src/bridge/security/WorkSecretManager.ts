//
/**
 * 工作密钥管理器
 * 负责工作密钥的生成、存储和轮换
 */

import * as crypto from 'crypto';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

export interface WorkSecret {
  sessionIngressToken: string;
  apiBaseUrl: string;
  useCodeSessions: boolean;
}

export interface WorkSecretManagerOptions {
  /** 密钥存储路径 */
  storagePath?: string;
  /** 密钥轮换周期（毫秒） */
  rotationPeriodMs?: number;
  /** 密钥算法 */
  algorithm?: string;
  /** 密钥长度 */
  keyLength?: number;
}

const DEFAULT_ALGORITHM = 'aes-256-gcm';
const DEFAULT_KEY_LENGTH = 32;
const DEFAULT_ROTATION_PERIOD_MS = 24 * 60 * 60 * 1000; // 24小时

interface StoredSecret {
  keyId: string;
  secret: string;
  createdAt: number;
  expiresAt: number;
  rotationCount: number;
}

class WorkSecretManager {
  private storagePath: string;
  private rotationPeriodMs: number;
  private algorithm: string;
  private keyLength: number;
  private currentKey: StoredSecret | null = null;
  private encryptionKey: Buffer | null = null;

  constructor(options: WorkSecretManagerOptions = {}) {
    this.storagePath =
      options.storagePath ||
      `${process.env.HOME || process.env.USERPROFILE || ''}/.py_app/work_keys.json`;
    this.rotationPeriodMs =
      options.rotationPeriodMs || DEFAULT_ROTATION_PERIOD_MS;
    this.algorithm = options.algorithm || DEFAULT_ALGORITHM;
    this.keyLength = options.keyLength || DEFAULT_KEY_LENGTH;
  }

  private generateKeyId(): string {
    return `key_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  private generateSecret(): string {
    return crypto.randomBytes(this.keyLength).toString('base64');
  }

  private generateEncryptionKey(): Buffer {
    return crypto.randomBytes(32);
  }

  private encrypt(plaintext: string): string {
    if (!this.encryptionKey) {
      this.encryptionKey = this.generateEncryptionKey();
    }
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(
      this.algorithm,
      this.encryptionKey,
      iv
    );
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = (cipher as any).getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  private decrypt(ciphertext: string): string {
    if (!this.encryptionKey) {
      throw new Error('Encryption key not initialized');
    }
    const [ivHex, authTagHex, encrypted] = ciphertext.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(
      this.algorithm,
      this.encryptionKey,
      iv
    );
    (decipher as any).setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  generate(secret: string, expiresInMs?: number): WorkSecret {
    const keyId = this.generateKeyId();
    const now = Date.now();

    const storedSecret: StoredSecret = {
      keyId,
      secret: this.encrypt(secret),
      createdAt: now,
      expiresAt: expiresInMs ? now + expiresInMs : now + this.rotationPeriodMs,
      rotationCount: 0,
    };

    this.currentKey = storedSecret;
    this.saveToStorage();

    return this.decodeSecret(secret);
  }

  private decodeSecret(secret: string): WorkSecret {
    try {
      const decoded = Buffer.from(secret, 'base64').toString('utf8');
      return JSON.parse(decoded);
    } catch {
      return {
        sessionIngressToken: secret,
        apiBaseUrl: '',
        useCodeSessions: false,
      };
    }
  }

  getCurrent(): WorkSecret | null {
    if (!this.currentKey) {
      this.loadFromStorage();
    }
    if (!this.currentKey) {
      return null;
    }
    try {
      const decrypted = this.decrypt(this.currentKey.secret);
      return this.decodeSecret(decrypted);
    } catch {
      return null;
    }
  }

  isExpired(): boolean {
    if (!this.currentKey) {
      return true;
    }
    return Date.now() > this.currentKey.expiresAt;
  }

  shouldRotate(): boolean {
    if (!this.currentKey) {
      return true;
    }
    const timeUntilExpiry = this.currentKey.expiresAt - Date.now();
    return timeUntilExpiry < this.rotationPeriodMs * 0.1; // 剩余10%时建议轮换
  }

  rotate(newSecret: string): WorkSecret {
    if (this.currentKey) {
      this.currentKey.rotationCount++;
    }
    return this.generate(newSecret);
  }

  private saveToStorage(): void {
    if (!this.currentKey) {
      return;
    }
    try {
      const fs = require('fs');
      const path = require('path');
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = JSON.stringify(this.currentKey, null, 2);
      fs.writeFileSync(this.storagePath, data, 'utf-8');
    } catch (error) {
      logger.error(
        'Failed to save work secret',
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  private loadFromStorage(): void {
    try {
      const fs = require('fs');
      if (!fs.existsSync(this.storagePath)) {
        return;
      }
      const data = fs.readFileSync(this.storagePath, 'utf-8');
      const stored = JSON.parse(data) as StoredSecret;
      if (Date.now() > stored.expiresAt) {
        this.delete();
        return;
      }
      this.currentKey = stored;
    } catch {
      this.currentKey = null;
    }
  }

  delete(): void {
    this.currentKey = null;
    try {
      const fs = require('fs');
      if (fs.existsSync(this.storagePath)) {
        fs.unlinkSync(this.storagePath);
      }
    } catch {
      // 忽略删除错误
    }
  }

  getRotationCount(): number {
    return this.currentKey?.rotationCount || 0;
  }

  getCreatedAt(): number | null {
    return this.currentKey?.createdAt || null;
  }

  getExpiresAt(): number | null {
    return this.currentKey?.expiresAt || null;
  }

  getTimeUntilExpiry(): number | null {
    if (!this.currentKey) {
      return null;
    }
    const remaining = this.currentKey.expiresAt - Date.now();
    return remaining > 0 ? remaining : 0;
  }
}

let globalManager: WorkSecretManager | undefined;

export function getWorkSecretManager(
  options?: WorkSecretManagerOptions
): WorkSecretManager {
  if (!globalManager) {
    globalManager = new WorkSecretManager(options);
  }
  return globalManager;
}

export function resetWorkSecretManager(): void {
  globalManager = undefined;
}

export { WorkSecretManager };
