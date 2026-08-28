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
 * CredentialStore — 独立凭据存储（P0 凭据迁移，2026-08-28）
 *
 * API Key 不再明文存入 SQLite（ai_providers.api_key），改为独立文件
 * `~/.pyapp/credentials.json`（第三层用户数据，Git 不跟踪）。DB 仅存
 * `__stored__` 占位标记（见 CRED_STORED_MARKER），真实密钥只在此文件。
 *
 * 设计：
 * - 同步 API（内存缓存 + 写时落盘），避免异步竞态与调用方改造
 * - 单例，与 ProviderManager 一致
 * - 掩码工具 maskKey() 供 HTTP 层脱敏返回
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'fs';
import { dirname, join } from 'path';
import { resolvePyappHome } from '@modules/core/paths';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = getLogger('ai:credentials:store');

/** DB ai_providers.api_key 列的"已存凭据"占位标记（真实密钥在 CredentialStore） */
export const CRED_STORED_MARKER = '__stored__';

/** HTTP 请求头可安全携带的字符：可打印 ASCII（不含空格），与 dsh normalizeApiKey 对齐 */
const LEGAL_API_KEY = /^[\x21-\x7E]+$/;

/** API Key 校验结果 */
export type ApiKeyCheck =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly reason: 'empty' | 'illegalCharacters' };

/**
 * 校验规范化 API Key（P0 凭据迁移补齐，对齐 dsh api-key.ts）：
 * 静默 trim 首尾空白；空 → empty；含 HTTP 头无法携带的字符 → illegalCharacters。
 * 校验失败信息不含密钥本身（防泄密）。
 */
export function normalizeApiKey(raw: string): ApiKeyCheck {
  const value = raw.trim();
  if (value.length === 0) return { ok: false, reason: 'empty' };
  if (!LEGAL_API_KEY.test(value)) {
    return { ok: false, reason: 'illegalCharacters' };
  }
  return { ok: true, value };
}

/**
 * 凭据存储服务
 * key = ProviderRecord.id（DB UUID），value = API Key 明文
 */
export class CredentialStore {
  private static instance: CredentialStore;

  private cache = new Map<string, string>();
  private filePath: string;
  private loaded = false;

  private constructor() {
    this.filePath = join(resolvePyappHome(), 'credentials.json');
  }

  static getInstance(): CredentialStore {
    if (!CredentialStore.instance) {
      CredentialStore.instance = new CredentialStore();
    }
    return CredentialStore.instance;
  }

  /** 初始化：加载凭据文件（幂等，首次调用时执行） */
  initialize(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      if (!existsSync(this.filePath)) return;
      const raw = readFileSync(this.filePath, 'utf-8');
      const data = JSON.parse(raw) as Record<string, unknown>;
      for (const [key, value] of Object.entries(data)) {
        if (typeof value === 'string' && value.length > 0) {
          this.cache.set(key, value);
        }
      }
      logger.info(`凭据已加载: ${this.cache.size} 条`);
    } catch (err) {
      void handleError(err, {
        module: 'ai:credentials:store',
        action: 'load',
      });
    }
  }

  /** 获取凭据（同步；未初始化时自动加载） */
  get(providerId: string): string | undefined {
    this.initialize();
    return this.cache.get(providerId);
  }

  /** 是否已配置凭据 */
  has(providerId: string): boolean {
    this.initialize();
    return this.cache.has(providerId);
  }

  /** 设置凭据并落盘 */
  set(providerId: string, apiKey: string): void {
    this.initialize();
    this.cache.set(providerId, apiKey);
    this.persist();
  }

  /** 清除凭据并落盘 */
  unset(providerId: string): void {
    this.initialize();
    if (this.cache.delete(providerId)) {
      this.persist();
    }
  }

  /** 全部凭据 id 列表（仅内部/排查用） */
  list(): string[] {
    this.initialize();
    return [...this.cache.keys()];
  }

  /** 落盘（同步写，避免并发竞态） */
  private persist(): void {
    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(
        this.filePath,
        JSON.stringify(Object.fromEntries(this.cache), null, 2),
        'utf-8',
      );
      try {
        chmodSync(this.filePath, 0o600);
      } catch {
        // Windows 无 POSIX 权限位，忽略
      }
    } catch (err) {
      void handleError(err, {
        module: 'ai:credentials:store',
        action: 'persist',
      });
    }
  }

  /** 脱敏掩码：前 4 后 4，中间星号 */
  static maskKey(apiKey: string): string {
    if (!apiKey) return '';
    if (apiKey.length <= 8) return '••••••••';
    return `${apiKey.slice(0, 4)}••••••••${apiKey.slice(-4)}`;
  }
}

/** 导出单例 */
export const credentialStore = CredentialStore.getInstance();
