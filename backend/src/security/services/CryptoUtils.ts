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
  CipherGCM,
  DecipherGCM,
} from 'crypto';

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

    // 组合salt + iv + authTag + encrypted data
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
}
