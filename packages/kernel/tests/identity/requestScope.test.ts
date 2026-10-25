/**
 * RequestScope · 请求级身份作用域（多租户 P0 阶段 2）
 *
 * 锁五件事：
 *  ① 不在作用域内 ⇒ `LOCAL_PRINCIPAL`（CLI / REPL / cron / 后台任务 / 单测默认路径）；
 *  ② `runWithPrincipal` 内（含 await 之后）读到的是该身份；
 *  ③ 并发两个身份**互不串**（这正是"进程级单值"做不到的）；
 *  ④ 嵌套调用内层覆盖、外层恢复；
 *  ⑤ 权限角色：本地身份 ⇒ `null`（桌面零行为变更），已认证 ⇒ `roles[0]`。
 */
import { describe, expect, it } from 'bun:test';

import {
  LOCAL_PRINCIPAL,
  type Principal,
} from '@openliri/kernel/identity/principal';
import {
  getRequestPermissionRole,
  getRequestPrincipal,
  getRequestPrincipalKey,
  isLocalPrincipal,
  principalKeyOf,
  runWithPrincipal,
} from '@openliri/kernel/identity/requestScope';

const ALICE: Principal = {
  tenantId: 'acme',
  userId: 'alice',
  roles: ['auditor', 'read'],
};
const BOB: Principal = {
  tenantId: 'acme',
  userId: 'bob',
  roles: ['admin', 'read', 'write'],
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('RequestScope：默认身份', () => {
  it('不在作用域内 ⇒ 本地身份（不臆造租户/用户）', () => {
    expect(getRequestPrincipal()).toEqual(LOCAL_PRINCIPAL);
    expect(isLocalPrincipal()).toBe(true);
    expect(getRequestPermissionRole()).toBeNull();
  });

  it('分桶键为 <tenantId>:<userId>', () => {
    expect(principalKeyOf(ALICE)).toBe('acme:alice');
    expect(getRequestPrincipalKey()).toBe('local:local');
  });
});

describe('RequestScope：作用域传递', () => {
  it('作用域内（await 之后）读到该身份', async () => {
    const seen = await runWithPrincipal(ALICE, async () => {
      await sleep(5);
      return getRequestPrincipal();
    });
    expect(seen).toEqual(ALICE);
    // 作用域退出后恢复本地身份
    expect(getRequestPrincipal()).toEqual(LOCAL_PRINCIPAL);
  });

  it('并发两个身份互不串（进程级单值做不到）', async () => {
    const [a, b] = await Promise.all([
      runWithPrincipal(ALICE, async () => {
        await sleep(8);
        return getRequestPrincipal();
      }),
      runWithPrincipal(BOB, async () => {
        await sleep(2);
        return getRequestPrincipal();
      }),
    ]);
    expect(a).toEqual(ALICE);
    expect(b).toEqual(BOB);
  });

  it('嵌套：内层覆盖、外层恢复', () => {
    const outer = runWithPrincipal(ALICE, () => {
      const inner = runWithPrincipal(BOB, () => getRequestPrincipal());
      return { inner, after: getRequestPrincipal() };
    });
    expect(outer.inner).toEqual(BOB);
    expect(outer.after).toEqual(ALICE);
  });
});

describe('RequestScope：权限角色映射', () => {
  it('已认证身份 ⇒ roles[0]（主角色）', () => {
    expect(runWithPrincipal(ALICE, () => getRequestPermissionRole())).toBe(
      'auditor'
    );
  });

  it('空角色数组 ⇒ null（规范化后不会出现，仍不臆造）', () => {
    const noRoles: Principal = {
      tenantId: 'acme',
      userId: 'nobody',
      roles: [],
    };
    expect(runWithPrincipal(noRoles, () => getRequestPermissionRole())).toBe(
      null
    );
  });

  it('本地身份 ⇒ null（不把 local 当权限角色回灌）', () => {
    expect(
      runWithPrincipal(LOCAL_PRINCIPAL, () => getRequestPermissionRole())
    ).toBeNull();
  });
});
