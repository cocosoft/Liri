/**
 * 多租户 P3：定时任务归属
 *
 * 锁四件事：
 *  ① 创建归属键：本地身份**不写**（`undefined`），已认证身份写 `<tenantId>:<userId>`；
 *  ② 读写判定 fail-closed：本地身份恒放行；已认证身份必须全等，无归属 ⇒ 拒绝；
 *  ③ 键 → `Principal` 的逆运算（含 userId 带冒号、非法键）；
 *  ④ 调度器经 `runInCronOwnerScope` 重建作用域（无归属 ⇒ 不加作用域，零变更）。
 */
import { describe, expect, it } from 'bun:test';

import type { Principal } from '@modules/core/identity/principal';
import {
  getRequestPrincipal,
  isLocalPrincipal,
  runWithPrincipal,
} from '@modules/core/identity/requestScope';
import {
  canAccessCronJob,
  currentCronOwnerKey,
  runInCronOwnerScope,
} from '../../src/tasks/cron/cronOwnership';

const ALICE: Principal = { tenantId: 'acme', userId: 'alice', roles: ['user'] };
const BOB: Principal = { tenantId: 'acme', userId: 'bob', roles: ['user'] };

describe('定时任务归属（P3）', () => {
  it('归属键：本地身份不写，已认证身份写 principalKey', () => {
    expect(currentCronOwnerKey()).toBeUndefined();
    expect(runWithPrincipal(ALICE, () => currentCronOwnerKey())).toBe(
      'acme:alice'
    );
  });

  it('读写判定：本地恒放行；已认证只认自己的；无归属一律拒绝', () => {
    const aliceJob = { ownerKey: 'acme:alice' };
    const unowned = {};

    // 本地身份（桌面 / CLI / 后台）⇒ 与改造前一致，看得到全部
    expect(canAccessCronJob(aliceJob)).toBe(true);
    expect(canAccessCronJob(unowned)).toBe(true);

    // 已认证身份
    expect(runWithPrincipal(ALICE, () => canAccessCronJob(aliceJob))).toBe(
      true
    );
    expect(runWithPrincipal(BOB, () => canAccessCronJob(aliceJob))).toBe(false);
    // fail-closed：无归属（历史数据 / 本机创建）不得被远端身份操作
    expect(runWithPrincipal(ALICE, () => canAccessCronJob(unowned))).toBe(
      false
    );
    expect(runWithPrincipal(ALICE, () => canAccessCronJob(null))).toBe(false);
  });

  it('调度执行：按归属重建作用域（含 userId 带冒号），无归属保持本地', () => {
    const seen: string[] = [];

    runInCronOwnerScope({ ownerKey: 'acme:alice' }, () => {
      seen.push(
        `${getRequestPrincipal().tenantId}:${getRequestPrincipal().userId}`
      );
    });
    runInCronOwnerScope({ ownerKey: 'acme:team:dev' }, () => {
      seen.push(
        `${getRequestPrincipal().tenantId}:${getRequestPrincipal().userId}`
      );
    });
    runInCronOwnerScope({}, () => {
      seen.push(String(isLocalPrincipal()));
    });
    runInCronOwnerScope({ ownerKey: 'broken' }, () => {
      seen.push(String(isLocalPrincipal()));
    });

    expect(seen).toEqual(['acme:alice', 'acme:team:dev', 'true', 'true']);
  });
});
