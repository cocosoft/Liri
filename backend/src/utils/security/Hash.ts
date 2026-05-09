//
/**
 * 哈希和签名工具
 * 基于CC源码实现
 */

import { createHash, createHmac, type BinaryLike } from 'crypto';

export function djb2Hash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}

export function hashContent(content: string): string {
  try {
    const hash = (globalThis as any).Bun.hash(content);
    return hash.toString();
  } catch {
    return createHash('sha256').update(content).digest('hex');
  }
}

export function hashPair(a: string, b: string): string {
  try {
    const hashA = (globalThis as any).Bun.hash(a);
    const hashB = (globalThis as any).Bun.hash(b, hashA);
    return hashB.toString();
  } catch {
    return createHash('sha256').update(a).update('\0').update(b).digest('hex');
  }
}

export function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function sha256Base64(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('base64');
}

export function sha256URLSafe(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('base64url');
}

export function sha512(data: string | Buffer): string {
  return createHash('sha512').update(data).digest('hex');
}

export function sha512Base64(data: string | Buffer): string {
  return createHash('sha512').update(data).digest('base64');
}

export function md5(data: string | Buffer): string {
  return createHash('md5').update(data).digest('hex');
}

export function createHMAC(
  algorithm: 'sha256' | 'sha512',
  data: string | Buffer,
  key: string | Buffer
): string {
  return createHmac(algorithm, key).update(data).digest('hex');
}

export function createHMACBase64(
  algorithm: 'sha256' | 'sha512',
  data: string | Buffer,
  key: string | Buffer
): string {
  return createHmac(algorithm, key).update(data).digest('base64');
}

export function verifyHMAC(
  algorithm: 'sha256' | 'sha512',
  data: string | Buffer,
  key: string | Buffer,
  signature: string
): boolean {
  const expected = createHMAC(algorithm, data, key);
  return constantTimeCompare(expected, signature);
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

export interface HashVerificationResult {
  valid: boolean;
  expected: string;
  actual: string;
}

export function verifyHash(
  data: string,
  expectedHash: string,
  algorithm: string = 'sha256'
): HashVerificationResult {
  let actualHash: string;

  switch (algorithm.toLowerCase()) {
    case 'sha256':
      actualHash = sha256(data);
      break;
    case 'sha512':
      actualHash = sha512(data);
      break;
    case 'md5':
      actualHash = md5(data);
      break;
    case 'content':
      actualHash = hashContent(data);
      break;
    default:
      actualHash = sha256(data);
  }

  return {
    valid: constantTimeCompare(actualHash, expectedHash),
    expected: expectedHash,
    actual: actualHash,
  };
}
