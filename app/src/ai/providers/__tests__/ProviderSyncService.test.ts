/**
 * ProviderSyncService — DB Provider → 运行时配置转换（D11 测试覆盖）
 *
 * 覆盖 recordToConfig 的凭据解析（D6 CredentialStore 集成）：
 * - CRED_STORED_MARKER 占位 → 从独立 CredentialStore 读取真实密钥
 * - 明文 key 直通
 * - headers 注入
 */

import { describe, expect, test, beforeEach } from 'bun:test';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync } from 'fs';
import { recordToConfig } from '../ProviderSyncService.js';
import {
  CRED_STORED_MARKER,
  credentialStore,
} from '../../credentials/CredentialStore.js';
import type { ProviderRecord } from '../ProviderManager.js';

describe('ProviderSyncService.recordToConfig 凭据解析', () => {
  beforeEach(() => {
    // 重定向凭据存储到临时目录，避免测试写入真实 ~/.pyapp/credentials.json
    const store = credentialStore as unknown as {
      cache: Map<string, string>;
      filePath: string;
      loaded: boolean;
    };
    store.cache = new Map();
    store.filePath = join(
      mkdtempSync(join(tmpdir(), 'cred-test-')),
      'credentials.json'
    );
    store.loaded = false;
  });

  test('占位标记（CRED_STORED_MARKER）→ 从 CredentialStore 读取真实密钥', () => {
    credentialStore.set('test-provider-a', 'sk-real-secret');
    const cfg = recordToConfig({
      id: 'test-provider-a',
      apiKey: CRED_STORED_MARKER,
      baseUrl: 'https://api.example.com',
    } as ProviderRecord);
    expect(cfg.apiKey).toBe('sk-real-secret');
  });

  test('占位标记但 CredentialStore 无记录 → 空串（不泄占位符）', () => {
    const cfg = recordToConfig({
      id: 'test-provider-a',
      apiKey: CRED_STORED_MARKER,
      baseUrl: 'https://api.example.com',
    } as ProviderRecord);
    expect(cfg.apiKey).toBe('');
  });

  test('明文 api_key → 直通', () => {
    const cfg = recordToConfig({
      id: 'p1',
      apiKey: 'sk-plain',
      baseUrl: 'https://api.example.com',
    } as ProviderRecord);
    expect(cfg.apiKey).toBe('sk-plain');
  });

  test('自定义 headers → 注入 config', () => {
    const cfg = recordToConfig({
      id: 'p1',
      apiKey: '',
      baseUrl: 'https://api.example.com',
      headers: { 'X-Custom': 'yes' },
    } as ProviderRecord);
    expect(cfg.headers).toEqual({ 'X-Custom': 'yes' });
  });

  test('无 headers → 不注入 headers 字段', () => {
    const cfg = recordToConfig({
      id: 'p1',
      apiKey: '',
      baseUrl: 'https://api.example.com',
    } as ProviderRecord);
    expect(cfg.headers).toBeUndefined();
  });
});
