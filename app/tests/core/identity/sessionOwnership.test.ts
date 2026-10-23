/**
 * 会话归属判定（多租户 P1）
 *
 * 锁四件事：
 *  ① 本地身份 ⇒ 恒放行（桌面零行为变更，含历史无归属会话）；
 *  ② 已认证身份 + 同租户同用户 ⇒ 放行；
 *  ③ 已认证身份 + 无归属 ⇒ **拒绝**（fail-closed，远端身份不得读本机历史会话）；
 *  ④ 跨用户 / 跨租户 ⇒ 拒绝。
 */
import { describe, expect, it } from 'bun:test';

import {
  LOCAL_PRINCIPAL,
  type Principal,
} from '@modules/core/identity/principal';
import {
  canAccessSession,
  ownerOf,
  type SessionOwner,
} from '@modules/core/identity/sessionOwnership';

const ALICE: Principal = {
  tenantId: 'acme',
  userId: 'alice',
  roles: ['user'],
};
const BOB: Principal = {
  tenantId: 'acme',
  userId: 'bob',
  roles: ['user'],
};
const OTHER_TENANT: Principal = {
  tenantId: 'globex',
  userId: 'alice',
  roles: ['user'],
};

const ALICE_OWNER: SessionOwner = { tenantId: 'acme', userId: 'alice' };

describe('sessionOwnership：归属写入', () => {
  it('本地身份不写归属（桌面会话文件逐字不变）', () => {
    expect(ownerOf(LOCAL_PRINCIPAL)).toBeUndefined();
  });

  it('已认证身份 ⇒ { tenantId, userId }', () => {
    expect(ownerOf(ALICE)).toEqual(ALICE_OWNER);
  });
});

describe('sessionOwnership：访问判定', () => {
  it('本地身份恒放行（含无归属的历史会话）', () => {
    expect(canAccessSession(undefined, LOCAL_PRINCIPAL)).toBe(true);
    expect(canAccessSession(ALICE_OWNER, LOCAL_PRINCIPAL)).toBe(true);
  });

  it('同租户同用户 ⇒ 放行', () => {
    expect(canAccessSession(ALICE_OWNER, ALICE)).toBe(true);
  });

  it('同租户不同用户 ⇒ 拒绝', () => {
    expect(canAccessSession(ALICE_OWNER, BOB)).toBe(false);
  });

  it('跨租户（同用户名）⇒ 拒绝', () => {
    expect(canAccessSession(ALICE_OWNER, OTHER_TENANT)).toBe(false);
  });

  it('已认证身份遇到无归属会话 ⇒ 拒绝（fail-closed）', () => {
    expect(canAccessSession(undefined, ALICE)).toBe(false);
    expect(canAccessSession(null, ALICE)).toBe(false);
  });
});
