/**
 * 安全存储工具
 *
 * 提供加密文件存储能力，基于 security/Crypto.ts 的加密实现。
 * 用于安全存储敏感配置和凭据。
 */
import { readFile, writeFile, mkdir } from 'fs/promises';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { randomBytes } from 'crypto';
import { resolvePyappHome } from '@modules/core/paths';
import {
  encrypt,
  decrypt,
  generateEncryptionKey,
  ENCRYPTION_ALGORITHMS,
} from '@modules/security';

const STORAGE_DIR = join(resolvePyappHome(), 'secure');
const MASTER_KEY_FILE = join(STORAGE_DIR, '.master_key');

function getOrCreateMasterKey(): Buffer {
  try {
    if (existsSync(MASTER_KEY_FILE)) {
      const keyData = readFileSync(MASTER_KEY_FILE, 'utf-8');
      return Buffer.from(keyData.trim(), 'hex');
    }
  } catch {
    // 读取失败则创建新密钥
  }

  const key = generateEncryptionKey(32);
  const dir = dirname(MASTER_KEY_FILE);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(MASTER_KEY_FILE, key.toString('hex'), 'utf-8');
  return key;
}

const masterKey = getOrCreateMasterKey();

export async function secureSave(key: string, value: string): Promise<void> {
  const salt = randomBytes(16);

  const encrypted = encrypt(value, masterKey, {
    algorithm: ENCRYPTION_ALGORITHMS.AES_256_CBC,
    keyLength: 32,
    ivLength: 16,
  });

  const payload = JSON.stringify({
    salt: salt.toString('hex'),
    iv: encrypted.iv,
    data: encrypted.ciphertext,
  });

  const filePath = join(STORAGE_DIR, `${key}.json`);
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  await writeFile(filePath, payload, 'utf-8');
}

export async function secureLoad(key: string): Promise<string | null> {
  const filePath = join(STORAGE_DIR, `${key}.json`);

  try {
    if (!existsSync(filePath)) return null;

    const data = await readFile(filePath, 'utf-8');
    const payload = JSON.parse(data);

    const decrypted = decrypt(payload.data, masterKey, payload.iv, {
      algorithm: ENCRYPTION_ALGORITHMS.AES_256_CBC,
      keyLength: 32,
      ivLength: 16,
    });

    return decrypted;
  } catch {
    return null;
  }
}

export async function secureDelete(key: string): Promise<void> {
  const filePath = join(STORAGE_DIR, `${key}.json`);
  try {
    if (existsSync(filePath)) {
      await writeFile(filePath, '', 'utf-8');
    }
  } catch {
    // 删除失败时静默处理
  }
}
