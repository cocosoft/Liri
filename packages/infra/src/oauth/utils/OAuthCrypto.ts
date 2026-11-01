/**
 * OAuth **加密工具与参数**
 *
 * - **PKCE**（RFC 7636）：`code_verifier` / `code_challenge` / `state`
 * - **AES-256-GCM 对称加密参数**（硬编码治理「同名常量」B2b 收口）：原于
 *   `OAuthProviderStore.ts` 与 `services/OAuthStorage.ts` **各写一份**同名常量 ⇒ 统一由此导出。
 *
 * ⚠️ 只收敛**参数常量**（同值同义 ⇒ 零行为变化）；两处的**加/解密实现有意不合并** ——
 * PBKDF2 **盐不同**（`pyapp-oauth-salt-v2` vs `pyapp-oauth-provider-salt-v1`）、派生方式不同
 * （回调式 `pbkdf2` vs `pbkdf2Sync`）、密文编码不同 ⇒ 合并会**破坏存量密文解密（不可逆）**。
 */

import { createHash, randomBytes } from 'crypto';

/** AES-256-GCM 算法名 */
export const OAUTH_CIPHER_ALGORITHM = 'aes-256-gcm';
/** GCM 初始向量长度（字节） */
export const OAUTH_CIPHER_IV_LENGTH = 16;
/** GCM 认证标签长度（字节） */
export const OAUTH_CIPHER_AUTH_TAG_LENGTH = 16;
/** 派生密钥长度（字节 ⇒ AES-256） */
export const OAUTH_CIPHER_KEY_LENGTH = 32;
/** PBKDF2 迭代次数 */
export const OAUTH_PBKDF2_ITERATIONS = 100000;

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
