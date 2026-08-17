/**
 * 邮件凭据加密模块
 * AES-256-GCM 加密/解密，三层密钥策略（无硬编码回退）
 *
 * 密钥查找优先级：
 *   1. LIRI_SECRET_KEY 环境变量（最高优先级）
 *   2. ~/.pyapp/config/secret.key 持久化文件
 *   3. 首次启动自动生成随机密钥并持久化（权限 600）
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { resolvePyappHome } from '@modules/core';

const ALGORITHM = 'aes-256-gcm';

/**
 * 获取或生成加密密钥
 */
function getKey(): Buffer {
  // 1. 环境变量（最高优先级）
  const envKey = process.env['LIRI_SECRET_KEY'];
  if (envKey) return crypto.createHash('sha256').update(envKey).digest();

  // 2. 持久化密钥文件
  const keyPath = path.join(resolvePyappHome(), 'config', 'secret.key');
  if (fs.existsSync(keyPath)) {
    return Buffer.from(fs.readFileSync(keyPath, 'utf-8'), 'hex');
  }

  // 3. 首次启动：生成随机密钥并持久化
  const keyDir = path.dirname(keyPath);
  if (!fs.existsSync(keyDir)) fs.mkdirSync(keyDir, { recursive: true });
  const randomKey = crypto.randomBytes(32);
  fs.writeFileSync(keyPath, randomKey.toString('hex'), { mode: 0o600 });
  return randomKey;
}

/**
 * 加密密码（AES-256-GCM）
 *
 * @param plaintext 明文密码
 * @returns `iv:encrypted:tag` 格式的密文（hex 编码）
 */
export function encryptPassword(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf-8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${encrypted.toString('hex')}:${tag.toString('hex')}`;
}

/**
 * 解密密码
 *
 * @param ciphertext `iv:encrypted:tag` 格式的密文
 * @returns 明文密码
 * @throws 密钥变更或密文损坏时抛出异常
 */
export function decryptPassword(ciphertext: string): string {
  const [ivHex, encHex, tagHex] = ciphertext.split(':');
  const key = getKey();
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(ivHex, 'hex')
  );
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encHex, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf-8');
}

/**
 * 判断字符串是否为 `iv:encrypted:tag` 密文格式
 */
export function isEncryptedPassword(value: string): boolean {
  const parts = value.split(':');
  return parts.length === 3 && parts.every((p) => /^[0-9a-f]+$/i.test(p));
}

/**
 * 解析账户密码：密文则解密返回明文，非密文（明文/空）原样返回。
 * BUG-2：EmailSender/EmailReader 认证前必须解密密文密码。
 */
export function resolvePlainPassword(pass: string | undefined): string {
  if (!pass) return pass ?? '';
  if (!isEncryptedPassword(pass)) return pass;
  return decryptPassword(pass);
}
