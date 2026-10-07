// MIT License
// Copyright (c) 2026 190615273@qq.com
/**
 * `verifyRequestAuth` —— 共享密钥校验（**常量时间比较**，R07-4②，2026-10-07）
 *
 * 锁四件事：
 *   ① **语义与旧实现等价**（相等 ⇒ true / 否则 false；头部优先级 `Authorization: Bearer` > `x-api-key`）；
 *   ② **长度不同的密钥不抛异常**（旧实现对原文 `timingSafeEqual` 会在长度不等时抛 ⇒ 本用例是回归守卫）；
 *   ③ 恒真边界保留：空密钥 vs 空 token ⇒ true（**旧行为**，未加严；A2A 侧由 `isA2AAuthorized`
 *      的 `if (!expected) return false` 另外兜住 ⇒ 不因本函数而放宽对外面）；
 *   ④ 大小写/尾随空白 ⇒ false（精确匹配，未变）。
 */
import { describe, it, expect } from 'bun:test';
import type http from 'http';

import { verifyRequestAuth } from '../../src/infrastructure/http/LocalHTTPServiceHelpers.js';

const SECRET = 'k'.repeat(43); // 与 spec §8.2 建议的 32 字节 base64url 长度同量级

function req(headers: Record<string, string>): http.IncomingMessage {
  return { headers } as unknown as http.IncomingMessage;
}

describe('verifyRequestAuth（常量时间比较）', () => {
  it('① x-api-key 正确 ⇒ true；错误 ⇒ false', () => {
    expect(verifyRequestAuth(req({ 'x-api-key': SECRET }), SECRET)).toBe(true);
    expect(verifyRequestAuth(req({ 'x-api-key': 'wrong' }), SECRET)).toBe(
      false
    );
  });

  it('① Authorization: Bearer 正确 ⇒ true（且优先于 x-api-key）', () => {
    expect(
      verifyRequestAuth(req({ authorization: `Bearer ${SECRET}` }), SECRET)
    ).toBe(true);
    expect(
      verifyRequestAuth(
        req({ authorization: `Bearer ${SECRET}`, 'x-api-key': 'wrong' }),
        SECRET
      )
    ).toBe(true);
  });

  it('① 无任何鉴权头 ⇒ false（密钥非空时）', () => {
    expect(verifyRequestAuth(req({}), SECRET)).toBe(false);
  });

  it('② 长度不同的密钥 ⇒ false 且**不抛异常**（回归守卫）', () => {
    expect(() =>
      verifyRequestAuth(req({ 'x-api-key': 'short' }), SECRET)
    ).not.toThrow();
    expect(verifyRequestAuth(req({ 'x-api-key': 'short' }), SECRET)).toBe(
      false
    );
    expect(
      verifyRequestAuth(req({ 'x-api-key': SECRET + 'extra' }), SECRET)
    ).toBe(false);
  });

  it('③ 空密钥 vs 空 token ⇒ true（**旧行为保留**，未加严）', () => {
    expect(verifyRequestAuth(req({}), '')).toBe(true);
  });

  it('④ 大小写 / 尾随空白 ⇒ false（精确匹配）', () => {
    expect(
      verifyRequestAuth(req({ 'x-api-key': SECRET.toUpperCase() }), SECRET)
    ).toBe(false);
    expect(verifyRequestAuth(req({ 'x-api-key': `${SECRET} ` }), SECRET)).toBe(
      false
    );
  });
});
