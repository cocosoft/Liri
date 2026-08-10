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
 * OAuth Provider 配置持久化存储（M3，方向① 运维入口）
 *
 * provider 配置（clientId/clientSecret/redirectUri/scopes/enabled）持久化到
 * ~/.pyapp/oauth/providers.json；clientSecret 使用 AES-256-GCM + PBKDF2(100k)
 * 加密（与 OAuthStorage token 加密同一方案），文件 0o600。
 * env provider（OAUTH_GITHUB_CLIENT_ID 等）为只读来源，与本地配置合并展示。
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  pbkdf2Sync,
} from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { resolvePyappHome } from '@modules/core';
import { configManager } from '@modules/config';
import { getLogger } from '@modules/monitoring';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

const logger = getLogger('oauth:providerStore');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const ITERATIONS = 100000;
const KEY_LENGTH = 32;
const PBKDF2_SALT = Buffer.from('pyapp-oauth-provider-salt-v1');

/** Provider 配置（对外展示形态，clientSecret 为明文仅内部解密后使用） */
export interface OAuthProviderInfo {
  id: string;
  name: string;
  clientId: string;
  hasClientSecret: boolean;
  redirectUri?: string;
  scopes?: string[];
  enabled: boolean;
  /** 来源：env = 环境变量（只读），configured = 本地持久化（可写） */
  source: 'env' | 'configured';
  updatedAt?: number;
}

/** 落盘形态（clientSecret 加密为 iv+authTag+ciphertext 的 base64） */
interface StoredProvider {
  id: string;
  name: string;
  clientId: string;
  clientSecretEnc: string;
  redirectUri?: string;
  scopes?: string[];
  enabled: boolean;
  updatedAt: number;
}

/** env provider 定义（与 cli/authHandler.ts 一致） */
const ENV_PROVIDERS: Array<{
  id: string;
  name: string;
  envId: string;
  envSecret: string;
  envRedirect: string;
  scopes: string[];
}> = [
  {
    id: 'github',
    name: 'GitHub',
    envId: 'OAUTH_GITHUB_CLIENT_ID',
    envSecret: 'OAUTH_GITHUB_CLIENT_SECRET',
    envRedirect: 'OAUTH_GITHUB_REDIRECT_URI',
    scopes: ['user:email', 'repo'],
  },
  {
    id: 'google',
    name: 'Google',
    envId: 'OAUTH_GOOGLE_CLIENT_ID',
    envSecret: 'OAUTH_GOOGLE_CLIENT_SECRET',
    envRedirect: 'OAUTH_GOOGLE_REDIRECT_URI',
    scopes: ['openid', 'email', 'profile'],
  },
];

/**
 * OAuth Provider 配置存储
 */
export class OAuthProviderStore {
  private readonly filePath: string;

  constructor(filePath?: string) {
    this.filePath =
      filePath ?? join(resolvePyappHome(), 'oauth', 'providers.json');
  }

  // ─── 加密层（与 OAuthStorage token 加密同一方案）──────────────

  private getEncryptionKey(): Buffer {
    const envKey = configManager.env('OAUTH_ENCRYPTION_KEY');
    if (!envKey) {
      throw new AppError(
        'OAUTH_ENCRYPTION_KEY 环境变量未配置，OAuth Provider clientSecret 加密存储无法初始化',
        ErrorCategory.EXECUTION,
        ErrorSeverity.CRITICAL,
        'OAUTH_ENCRYPTION_KEY_MISSING'
      );
    }
    if (envKey.length < 32) {
      throw new AppError(
        'OAUTH_ENCRYPTION_KEY 长度不足 32 字符',
        ErrorCategory.EXECUTION,
        ErrorSeverity.CRITICAL,
        'OAUTH_ENCRYPTION_KEY_TOO_SHORT'
      );
    }
    return pbkdf2Sync(envKey, PBKDF2_SALT, ITERATIONS, KEY_LENGTH, 'sha256');
  }

  private encryptSecret(plaintext: string): string {
    const key = this.getEncryptionKey();
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, encrypted]).toString('base64');
  }

  private decryptSecret(encoded: string): string {
    const key = this.getEncryptionKey();
    const data = Buffer.from(encoded, 'base64');
    const iv = data.subarray(0, IV_LENGTH);
    const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  }

  // ─── 读写 ───────────────────────────────────────────────────

  private readStored(): StoredProvider[] {
    try {
      if (!existsSync(this.filePath)) return [];
      const data = JSON.parse(readFileSync(this.filePath, 'utf8')) as
        | StoredProvider[]
        | null;
      return Array.isArray(data) ? data : [];
    } catch (error) {
      logger.warn('读取 OAuth provider 配置失败，视为空', {
        error: String(error),
      });
      return [];
    }
  }

  private writeStored(providers: StoredProvider[]): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(providers, null, 2), {
      mode: 0o600,
    });
  }

  /**
   * 合并 env + 持久化 provider 列表（clientSecret 不返回明文）
   */
  listProviders(): OAuthProviderInfo[] {
    const stored = new Map(this.readStored().map((p) => [p.id, p]));
    const result: OAuthProviderInfo[] = [];

    // env provider（只读，优先展示）
    for (const def of ENV_PROVIDERS) {
      const clientId = configManager.env(def.envId);
      if (clientId) {
        result.push({
          id: def.id,
          name: def.name,
          clientId,
          hasClientSecret: !!configManager.env(def.envSecret),
          redirectUri: configManager.env(def.envRedirect) || undefined,
          scopes: def.scopes,
          enabled: true,
          source: 'env',
        });
        stored.delete(def.id);
      }
    }

    // 持久化 provider（可写）
    for (const p of stored.values()) {
      result.push({
        id: p.id,
        name: p.name,
        clientId: p.clientId,
        hasClientSecret: !!p.clientSecretEnc,
        redirectUri: p.redirectUri,
        scopes: p.scopes,
        enabled: p.enabled,
        source: 'configured',
        updatedAt: p.updatedAt,
      });
    }

    return result;
  }

  /**
   * 更新持久化 provider（clientSecret 加密落盘，0o600）
   * @param id provider id
   * @param patch { clientId?, clientSecret?, redirectUri?, scopes?, enabled? }
   */
  updateProvider(
    id: string,
    patch: {
      clientId?: string;
      clientSecret?: string;
      redirectUri?: string;
      scopes?: string[];
      enabled?: boolean;
    }
  ): OAuthProviderInfo {
    if (!id || !patch) {
      throw new AppError(
        'provider id 与更新内容必填',
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        'OAUTH_PROVIDER_UPDATE_INVALID'
      );
    }

    const stored = this.readStored();
    const existing = stored.find((p) => p.id === id);
    const next: StoredProvider = {
      id,
      name: existing?.name ?? id,
      clientId: patch.clientId ?? existing?.clientId ?? '',
      clientSecretEnc:
        patch.clientSecret !== undefined
          ? this.encryptSecret(patch.clientSecret)
          : (existing?.clientSecretEnc ?? ''),
      redirectUri: patch.redirectUri ?? existing?.redirectUri,
      scopes: patch.scopes ?? existing?.scopes,
      enabled: patch.enabled ?? existing?.enabled ?? true,
      updatedAt: Date.now(),
    };

    const idx = stored.findIndex((p) => p.id === id);
    if (idx !== -1) stored[idx] = next;
    else stored.push(next);
    this.writeStored(stored);
    logger.info('oauth:providerUpdated', { id });

    return {
      id,
      name: next.name,
      clientId: next.clientId,
      hasClientSecret: !!next.clientSecretEnc,
      redirectUri: next.redirectUri,
      scopes: next.scopes,
      enabled: next.enabled,
      source: 'configured',
      updatedAt: next.updatedAt,
    };
  }
}

/**
 * 创建 OAuth Provider 配置存储实例（唯一工厂）
 */
export function createOAuthProviderStore(
  filePath?: string
): OAuthProviderStore {
  return new OAuthProviderStore(filePath);
}
