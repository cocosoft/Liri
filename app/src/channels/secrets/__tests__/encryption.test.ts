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
 * 渠道凭据加密工具测试（P0-4）
 */

import { describe, expect, it, beforeEach, afterAll } from 'bun:test';
import {
  encryptSecret,
  decryptSecret,
  isSensitiveKey,
  encryptOptions,
  decryptOptions,
} from '../encryption';

// 固定测试密钥（避免测试环境落盘真实密钥文件）
const TEST_KEY = 'a'.repeat(64); // 32 字节 hex
const TEST_KEY_ENV = 'CHANNEL_SECRET_KEY';

describe('encryption (P0-4)', () => {
  beforeEach(() => {
    process.env[TEST_KEY_ENV] = TEST_KEY;
  });

  afterAll(() => {
    // 清理测试密钥，避免残留污染同进程其他测试
    delete process.env[TEST_KEY_ENV];
  });

  it('加密→解密往返保持原值', () => {
    const plain = '123456:ABC-DEF-bot-token';
    const enc = encryptSecret(plain);
    expect(enc).not.toBe(plain);
    expect(enc.startsWith('enc:')).toBe(true);
    expect(decryptSecret(enc)).toBe(plain);
  });

  it('已加密值再次加密幂等', () => {
    const enc1 = encryptSecret('token-value');
    const enc2 = encryptSecret(enc1);
    expect(enc2).toBe(enc1);
  });

  it('未加密值解密原样返回（兼容存量明文）', () => {
    expect(decryptSecret('plain-text')).toBe('plain-text');
  });

  it('isSensitiveKey 判定常见凭据字段', () => {
    expect(isSensitiveKey('botToken')).toBe(true);
    expect(isSensitiveKey('appSecret')).toBe(true);
    expect(isSensitiveKey('corpSecret')).toBe(true);
    expect(isSensitiveKey('accessToken')).toBe(true);
    expect(isSensitiveKey('authToken')).toBe(true);
    expect(isSensitiveKey('clientSecret')).toBe(true);
    expect(isSensitiveKey('host')).toBe(false);
    expect(isSensitiveKey('server')).toBe(false);
    expect(isSensitiveKey('port')).toBe(false);
    expect(isSensitiveKey('nickname')).toBe(false);
  });

  it('encryptOptions 仅加密敏感字段', () => {
    const raw = { botToken: 't', host: 'smtp.example.com', port: 587 };
    const enc = encryptOptions(raw);
    expect((enc.botToken as string).startsWith('enc:')).toBe(true);
    expect(enc.host).toBe('smtp.example.com');
    expect(enc.port).toBe(587);
  });

  it('decryptOptions 还原全部字段', () => {
    const raw = { botToken: 't', host: 'smtp.example.com' };
    const dec = decryptOptions(encryptOptions(raw));
    expect(dec).toEqual(raw);
  });

  it('篡改密文解密失败抛出错误（fail-closed）', () => {
    const enc = encryptSecret('secret');
    const tampered = enc.slice(0, -2) + 'xx';
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('不同明文产生不同密文（随机 IV）', () => {
    const a = encryptSecret('same');
    const b = encryptSecret('same');
    expect(a).not.toBe(b);
  });
});
