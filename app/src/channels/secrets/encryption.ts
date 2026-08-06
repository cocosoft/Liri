// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 渠道凭据加密工具（P0-4，2026-08-06）
 *
 * AES-256-GCM 对称加密，用于渠道 token/secret/password 类字段落库前的保护。
 * 密钥来源（优先级）：
 *   1. 环境变量 `CHANNEL_SECRET_KEY`（hex 编码，64 字符 = 32 字节）
 *   2. 自动生成并持久化到 `~/.pyapp/data/channels/secret.key`（第二层数据目录）
 *
 * 密文格式：`enc:<iv(base64)>:<authTag(base64)>:<ciphertext(base64)>`
 * 解密失败时 fail-closed（抛错），不降级为明文。
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { resolveDataSubDir } from '@modules/core';

const ENC_PREFIX = 'enc:';

/** 密钥文件位置：~/.pyapp/data/channels/secret.key */
function getSecretKeyFile(): string {
  return join(resolveDataSubDir('channels'), 'secret.key');
}

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const fromEnv = process.env.CHANNEL_SECRET_KEY;
  if (fromEnv) {
    const key = Buffer.from(fromEnv, 'hex');
    if (key.length === 32) {
      cachedKey = key;
      return key;
    }
  }

  const file = getSecretKeyFile();
  if (existsSync(file)) {
    const key = Buffer.from(readFileSync(file, 'utf-8').trim(), 'hex');
    if (key.length === 32) {
      cachedKey = key;
      return key;
    }
  }

  const key = randomBytes(32);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, key.toString('hex'), { mode: 0o600 });
  cachedKey = key;
  return key;
}

/**
 * 判断字段名是否敏感（应加密）
 * 覆盖 token/secret/password/apiKey/appKey/corpSecret/botToken/accessToken/privateKey/authToken 等常见凭据字段名。
 */
export function isSensitiveKey(key: string): boolean {
  return /token|secret|password|passwd|api[-_]?key|private[-_]?key|auth[-_]?token/i.test(
    key
  );
}

/** 加密单个字符串（已加密值幂等跳过） */
export function encryptSecret(plain: string): string {
  if (plain.startsWith(ENC_PREFIX)) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${data.toString('base64')}`;
}

/** 解密单个字符串（未加密值原样返回） */
export function decryptSecret(value: string): string {
  if (!value.startsWith(ENC_PREFIX)) return value;
  const parts = value.slice(ENC_PREFIX.length).split(':');
  if (parts.length !== 3) return value;
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      getKey(),
      Buffer.from(parts[0], 'base64')
    );
    decipher.setAuthTag(Buffer.from(parts[1], 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(parts[2], 'base64')),
      decipher.final(),
    ]).toString('utf-8');
  } catch {
    // fail-closed：解密失败抛错，不降级为明文
    throw new Error('渠道凭据解密失败：密钥不匹配或密文损坏');
  }
}

/** 对象级加密（仅敏感字段） */
export function encryptOptions(
  raw: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k] =
      typeof v === 'string' && v.length > 0 && isSensitiveKey(k)
        ? encryptSecret(v)
        : v;
  }
  return out;
}

/** 对象级解密（逐字段尝试，非敏感字段原样） */
export function decryptOptions(
  raw: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k] = typeof v === 'string' ? decryptSecret(v) : v;
  }
  return out;
}
