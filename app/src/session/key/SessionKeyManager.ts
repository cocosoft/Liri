/**
 * SessionKeyManager 会话密钥管理
 * 对标 CC 的会话密钥管理
 */
import crypto from 'crypto';

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
   * M4-fix: 返回值携带 keyId，解密时按 keyId 取旧键（轮换后旧密文仍可解）。
   */
  encrypt(
    sessionId: string,
    data: string
  ): { encrypted: string; iv: string; tag: string; keyId: string } | undefined {
    const sessionKey = this.get(sessionId);

    if (!sessionKey) return undefined;

    const iv = crypto.randomBytes(12);
    // M4-fix: config.algorithm 为 string 类型，TS 无法推断 GCM 特有方法，断言为 CipherGCM
    const cipher = crypto.createCipheriv(
      this.config.algorithm,
      sessionKey.key,
      iv
    ) as crypto.CipherGCM;

    let encrypted = cipher.update(data, 'utf-8', 'hex');
    encrypted += cipher.final('hex');

    const tag = cipher.getAuthTag().toString('hex');

    return {
      encrypted,
      iv: iv.toString('hex'),
      tag,
      keyId: sessionKey.id,
    };
  }

  /**
   * 解密数据
   * M4-fix: 增加可选 keyId —— 传入时直接从 keys Map 取对应密钥（跨轮换的旧
   * 密文可解，不会触发轮换删除旧键）；不传时回退 get(sessionId) 行为不变。
   */
  decrypt(
    sessionId: string,
    encrypted: string,
    ivHex: string,
    tagHex: string,
    keyId?: string
  ): string | undefined {
    const sessionKey = keyId ? this.keys.get(keyId) : this.get(sessionId);

    if (!sessionKey) return undefined;

    try {
      const decipher = crypto.createDecipheriv(
        this.config.algorithm,
        sessionKey.key,
        Buffer.from(ivHex, 'hex')
      ) as crypto.DecipherGCM;

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
   * M4-fix: 不再 delete 旧键 —— 旧键保留在 keys Map 中供解密历史密文
   * （宽限期），仅将 active 指向新键。显式 delete(sessionId) 仍可移除。
   */
  rotate(sessionId: string): SessionKey {
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
