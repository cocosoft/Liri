/**
 * 请求级身份（Principal）· 多租户 P0 阶段 1
 *
 * 锁住三条语义：
 *  ① `normalizePrincipal` 的回落：缺失 / 空白一律本地身份，**不编造租户**；
 *  ② `resolveEffectiveRole`：请求级角色优先、缺失回退进程级；两者皆空 ⇒ null
 *     （既有调用方不传请求级角色 ⇒ 与改造前完全一致 = 桌面端零行为变更）；
 *  ③ `principalToPermissionContext`：角色取 `roles[0]`，与 `PermissionContext.userRole` 对齐。
 */
import { describe, expect, it } from 'bun:test';

import {
  LOCAL_PRINCIPAL,
  LOCAL_TENANT_ID,
  LOCAL_USER_ID,
  normalizePrincipal,
  principalToPermissionContext,
  resolveEffectiveRole,
} from '../../src/core/identity/principal';

describe('Principal：规范化', () => {
  it('缺失 / null ⇒ 本地身份（不编造租户）', () => {
    expect(normalizePrincipal()).toEqual(LOCAL_PRINCIPAL);
    expect(normalizePrincipal(null)).toEqual(LOCAL_PRINCIPAL);
  });

  it('空白字段回落本地，非空字段保留', () => {
    const principal = normalizePrincipal({
      tenantId: '  ',
      userId: 'u-1',
      roles: ['  admin  ', '', '  '],
    });
    expect(principal.tenantId).toBe(LOCAL_TENANT_ID);
    expect(principal.userId).toBe('u-1');
    expect(principal.roles).toEqual(['admin']);
  });

  it('角色全空 ⇒ 回落为 [userId]（不出现无角色歧义态）', () => {
    const principal = normalizePrincipal({ userId: 'u-2', roles: [] });
    expect(principal.roles).toEqual(['u-2']);
  });

  it('本地身份的租户与用户常量一致', () => {
    expect(LOCAL_PRINCIPAL.tenantId).toBe(LOCAL_TENANT_ID);
    expect(LOCAL_PRINCIPAL.userId).toBe(LOCAL_USER_ID);
  });
});

describe('Principal：生效角色解析', () => {
  it('请求级角色优先于进程级', () => {
    expect(resolveEffectiveRole('request-admin', 'process-guest')).toBe(
      'request-admin'
    );
  });

  it('请求级缺失 / 空白 ⇒ 回退进程级（桌面端零行为变更）', () => {
    expect(resolveEffectiveRole(undefined, 'process-guest')).toBe(
      'process-guest'
    );
    expect(resolveEffectiveRole(null, 'process-guest')).toBe('process-guest');
    expect(resolveEffectiveRole('   ', 'process-guest')).toBe('process-guest');
  });

  it('两者皆空 ⇒ null（继续走 A 规则，不臆造角色）', () => {
    expect(resolveEffectiveRole(undefined, null)).toBeNull();
    expect(resolveEffectiveRole('', null)).toBeNull();
  });

  it('两个请求各自带角色 ⇒ 互不污染（并发隔离的纯函数前提）', () => {
    const a = resolveEffectiveRole('admin', 'process-role');
    const b = resolveEffectiveRole('guest', 'process-role');
    expect(a).toBe('admin');
    expect(b).toBe('guest');
  });
});

describe('Principal：映射到权限上下文', () => {
  it('userId 原样、userRole 取 roles[0]', () => {
    const mapped = principalToPermissionContext({
      tenantId: 'org-1',
      userId: 'u-9',
      roles: ['reviewer', 'viewer'],
    });
    expect(mapped).toEqual({ userId: 'u-9', userRole: 'reviewer' });
  });

  it('roles 为空数组（未经规范化）⇒ userRole 回落 userId', () => {
    const mapped = principalToPermissionContext({
      tenantId: 'org-1',
      userId: 'u-9',
      roles: [],
    });
    expect(mapped.userRole).toBe('u-9');
  });
});
