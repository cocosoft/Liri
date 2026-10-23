/**
 * 多租户 P3：危险命令放行记录的归属隔离
 *
 * 锁五件事：
 *  ① 本地（无归属）记录：本地身份可复用，**远端身份一律不可**（fail-closed）；
 *  ② 租户记录：本人可复用、其他租户不可、本地身份恒可（单用户基线）；
 *  ③ 命令名级放行（`isCommandNameApproved`）同样按归属过滤；
 *  ④ 越权读（`getApprovalEntry`）与"不存在"同一结果；
 *  ⑤ `clearSession` 只清当前身份可见的记录，不误删他人。
 */
import { describe, expect, it } from 'bun:test';

import { ApprovedCommandRegistry } from '../../src/permission/ApprovedCommandRegistry';
import type { Principal } from '@openliri/kernel/identity/principal';
import { runWithPrincipal } from '@openliri/kernel/identity/requestScope';

const ALICE: Principal = { tenantId: 'acme', userId: 'alice', roles: ['user'] };
const BOB: Principal = { tenantId: 'acme', userId: 'bob', roles: ['user'] };

function makeRegistry(): ApprovedCommandRegistry {
  // 关闭自动清理定时器（测试隔离）
  return new ApprovedCommandRegistry(60_000, false);
}

describe('ApprovedCommandRegistry 归属隔离（P3）', () => {
  it('本地记录：本地可复用，远端身份不可', () => {
    const registry = makeRegistry();
    registry.approve('s1', 'h1', 'ls -la');

    expect(registry.isApproved('s1', 'h1')).toBe(true);
    expect(runWithPrincipal(ALICE, () => registry.isApproved('s1', 'h1'))).toBe(
      false
    );
  });

  it('租户记录：本人可复用、他人与本地各自的视图互不影响', () => {
    const registry = makeRegistry();
    runWithPrincipal(ALICE, () => registry.approve('s1', 'h1', 'ls -la'));

    expect(runWithPrincipal(ALICE, () => registry.isApproved('s1', 'h1'))).toBe(
      true
    );
    expect(runWithPrincipal(BOB, () => registry.isApproved('s1', 'h1'))).toBe(
      false
    );
    // 本地身份恒放行（单用户基线）
    expect(registry.isApproved('s1', 'h1')).toBe(true);

    // 记录本身带归属键
    expect(registry.getApprovalEntry('s1', 'h1')?.ownerKey).toBe('acme:alice');
    // 越权读 = 不存在
    expect(
      runWithPrincipal(BOB, () => registry.getApprovalEntry('s1', 'h1'))
    ).toBeUndefined();
  });

  it('命令名级放行同样按归属过滤', () => {
    const registry = makeRegistry();
    runWithPrincipal(ALICE, () => registry.approve('s1', 'h1', 'npm test'));

    expect(
      runWithPrincipal(ALICE, () =>
        registry.isCommandNameApproved('s1', 'npm run build')
      )
    ).toBe(true);
    expect(
      runWithPrincipal(BOB, () =>
        registry.isCommandNameApproved('s1', 'npm run build')
      )
    ).toBe(false);
  });

  it('clearSession 只清当前身份可见的记录', () => {
    const registry = makeRegistry();
    runWithPrincipal(ALICE, () => registry.approve('s1', 'h1', 'ls'));
    runWithPrincipal(BOB, () => registry.approve('s1', 'h2', 'pwd'));

    // BOB 清理只动自己的
    runWithPrincipal(BOB, () => registry.clearSession('s1'));
    expect(runWithPrincipal(BOB, () => registry.isApproved('s1', 'h2'))).toBe(
      false
    );
    expect(runWithPrincipal(ALICE, () => registry.isApproved('s1', 'h1'))).toBe(
      true
    );

    // 本地身份清理 ⇒ 全清（与改造前一致）
    registry.clearSession('s1');
    expect(registry.isApproved('s1', 'h1')).toBe(false);
  });
});
