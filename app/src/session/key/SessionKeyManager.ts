/**
 * SessionKeyManager 会话密钥管理
 * 对标 CC 的会话密钥管理
 */
import crypto from 'node:crypto';

/**
 * 密钥配置
 */
export interface KeyConfig {
  algorithm: string;
  keyLength: number;
  rotationInterval: number;
}

/**
 * 会话密钥
 */
export interface SessionKey {
  id: string;
  sessionId: string;
  key: Buffer;
  createdAt: number;
  expiresAt: number;
  algorithm: string;
}

/**
 * 会话密钥管理器
 */
export class SessionKeyManager {
  private keys: Map<string, SessionKey> = new Map();
  private active: Map<string, string> = new Map();
  private config: KeyConfig;

  constructor(config?: Partial<KeyConfig>) {
    this.config = {
      algorithm: config?.algorithm || 'aes-256-gcm',
      keyLength: config?.keyLength || 32,
      rotationInterval: config?.rotationInterval || 24 * 60 * 60 * 1000,
    };
  }

  /**
   * 创建会话密钥
   */
  create(sessionId: string): SessionKey {
    const key: SessionKey = {
      id: `key_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`,
      sessionId,
      key: crypto.randomBytes(this.config.keyLength),
      createdAt: Date.now(),
      expiresAt: Date.now() + this.config.rotationInterval,
      algorithm: this.config.algorithm,
    };

    this.keys.set(key.id, key);
    this.active.set(sessionId, key.id);

    return key;
  }

  /**
   * 获取会话密钥
   */
  get(sessionId: string): SessionKey | undefined {
    const keyId = this.active.get(sessionId);

    if (!keyId) return undefined;

    const key = this.keys.get(keyId);

    if (!key) return undefined;

    if (Date.now() > key.expiresAt) {
      this.rotate(sessionId);

      return this.active.get(sessionId)
        ? this.keys.get(this.active.get(sessionId)!)
        : undefined;
    }

    return key;
  }

  /**
   * 加密数据
   */
  encrypt(
    sessionId: string,
    data: string
  ): { encrypted: string; iv: string; tag: string } | undefined {
    const sessionKey = this.get(sessionId);

    if (!sessionKey) return undefined;

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', sessionKey.key, iv);

    let encrypted = cipher.update(data, 'utf-8', 'hex');
    encrypted += cipher.final('hex');

    const tag = cipher.getAuthTag().toString('hex');

    return { encrypted, iv: iv.toString('hex'), tag };
  }

  /**
   * 解密数据
   */
  decrypt(
    sessionId: string,
    encrypted: string,
    ivHex: string,
    tagHex: string
  ): string | undefined {
    const sessionKey = this.get(sessionId);

    if (!sessionKey) return undefined;

    try {
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        sessionKey.key,
        Buffer.from(ivHex, 'hex')
      );

      decipher.setAuthTag(Buffer.from(tagHex, 'hex'));

      let decrypted = decipher.update(encrypted, 'hex', 'utf-8');
      decrypted += decipher.final('utf-8');

      return decrypted;
    } catch {
      return undefined;
    }
  }

  /**
   * 轮换密钥
   */
  rotate(sessionId: string): SessionKey {
    this.delete(sessionId);

    return this.create(sessionId);
  }

  /**
   * 删除密钥
   */
  delete(sessionId: string): boolean {
    const keyId = this.active.get(sessionId);

    if (keyId) {
      this.keys.delete(keyId);
      this.active.delete(sessionId);

      return true;
    }

    return false;
  }

  /**
   * 获取密钥统计
   */
  getStats(): { total: number; active: number; expired: number } {
    const now = Date.now();
    let expired = 0;

    for (const key of this.keys.values()) {
      if (now > key.expiresAt) {
        expired++;
      }
    }

    return {
      total: this.keys.size,
      active: this.active.size,
      expired,
    };
  }

  /**
   * 清理过期密钥
   */
  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [keyId, key] of this.keys.entries()) {
      if (now > key.expiresAt) {
        this.keys.delete(keyId);

        if (this.active.get(key.sessionId) === keyId) {
          this.active.delete(key.sessionId);
        }

        cleaned++;
      }
    }

    return cleaned;
  }
}

export const sessionKeyManager = new SessionKeyManager();
