/**
 * PKCE加密工具
 * 基于RFC 7636标准实现
 */

import { createHash, randomBytes } from 'crypto';

/**
 * 生成code_verifier
 */
export function generateCodeVerifier(length: number = 128): string {
  const buffer = randomBytes(length);
  return base64UrlEncode(buffer).substring(0, length);
}

/**
 * 生成code_challenge
 */
export function generateCodeChallenge(codeVerifier: string): string {
  const hash = createHash('sha256').update(codeVerifier).digest();
  return base64UrlEncode(hash);
}

/**
 * 生成state参数
 */
export function generateState(length: number = 32): string {
  const buffer = randomBytes(length);
  return base64UrlEncode(buffer);
}

/**
 * Base64URL编码
 */
function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * 创建OAuth加密工具实例
 */
export function createOAuthCrypto() {
  return {
    generateCodeVerifier,
    generateCodeChallenge,
    generateState,
  };
}
