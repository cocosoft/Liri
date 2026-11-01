/**
 * 加密工具类
 * 提供AES-256-GCM加密解密功能
 * 参考CC源码的crypto.ts实现
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  createHash,
  randomUUID,
  CipherGCM,
  DecipherGCM,
} from 'crypto';

export interface EncryptionOptions {
  algorithm: string;
  keyLength: number;
  ivLength: number;
}

export const ENCRYPTION_ALGORITHMS = {
  AES_256_CBC: 'aes-256-cbc',
  AES_256_GCM: 'aes-256-gcm',
  AES_128_CBC: 'aes-128-cbc',
} as const;

export const DEFAULT_ENCRYPTION_OPTIONS: EncryptionOptions = {
  algorithm: ENCRYPTION_ALGORITHMS.AES_256_CBC,
  keyLength: 32,
  ivLength: 16,
};

/**
 * 加密配置
 */
interface CryptoConfig {
  algorithm: string;
  keyLength: number;
  ivLength: number;
  saltLength: number;
  tagLength: number;
}

/**
 * 默认加密配置
 */
const DEFAULT_CONFIG: CryptoConfig = {
  algorithm: 'aes-256-gcm',
  keyLength: 32,
  ivLength: 16,
  saltLength: 16,
  tagLength: 16,
};

/**
 * 加密工具类
 */
export class CryptoUtils {
  private static config: CryptoConfig = DEFAULT_CONFIG;

  /**
   * 加密数据
   * @param data 要加密的数据
   * @param key 加密密钥
   * @returns 加密后的数据（包含salt和iv）
   */
  static async encrypt(data: string, key: string): Promise<string> {
    const salt = randomBytes(this.config.saltLength);
    const iv = randomBytes(this.config.ivLength);

    const derivedKey = this.deriveKey(key, salt);

    const cipher = createCipheriv(
      this.config.algorithm,
      derivedKey,
      iv
    ) as CipherGCM;

    let encrypted = cipher.update(data, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    const authTag = cipher.getAuthTag();

    const result = Buffer.concat([
      salt,
      iv,
      authTag,
      Buffer.from(encrypted, 'base64'),
    ]).toString('base64');

    return result;
  }

  /**
   * 解密数据
   * @param encrypted 加密的数据
   * @param key 解密密钥
   * @returns 解密后的数据
   */
  static async decrypt(encrypted: string, key: string): Promise<string> {
    const buffer = Buffer.from(encrypted, 'base64');

    const salt = buffer.subarray(0, this.config.saltLength);
    const iv = buffer.subarray(
      this.config.saltLength,
      this.config.saltLength + this.config.ivLength
    );
    const authTag = buffer.subarray(
      this.config.saltLength + this.config.ivLength,
      this.config.saltLength + this.config.ivLength + this.config.tagLength
    );
    const encryptedData = buffer.subarray(
      this.config.saltLength + this.config.ivLength + this.config.tagLength
    );

    const derivedKey = this.deriveKey(key, salt);

    const decipher = createDecipheriv(
      this.config.algorithm,
      derivedKey,
      iv
    ) as DecipherGCM;
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedData, undefined, 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * 派生密钥
   * 使用scrypt从密码派生密钥
   */
  private static deriveKey(password: string, salt: Buffer): Buffer {
    return scryptSync(password, salt, this.config.keyLength);
  }

  /**
   * 生成随机密钥
   * @param length 密钥长度（字节），默认32字节（256位）
   * @returns 十六进制格式的密钥
   */
  static generateKey(length: number = 32): string {
    return randomBytes(length).toString('hex');
  }

  /**
   * 生成随机IV
   * @param length IV长度（字节），默认16字节
   * @returns 十六进制格式的IV
   */
  static generateIV(length: number = 16): string {
    return randomBytes(length).toString('hex');
  }

  /**
   * 生成随机salt
   * @param length salt长度（字节），默认16字节
   * @returns 十六进制格式的salt
   */
  static generateSalt(length: number = 16): string {
    return randomBytes(length).toString('hex');
  }

  /**
   * 使用密码加密（基于SHA256派生密钥）
   */
  static encryptWithPassword(
    plaintext: string,
    password: string,
    options: EncryptionOptions = DEFAULT_ENCRYPTION_OPTIONS
  ): { ciphertext: string; iv: string; salt: string } {
    const salt = randomBytes(16);
    const key = this.deriveSimpleKey(password, salt, options.keyLength);
    const iv = randomBytes(options.ivLength);
    const cipher = createCipheriv(options.algorithm, key, iv);

    let ciphertext: Buffer;
    if (options.algorithm.includes('gcm')) {
      const encrypted = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final(),
      ]);
      const authTag = (cipher as any).getAuthTag();
      return {
        ciphertext: Buffer.concat([encrypted, authTag]).toString('base64'),
        iv: iv.toString('base64'),
        salt: salt.toString('base64'),
      };
    } else {
      ciphertext = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final(),
      ]);
      return {
        ciphertext: ciphertext.toString('base64'),
        iv: iv.toString('base64'),
        salt: salt.toString('base64'),
      };
    }
  }

  /**
   * 使用密码解密
   */
  static decryptWithPassword(
    ciphertext: string,
    password: string,
    iv: string,
    salt: string,
    options: EncryptionOptions = DEFAULT_ENCRYPTION_OPTIONS
  ): string {
    const saltBuffer = Buffer.from(salt, 'base64');
    const key = this.deriveSimpleKey(password, saltBuffer, options.keyLength);
    const ivBuffer = Buffer.from(iv, 'base64');
    const ciphertextBuffer = Buffer.from(ciphertext, 'base64');

    if (options.algorithm.includes('gcm')) {
      const decipher = createDecipheriv(options.algorithm, key, ivBuffer);
      const authTag = ciphertextBuffer.subarray(ciphertextBuffer.length - 16);
      const data = ciphertextBuffer.subarray(0, ciphertextBuffer.length - 16);
      (decipher as any).setAuthTag(authTag);
      return decipher.update(data).toString('utf8') + decipher.final('utf8');
    } else {
      const decipher = createDecipheriv(options.algorithm, key, ivBuffer);
      return (
        decipher.update(ciphertextBuffer).toString('utf8') +
        decipher.final('utf8')
      );
    }
  }

  /**
   * 简单派生密钥（SHA256方式，与密码加密兼容）
   */
  private static deriveSimpleKey(
    password: string,
    salt: Buffer,
    keyLength: number = 32
  ): Buffer {
    return createHash('sha256')
      .update(password)
      .update(salt)
      .digest()
      .subarray(0, keyLength);
  }

  /**
   * 生成安全令牌
   */
  static generateSecureToken(length: number = 32): string {
    return randomBytes(length).toString('base64url');
  }

  /**
   * 生成UUID
   */
  static generateUUID(): string {
    return randomUUID();
  }

  /**
   * 常量时间比较
   */
  static constantTimeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
  }

  /**
   * 哈希密码
   */
  static hashPassword(
    password: string,
    salt?: string
  ): { hash: string; salt: string } {
    const saltBuffer = salt ? Buffer.from(salt, 'base64') : randomBytes(16);
    const hash = createHash('sha256')
      .update(password)
      .update(saltBuffer)
      .digest('base64');
    return {
      hash,
      salt: saltBuffer.toString('base64'),
    };
  }

  /**
   * 验证密码
   */
  static verifyPassword(password: string, hash: string, salt: string): boolean {
    const saltBuffer = Buffer.from(salt, 'base64');
    const computedHash = createHash('sha256')
      .update(password)
      .update(saltBuffer)
      .digest('base64');
    return this.constantTimeCompare(computedHash, hash);
  }
}
