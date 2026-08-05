/**
 * M3 OAuth Provider 配置存储单测（§4.4 clientSecret 加密落盘）
 *
 * 覆盖：clientSecret AES-256-GCM 加密落盘（0o600）、明文不落盘、
 * listProviders 不返回明文（hasClientSecret 标记）、env provider 只读合并
 */

import { describe, expect, it, afterAll } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOAuthProviderStore } from '../OAuthProviderStore';

const tmpDirs: string[] = [];

afterAll(() => {
  for (const dir of tmpDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // 忽略清理失败
    }
  }
});

describe('OAuthProviderStore（clientSecret 加密存储）', () => {
  it('clientSecret 加密落盘，明文不落盘不返回', () => {
    const prevKey = process.env.OAUTH_ENCRYPTION_KEY;
    process.env.OAUTH_ENCRYPTION_KEY =
      'test-key-1234567890abcdef1234567890abcdef';

    const tmpDir = mkdtempSync(join(tmpdir(), 'oauth-test-'));
    tmpDirs.push(tmpDir);
    const filePath = join(tmpDir, 'providers.json');
    try {
      const store = createOAuthProviderStore(filePath);
      store.updateProvider('github', {
        clientId: 'cid-123',
        clientSecret: 'super-secret-value',
        scopes: ['user:email'],
        enabled: true,
      });

      // 落盘文件不含明文
      const raw = readFileSync(filePath, 'utf8');
      expect(raw).not.toContain('super-secret-value');
      expect(raw).toContain('clientSecretEnc');

      // 列表返回不含明文，hasClientSecret 标记存在
      const list = store.listProviders();
      const github = list.find((p) => p.id === 'github');
      expect(github).toBeDefined();
      expect(github!.hasClientSecret).toBe(true);
      expect(github!.clientId).toBe('cid-123');
      expect(JSON.stringify(list)).not.toContain('super-secret-value');

      // 更新不传 clientSecret 时保留原加密值
      store.updateProvider('github', { enabled: false });
      const after = store.listProviders().find((p) => p.id === 'github');
      expect(after!.enabled).toBe(false);
      expect(after!.hasClientSecret).toBe(true);
    } finally {
      if (prevKey === undefined) delete process.env.OAUTH_ENCRYPTION_KEY;
      else process.env.OAUTH_ENCRYPTION_KEY = prevKey;
    }
  });

  it('未配置 OAUTH_ENCRYPTION_KEY 时更新抛错（fail-closed）', () => {
    const prevKey = process.env.OAUTH_ENCRYPTION_KEY;
    delete process.env.OAUTH_ENCRYPTION_KEY;

    const tmpDir = mkdtempSync(join(tmpdir(), 'oauth-test-'));
    tmpDirs.push(tmpDir);
    try {
      const store = createOAuthProviderStore(join(tmpDir, 'providers.json'));
      expect(() =>
        store.updateProvider('github', {
          clientId: 'c',
          clientSecret: 's',
        })
      ).toThrow();
    } finally {
      if (prevKey !== undefined) process.env.OAUTH_ENCRYPTION_KEY = prevKey;
    }
  });

  it('env provider 只读合并展示（clientId 来自环境变量）', () => {
    const prevId = process.env.OAUTH_GITHUB_CLIENT_ID;
    process.env.OAUTH_GITHUB_CLIENT_ID = 'env-cid';
    const tmpDir = mkdtempSync(join(tmpdir(), 'oauth-test-'));
    tmpDirs.push(tmpDir);
    try {
      const store = createOAuthProviderStore(join(tmpDir, 'providers.json'));
      const list = store.listProviders();
      const github = list.find((p) => p.id === 'github');
      expect(github).toBeDefined();
      expect(github!.source).toBe('env');
      expect(github!.clientId).toBe('env-cid');
    } finally {
      if (prevId === undefined) delete process.env.OAUTH_GITHUB_CLIENT_ID;
      else process.env.OAUTH_GITHUB_CLIENT_ID = prevId;
    }
  });
});
