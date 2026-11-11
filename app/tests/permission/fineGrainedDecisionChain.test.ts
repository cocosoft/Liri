/**
 * 细粒度 RBAC → 判定链的**自动化回归**（P3-9，2026-11-11）
 *
 * 此前该链路零测试：deny > ask > allow 的排序、角色/用户/资源三路来源、
 * 资源通道的「排除角色/用户绑定」过滤、dontAsk 档把 ask 转拒绝、以及规则读取
 * 失败时的 fail-closed（P1-3），全靠人工真机验证。
 *
 * 隔离方式：`checkFineGrainedRules` 经 `getFineGrainedPermissionManager()` 取存储
 * ⇒ 用假存储替换该访问器；`PermissionManager.resetRules()` 清掉 A 体系规则，
 * 保证断言只反映 RBAC 一条链路。
 */
import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';

import * as fineGrainedModule from '@openliri/infra/permission/FineGrainedPermissionManager';
import {
  createPermissionManager,
  OperationType,
  PermissionAction,
  PermissionMode,
  type FineGrainedPermissionRule as PermissionRule,
  type Role,
} from '@openliri/infra/permission';
import { createPermissionContext } from '@openliri/infra/permission/types/PermissionContext';
import type { PermissionContext } from '@openliri/infra/permission/types/PermissionContext';

interface FakeState {
  roles: Role[];
  rules: PermissionRule[];
  /** P1-3：模拟规则文件不可读（解析失败 / IO 错误） */
  throwOnRead: boolean;
}

const state: FakeState = { roles: [], rules: [], throwOnRead: false };

function assertReadable(): void {
  if (state.throwOnRead) {
    throw new Error('EACCES: permissions/rules.json unreadable (simulated)');
  }
}

const fakeStorage = {
  getRoleByName: async (name: string) => {
    assertReadable();
    return state.roles.find((role) => role.name === name) ?? null;
  },
  getRulesByRole: async (roleId: string) => {
    assertReadable();
    return state.rules.filter((rule) => rule.roleId === roleId);
  },
  getRulesByUser: async (userId: string) => {
    assertReadable();
    return state.rules.filter((rule) => rule.userId === userId);
  },
  getRulesByResource: async (resourceId: string) => {
    assertReadable();
    return state.rules.filter((rule) => rule.resourceId === resourceId);
  },
};

const managerSpy = spyOn(
  fineGrainedModule,
  'getFineGrainedPermissionManager'
).mockImplementation(
  () =>
    ({
      getStorage: () => fakeStorage,
    }) as never
);

afterAll(() => {
  managerSpy.mockRestore();
});

beforeEach(() => {
  state.roles = [];
  state.rules = [];
  state.throwOnRead = false;
});

const role = (name: 'admin' | 'user' | 'guest'): Role => ({
  id: name,
  name: name as Role['name'],
  permissions: [],
  createdAt: 1,
  updatedAt: 1,
});

const rule = (overrides: Partial<PermissionRule> = {}): PermissionRule => ({
  id: `rbac_${state.rules.length + 1}`,
  resourceId: 'bash',
  operation: OperationType.EXECUTE,
  action: PermissionAction.DENY,
  priority: 0,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

/** 走真实判定链（不 mock checkPermission），A 体系规则清空；工具固定 bash */
function decide(
  identity: Pick<PermissionContext, 'userId' | 'userRole' | 'userRoles'>,
  mode: PermissionMode = PermissionMode.DEFAULT
) {
  const pm = createPermissionManager();
  pm.resetRules();
  const input = { command: 'echo hello' };
  return pm.checkPermission(
    'bash',
    input,
    createPermissionContext({
      toolName: 'bash',
      input,
      permissionMode: mode,
      ...identity,
    })
  );
}

describe('RBAC 判定链：deny > ask > allow', () => {
  test('角色同时存在 deny / ask / allow ⇒ deny', async () => {
    state.roles = [role('guest')];
    state.rules = [
      rule({ roleId: 'guest', action: PermissionAction.ALLOW }),
      rule({ roleId: 'guest', action: PermissionAction.ASK }),
      rule({ roleId: 'guest', action: PermissionAction.DENY }),
    ];

    const decision = await decide({ userRole: 'guest' });

    expect(decision.type).toBe('deny');
    expect(decision.reason).toContain('Denied by fine-grained rule');
  });

  test('ask 未被 allow 越过（default 档）', async () => {
    state.roles = [role('guest')];
    state.rules = [
      rule({ roleId: 'guest', action: PermissionAction.ALLOW }),
      rule({ roleId: 'guest', action: PermissionAction.ASK }),
    ];

    const decision = await decide({ userRole: 'guest' });

    expect(decision.type).toBe('ask');
    expect(decision.reason).toContain('Asked by fine-grained rule');
  });

  test('RBAC allow 在没有 deny/ask 时放行', async () => {
    state.roles = [role('guest')];
    state.rules = [rule({ roleId: 'guest', action: PermissionAction.ALLOW })];

    const decision = await decide({ userRole: 'guest' });

    expect(decision.type).toBe('allow');
    expect(decision.reason).toContain('Allowed by fine-grained rule');
  });
});

describe('RBAC 判定链：dontAsk 档', () => {
  test('ask 转为拒绝（不弹卡语义）', async () => {
    state.roles = [role('guest')];
    state.rules = [
      rule({ roleId: 'guest', action: PermissionAction.ASK }),
      rule({ roleId: 'guest', action: PermissionAction.ALLOW }),
    ];

    const decision = await decide(
      { userRole: 'guest' },
      PermissionMode.DONT_ASK
    );

    expect(decision.type).toBe('deny');
    expect(decision.reason).toContain('Dont ask mode');
  });

  test('allow 仍然放行（不被 ask 档位误伤）', async () => {
    state.roles = [role('guest')];
    state.rules = [rule({ roleId: 'guest', action: PermissionAction.ALLOW })];

    const decision = await decide(
      { userRole: 'guest' },
      PermissionMode.DONT_ASK
    );

    expect(decision.type).toBe('allow');
    expect(decision.reason).toContain('Allowed by fine-grained rule');
  });
});

describe('RBAC 判定链：三路来源与隔离', () => {
  test('用户绑定只对本人生效（bob 不受 alice 的 deny 影响）', async () => {
    state.roles = [role('admin')];
    state.rules = [rule({ userId: 'alice', action: PermissionAction.DENY })];

    expect((await decide({ userId: 'alice', userRole: 'admin' })).type).toBe(
      'deny'
    );
    expect((await decide({ userId: 'bob', userRole: 'admin' })).type).toBe(
      'allow'
    );
  });

  test('角色绑定不会经「资源通道」串给其他角色', async () => {
    state.roles = [role('admin'), role('guest')];
    // 给 guest 的绑定：resourceId 同为工具名，但带 roleId ⇒ 资源通道必须过滤掉
    state.rules = [rule({ roleId: 'guest', action: PermissionAction.DENY })];

    const decision = await decide({ userRole: 'admin' });

    expect(decision.type).toBe('allow');
  });

  test('资源绑定（无角色/用户）对所有人生效', async () => {
    state.roles = [role('admin')];
    state.rules = [rule({ resourceId: 'bash', action: PermissionAction.DENY })];

    const decision = await decide({ userRole: 'admin' });

    expect(decision.type).toBe('deny');
    expect(decision.reason).toContain('Denied by fine-grained rule');
  });

  test('多角色（P2-6）：非主角色的绑定同样生效（并集判定）', async () => {
    state.roles = [role('admin'), role('guest')];
    // 绑定落在**第二个**角色上：旧实现只看 roles[0] ⇒ 永远不命中
    state.rules = [rule({ roleId: 'guest', action: PermissionAction.DENY })];

    const decision = await decide({
      userRole: 'admin',
      userRoles: ['admin', 'guest'],
    });

    expect(decision.type).toBe('deny');
  });

  test('多角色：无 userRoles 时回落 userRole 单值（旧调用方行为不变）', async () => {
    state.roles = [role('admin'), role('guest')];
    state.rules = [rule({ roleId: 'guest', action: PermissionAction.DENY })];

    const decision = await decide({ userRole: 'admin' });

    expect(decision.type).toBe('allow');
  });

  test('规则只认 execute / all（operation 不匹配则不生效）', async () => {
    state.roles = [role('guest')];
    state.rules = [
      rule({
        roleId: 'guest',
        action: PermissionAction.DENY,
        operation: OperationType.READ,
      }),
    ];

    const decision = await decide({ userRole: 'guest' });

    expect(decision.type).toBe('allow');
  });
});

describe('RBAC 判定链：连续拒绝不改写 deny（P0-2）', () => {
  const repeatDeny = async (
    mode: PermissionMode,
    times: number
  ): Promise<string[]> => {
    state.roles = [role('guest')];
    state.rules = [rule({ roleId: 'guest', action: PermissionAction.DENY })];

    const pm = createPermissionManager();
    pm.resetRules();
    const input = { command: 'echo hello' };
    const types: string[] = [];
    for (let i = 0; i < times; i += 1) {
      const decision = await pm.checkPermission(
        'bash',
        input,
        createPermissionContext({
          toolName: 'bash',
          input,
          permissionMode: mode,
          sessionId: 's1',
          userRole: 'guest',
        })
      );
      types.push(decision.type);
    }
    return types;
  };

  test('default 档：连续 5 次命中 deny 仍是 deny（不升 ask）', async () => {
    expect(await repeatDeny(PermissionMode.DEFAULT, 5)).toEqual(
      Array(5).fill('deny')
    );
  });

  test('dontAsk 档：连续 5 次命中 deny 仍是 deny（且不弹卡）', async () => {
    expect(await repeatDeny(PermissionMode.DONT_ASK, 5)).toEqual(
      Array(5).fill('deny')
    );
  });

  test('plan 档：RBAC deny 仍然拒绝（P0-4，不再无条件 ask）', async () => {
    state.roles = [role('guest')];
    state.rules = [rule({ roleId: 'guest', action: PermissionAction.DENY })];

    const decision = await decide(
      { userRole: 'guest', userRoles: ['guest'] },
      PermissionMode.PLAN
    );

    expect(decision.type).toBe('deny');
  });
});

describe('RBAC 判定链：规则不可读 ⇒ fail-closed（P1-3）', () => {
  test('存储读取抛错时拒绝执行，而不是静默回落到 A 规则', async () => {
    state.roles = [role('guest')];
    state.rules = [
      rule({ resourceId: 'bash', action: PermissionAction.ALLOW }),
    ];
    state.throwOnRead = true;

    const decision = await decide({ userRole: 'guest' });

    expect(decision.type).toBe('deny');
    expect(decision.reason).toContain('RBAC rules unavailable');
  });
});
