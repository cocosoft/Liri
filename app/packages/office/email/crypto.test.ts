/**
 * crypto.ts 单元测试
 * 验证 AES-256-GCM 加解密往返、密钥持久化
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const testHome = path.join(os.tmpdir(), 'pyapp-crypto-test-' + Date.now());
const configDir = path.join(testHome, 'config');
const keyPath = path.join(configDir, 'secret.key');

beforeEach(() => {
  // 清理测试密钥
  if (fs.existsSync(testHome)) fs.rmSync(testHome, { recursive: true });
  fs.mkdirSync(testHome, { recursive: true });
});

afterEach(() => {
  // 清理测试密钥
  if (fs.existsSync(testHome)) fs.rmSync(testHome, { recursive: true });
});

describe('crypto', () => {
  test('encryptPassword + decryptPassword 往返', async () => {
    // 模拟 resolvePyappHome 返回测试目录
    const originalEnv = process.env['PYAPP_HOME'];
    process.env['PYAPP_HOME'] = testHome;

    try {
      const { encryptPassword, decryptPassword } = await import('./crypto');

      const plain = 'my-secret-password-123!';
      const cipher = encryptPassword(plain);
      expect(cipher).not.toBe(plain);
      expect(cipher.split(':')).toHaveLength(3);

      const decrypted = decryptPassword(cipher);
      expect(decrypted).toBe(plain);
    } finally {
      if (originalEnv) process.env['PYAPP_HOME'] = originalEnv;
      else delete process.env['PYAPP_HOME'];
    }
  });

  test('每次加密生成不同密文（IV 随机）', async () => {
    const originalEnv = process.env['PYAPP_HOME'];
    process.env['PYAPP_HOME'] = testHome;

    try {
      const { encryptPassword, decryptPassword } = await import('./crypto');

      const plain = 'test-password';
      const c1 = encryptPassword(plain);
      const c2 = encryptPassword(plain);

      expect(c1).not.toBe(c2);
      expect(decryptPassword(c1)).toBe(plain);
      expect(decryptPassword(c2)).toBe(plain);
    } finally {
      if (originalEnv) process.env['PYAPP_HOME'] = originalEnv;
      else delete process.env['PYAPP_HOME'];
    }
  });

  test('密钥持久化：第二次调用复用同一密钥', async () => {
    const originalEnv = process.env['PYAPP_HOME'];
    process.env['PYAPP_HOME'] = testHome;

    try {
      const mod1 = await import('./crypto');
      const cipher = mod1.encryptPassword('pwd');

      // 模拟模块重载（清除缓存）
      delete (require as any).cache[require.resolve('./crypto')];

      const mod2 = await import('./crypto');
      const decrypted = mod2.decryptPassword(cipher);
      expect(decrypted).toBe('pwd');
    } finally {
      if (originalEnv) process.env['PYAPP_HOME'] = originalEnv;
      else delete process.env['PYAPP_HOME'];
    }
  });
});
