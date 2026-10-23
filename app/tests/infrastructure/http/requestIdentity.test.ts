/**
 * HTTP 请求身份解析 · 多租户 P0 阶段 2
 *
 * 锁四件事（**不改变既有鉴权语义**，只补身份）：
 *  ① 无 Authorization ⇒ 本地身份（回环信任基线）；
 *  ② 非 Bearer（x-api-key / Token …）⇒ 本地身份（共享密钥 = 机器级信任，不带用户）；
 *  ③ 有效 Bearer 登录 token ⇒ 该用户名 + 权限即角色；
 *  ④ 无效 Bearer ⇒ 本地身份（该请求已在入口被 401，这里不编造身份）。
 *
 * 另有 `withRequestIdentity` 的**接线级**用例：它是 HTTP 入口唯一调用点，
 * 若"解析 + 建立作用域"被摘开，本条即变红。
 */
import { describe, expect, it, afterEach } from 'bun:test';
import type http from 'http';

import {
  LOCAL_PRINCIPAL,
  LOCAL_TENANT_ID,
} from '@openliri/kernel/identity/principal';
import { getRequestPrincipal } from '@openliri/kernel/identity/requestScope';
import {
  resolveRequestPrincipal,
  withRequestIdentity,
} from '../../../src/infrastructure/http/requestIdentity';
import { authTokens } from '../../../src/infrastructure/http/handlers/auth-handlers';

function fakeReq(headers: Record<string, string> = {}): http.IncomingMessage {
  return { headers } as unknown as http.IncomingMessage;
}

afterEach(() => {
  authTokens.clear();
});

describe('resolveRequestPrincipal：身份解析', () => {
  it('无 Authorization ⇒ 本地身份', async () => {
    expect(await resolveRequestPrincipal(fakeReq())).toEqual(LOCAL_PRINCIPAL);
  });

  it('非 Bearer 形式 ⇒ 本地身份', async () => {
    expect(
      await resolveRequestPrincipal(fakeReq({ authorization: 'Token abc' }))
    ).toEqual(LOCAL_PRINCIPAL);
  });

  it('Bearer 空 token ⇒ 本地身份', async () => {
    expect(
      await resolveRequestPrincipal(fakeReq({ authorization: 'Bearer ' }))
    ).toEqual(LOCAL_PRINCIPAL);
  });

  it('有效 token ⇒ 用户名 + 由权限映射的角色（与进程级同源）', async () => {
    authTokens.set('tok-alice', {
      username: 'alice',
      permissions: ['read', 'write'],
    });
    const principal = await resolveRequestPrincipal(
      fakeReq({ authorization: 'Bearer tok-alice' })
    );
    expect(principal).toEqual({
      tenantId: LOCAL_TENANT_ID,
      userId: 'alice',
      roles: ['user'],
    });
  });

  it('admin 权限 ⇒ roles[0] 为 admin（与 applyAuthRoleToPermissionManager 一致）', async () => {
    authTokens.set('tok-root', {
      username: 'root',
      permissions: ['admin', 'read', 'write'],
    });
    const principal = await resolveRequestPrincipal(
      fakeReq({ authorization: 'Bearer tok-root' })
    );
    expect(principal.roles).toEqual(['admin']);
  });

  it('无效 token ⇒ 本地身份（不编造身份）', async () => {
    expect(
      await resolveRequestPrincipal(fakeReq({ authorization: 'Bearer nope' }))
    ).toEqual(LOCAL_PRINCIPAL);
  });
});

describe('withRequestIdentity：入口接线', () => {
  it('作用域内的下游读到该请求的身份', async () => {
    authTokens.set('tok-bob', { username: 'bob', permissions: ['admin'] });
    const seen = await withRequestIdentity(
      fakeReq({ authorization: 'Bearer tok-bob' }),
      async () => {
        await Promise.resolve();
        return getRequestPrincipal();
      }
    );
    expect(seen.userId).toBe('bob');
    expect(seen.roles).toEqual(['admin']);
    // 退出后恢复本地身份
    expect(getRequestPrincipal()).toEqual(LOCAL_PRINCIPAL);
  });

  it('无 token 的请求 ⇒ 作用域内仍是本地身份（桌面零行为变更）', async () => {
    const seen = await withRequestIdentity(fakeReq(), async () =>
      getRequestPrincipal()
    );
    expect(seen).toEqual(LOCAL_PRINCIPAL);
  });
});
