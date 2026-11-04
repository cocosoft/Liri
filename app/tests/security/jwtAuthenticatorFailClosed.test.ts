// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * A5 安全基线：JWT 认证 **fail-closed** + 仅接受 HS256 验签。
 *
 * 背景（真机取证，2026-11-04）：`JwtAuthenticator.authenticate` 原实现
 * 「未配置 LIRI_JWT_SECRET 时跳过签名校验、直接信任 payload」——
 * 任意人构造 `header.payload.signature` 且 payload 写 `{"sub":"admin","roles":["admin"]}`
 * 即可通过认证。本用例是该行为的回归守卫。
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createHmac } from 'crypto';
import {
  JwtAuthenticator,
  type AuthCredentials,
} from '@openliri/infra/config/enterprise/auth';

const SECRET = 'test-secret-for-jwt-verification';

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

function makeToken(
  payload: Record<string, unknown>,
  opts: { alg?: string; secret?: string; tamperSignature?: boolean } = {}
): string {
  const header = b64url(
    JSON.stringify({ alg: opts.alg ?? 'HS256', typ: 'JWT' })
  );
  const body = b64url(JSON.stringify(payload));
  const signingInput = `${header}.${body}`;
  const signature =
    opts.alg === 'none'
      ? ''
      : createHmac('sha256', opts.secret ?? SECRET)
          .update(signingInput)
          .digest('base64url');
  const finalSig = opts.tamperSignature
    ? `${signature.slice(0, -2)}xx`
    : signature;
  return opts.alg === 'none'
    ? `${header}.${body}.`
    : `${signingInput}.${finalSig}`;
}

function creds(jwtToken: string): AuthCredentials {
  return { jwtToken };
}

const ADMIN_PAYLOAD = { sub: 'attacker', roles: ['admin'], tenant: 'default' };

describe('A5：JwtAuthenticator 安全基线', () => {
  const original = process.env['LIRI_JWT_SECRET'];

  beforeEach(() => {
    delete process.env['LIRI_JWT_SECRET'];
  });

  afterEach(() => {
    if (original === undefined) delete process.env['LIRI_JWT_SECRET'];
    else process.env['LIRI_JWT_SECRET'] = original;
  });

  it('未配置 LIRI_JWT_SECRET ⇒ 拒绝（fail-closed，不再跳过验签）', async () => {
    const token = makeToken(ADMIN_PAYLOAD, { secret: 'whatever' });
    expect(await new JwtAuthenticator().authenticate(creds(token))).toBeNull();
  });

  it('密钥正确且签名有效 ⇒ 认证通过并带出 payload 身份', async () => {
    process.env['LIRI_JWT_SECRET'] = SECRET;
    const token = makeToken({ sub: 'alice', roles: ['user'], tenant: 't1' });
    const result = await new JwtAuthenticator().authenticate(creds(token));
    expect(result?.authenticated).toBe(true);
    expect(result?.userId).toBe('alice');
    expect(result?.roles).toEqual(['user']);
    expect(result?.tenant).toBe('t1');
  });

  it('签名被篡改 ⇒ 拒绝', async () => {
    process.env['LIRI_JWT_SECRET'] = SECRET;
    const token = makeToken(ADMIN_PAYLOAD, { tamperSignature: true });
    expect(await new JwtAuthenticator().authenticate(creds(token))).toBeNull();
  });

  it('用错密钥签名 ⇒ 拒绝', async () => {
    process.env['LIRI_JWT_SECRET'] = SECRET;
    const token = makeToken(ADMIN_PAYLOAD, { secret: 'another-secret' });
    expect(await new JwtAuthenticator().authenticate(creds(token))).toBeNull();
  });

  it('alg=none ⇒ 拒绝（算法混淆/空签名绕过）', async () => {
    process.env['LIRI_JWT_SECRET'] = SECRET;
    const token = makeToken(ADMIN_PAYLOAD, { alg: 'none' });
    expect(await new JwtAuthenticator().authenticate(creds(token))).toBeNull();
  });

  it('非 HS256 算法 ⇒ 拒绝（只认 HS256）', async () => {
    process.env['LIRI_JWT_SECRET'] = SECRET;
    const token = makeToken(ADMIN_PAYLOAD, { alg: 'HS512' });
    expect(await new JwtAuthenticator().authenticate(creds(token))).toBeNull();
  });
});
