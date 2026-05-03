// @ts-nocheck
/**
 * 加密解密工具
 * 基于CC源码实现
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
  createHmac,
  randomUUID,
  type BinaryLike,
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

export function generateEncryptionKey(length: number = 32): Buffer {
  return randomBytes(length);
}

export function generateIV(length: number = 16): Buffer {
  return randomBytes(length);
}

export function deriveKey(password: string, salt: Buffer, keyLength: number = 32): Buffer {
  return createHash('sha256').update(password).update(salt).digest();
}

export function encrypt(
  plaintext: string,
  key: Buffer,
  options: EncryptionOptions = DEFAULT_ENCRYPTION_OPTIONS
): { ciphertext: string; iv: string; authTag?: string } {
  const iv = generateIV(options.ivLength);
  const cipher = createCipheriv(options.algorithm, key, iv);

  let ciphertext: Buffer;
  if (options.algorithm.includes('gcm')) {
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      ciphertext: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
    };
  } else {
    ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
    };
  }
}

export function decrypt(
  ciphertext: string,
  key: Buffer,
  iv: string,
  options: EncryptionOptions = DEFAULT_ENCRYPTION_OPTIONS,
  authTag?: string
): string {
  const ivBuffer = Buffer.from(iv, 'base64');
  const ciphertextBuffer = Buffer.from(ciphertext, 'base64');

  if (options.algorithm.includes('gcm') && authTag) {
    const decipher = createDecipheriv(options.algorithm, key, ivBuffer);
    decipher.setAuthTag(Buffer.from(authTag, 'base64'));
    return decipher.update(ciphertextBuffer).toString('utf8') + decipher.final('utf8');
  } else {
    const decipher = createDecipheriv(options.algorithm, key, ivBuffer);
    return decipher.update(ciphertextBuffer).toString('utf8') + decipher.final('utf8');
  }
}

export function encryptWithPassword(
  plaintext: string,
  password: string,
  options: EncryptionOptions = DEFAULT_ENCRYPTION_OPTIONS
): { ciphertext: string; iv: string; salt: string } {
  const salt = randomBytes(16);
  const key = deriveKey(password, salt, options.keyLength);
  const result = encrypt(plaintext, key, options);
  return {
    ciphertext: result.ciphertext,
    iv: result.iv,
    salt: salt.toString('base64'),
  };
}

export function decryptWithPassword(
  ciphertext: string,
  password: string,
  iv: string,
  salt: string,
  options: EncryptionOptions = DEFAULT_ENCRYPTION_OPTIONS
): string {
  const saltBuffer = Buffer.from(salt, 'base64');
  const key = deriveKey(password, saltBuffer, options.keyLength);
  return decrypt(ciphertext, key, iv, options);
}

export function generateSecureToken(length: number = 32): string {
  return randomBytes(length).toString('base64url');
}

export function generateUUID(): string {
  return randomUUID();
}

export function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const saltBuffer = salt ? Buffer.from(salt, 'base64') : randomBytes(16);
  const hash = createHash('sha256').update(password).update(saltBuffer).digest('base64');
  return {
    hash,
    salt: saltBuffer.toString('base64'),
  };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const saltBuffer = Buffer.from(salt, 'base64');
  const computedHash = createHash('sha256').update(password).update(saltBuffer).digest('base64');
  return constantTimeCompare(computedHash, hash);
}
