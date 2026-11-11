/**
 * P2-5（2026-11-11）：细粒度 RBAC deny 的**归因标签**守卫。
 *
 * 背景：`checkFineGrainedRules` 把角色 / 用户 / 资源三路规则合并挑选，早期指标把
 * 命中一律记成「当前生效角色」⇒ 桌面端（本地=admin）连用户级 / 资源级 deny 都记成
 * `role=admin`，排障看不出真正拦截者。
 *
 * 这里钉住三件事：
 *   ① 用户路 ⇒ `user:<userId>`（不再借用生效角色）；
 *   ② 资源路 ⇒ `resource:<resourceId>`；
 *   ③ 角色路 ⇒ `role:<roleId>`，`roleObj.permissions` 未带 roleId 时才回落到生效角色名。
 */
import { describe, expect, it } from 'bun:test';

import { describeFineGrainedDenySubject } from '@openliri/infra/permission';

const RULE = {
  resourceId: 'bash',
  roleId: undefined,
  userId: undefined,
} as const;

describe('describeFineGrainedDenySubject（deny 归因）', () => {
  it('用户绑定 ⇒ user:<userId>（即使存在生效角色也不借用）', () => {
    expect(
      describeFineGrainedDenySubject(
        { ...RULE, userId: 'alice' },
        'user',
        'admin'
      )
    ).toBe('user:alice');
  });

  it('资源绑定 ⇒ resource:<resourceId>', () => {
    expect(describeFineGrainedDenySubject(RULE, 'resource', 'admin')).toBe(
      'resource:bash'
    );
  });

  it('角色绑定 ⇒ role:<roleId>（优先规则自身的 roleId）', () => {
    expect(
      describeFineGrainedDenySubject(
        { ...RULE, roleId: 'guest' },
        'role',
        'admin'
      )
    ).toBe('role:guest');
  });

  it('角色路缺 roleId（roleObj.permissions）⇒ 回落生效角色名', () => {
    expect(describeFineGrainedDenySubject(RULE, 'role', 'admin')).toBe(
      'role:admin'
    );
  });

  it('角色路且无生效角色 ⇒ role:unknown（不编造主体）', () => {
    expect(describeFineGrainedDenySubject(RULE, 'role', null)).toBe(
      'role:unknown'
    );
  });
});
