/**
 * CredentialStore 凭据存储测试（P0 凭据迁移，2026-08-28）
 *
 * 对齐 dsh api-key.spec.ts：
 * 1. normalizeApiKey：trim / empty / illegalCharacters / 合法
 * 2. maskKey 脱敏：不泄露完整密钥
 * 3. CRED_STORED_MARKER 占位语义
 */

import { describe, test, expect } from 'bun:test';
import {
  normalizeApiKey,
  CredentialStore,
  CRED_STORED_MARKER,
} from '../CredentialStore.js';

describe('normalizeApiKey（对齐 dsh api-key）', () => {
  test('静默 trim 首尾空白', () => {
    const result = normalizeApiKey('  sk-abc123  ');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('sk-abc123');
  });

  test('空串/纯空白 → empty', () => {
    expect(normalizeApiKey('').ok).toBe(false);
    const blank = normalizeApiKey('   ');
    expect(blank.ok).toBe(false);
    if (!blank.ok) expect(blank.reason).toBe('empty');
  });

  test('含不可打印/非 ASCII 字符 → illegalCharacters', () => {
    const bad = normalizeApiKey('sk-abc\n123');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toBe('illegalCharacters');
    const cjk = normalizeApiKey('sk-密钥');
    expect(cjk.ok).toBe(false);
  });

  test('可打印 ASCII 合法', () => {
    const result = normalizeApiKey('sk-1234567890ABCDEF');
    expect(result.ok).toBe(true);
  });
});

describe('maskKey 脱敏', () => {
  test('空值返回空串', () => {
    expect(CredentialStore.maskKey('')).toBe('');
    expect(CredentialStore.maskKey(undefined as unknown as string)).toBe('');
  });

  test('短密钥全掩码，不泄露原文', () => {
    const mask = CredentialStore.maskKey('short');
    expect(mask).not.toContain('short');
    expect(mask).toContain('•');
  });

  test('长密钥保留首尾 4 位，中间掩码', () => {
    const mask = CredentialStore.maskKey('sk-1234567890ABCDEF');
    expect(mask.startsWith('sk-1')).toBe(true);
    expect(mask.endsWith('CDEF')).toBe(true);
    expect(mask).toContain('••••••••');
  });
});

describe('CRED_STORED_MARKER 占位语义', () => {
  test('占位标记不与真实密钥混淆', () => {
    // 真实密钥以 sk- 等开头，占位标记固定为 __stored__
    expect(CRED_STORED_MARKER).toBe('__stored__');
    expect(CRED_STORED_MARKER.startsWith('sk-')).toBe(false);
  });
});
