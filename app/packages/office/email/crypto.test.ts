/**
 * crypto.ts 单元测试
 * 验证 AES-256-GCM 加解密往返、密钥持久化
 *
 * 2026-11-06 修复：此前用 `PYAPP_HOME` 做隔离，但 `resolvePyappHome()` 只认契约键
 * `LIRI_HOME`（`productEnvKey('HOME')`）⇒ 用例实际读写/生成的是**生产**密钥
 * `~/.pyapp/config/secret.key`。改用 `LIRI_HOME` 后真正落临时目录。
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const testHome = path.join(os.tmpdir(), 'pyapp-crypto-test-' + Date.now());
const HOME_KEY = 'LIRI_HOME';
let originalHome: string | undefined;

beforeEach(() => {
  // 清理测试密钥
  if (fs.existsSync(testHome)) fs.rmSync(testHome, { recursive: true });
  fs.mkdirSync(testHome, { recursive: true });
  originalHome = process.env[HOME_KEY];
  process.env[HOME_KEY] = testHome;
});

afterEach(() => {
  // 清理测试密钥
  if (fs.existsSync(testHome)) fs.rmSync(testHome, { recursive: true });
  if (originalHome === undefined) delete process.env[HOME_KEY];
  else process.env[HOME_KEY] = originalHome;
});

describe('crypto', () => {
  test('encryptPassword + decryptPassword 往返', async () => {
    const { encryptPassword, decryptPassword } = await import('./crypto');

    const plain = 'my-secret-password-123!';
    const cipher = encryptPassword(plain);
    expect(cipher).not.toBe(plain);
    expect(cipher.split(':')).toHaveLength(3);

    const decrypted = decryptPassword(cipher);
    expect(decrypted).toBe(plain);
  });

  test('每次加密生成不同密文（IV 随机）', async () => {
    const { encryptPassword, decryptPassword } = await import('./crypto');

    const plain = 'test-password';
    const c1 = encryptPassword(plain);
    const c2 = encryptPassword(plain);

    expect(c1).not.toBe(c2);
    expect(decryptPassword(c1)).toBe(plain);
    expect(decryptPassword(c2)).toBe(plain);
  });

  test('密钥持久化：第二次调用复用同一密钥', async () => {
    const mod1 = await import('./crypto');
    const cipher = mod1.encryptPassword('pwd');

    // 模拟模块重载（清除缓存）
    delete (require as any).cache[require.resolve('./crypto')];

    const mod2 = await import('./crypto');
    const decrypted = mod2.decryptPassword(cipher);
    expect(decrypted).toBe('pwd');
  });
});
