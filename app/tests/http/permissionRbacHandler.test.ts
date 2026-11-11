/**
 * 细粒度 RBAC HTTP 入口回归（2026-11-11，撤销 P3-3 第二步）
 *
 * 锁住：
 *  ① 快照结构与统计口径（角色/用户/资源各自绑定数、资源不计角色/用户绑定）；
 *  ② 写动作经 `CommandsOpsPort` 走**同一个命令执行器**（CLI 与 HTTP 不漂移）；
 *  ③ 非法 area / 缺 action / 参数含空白 明确失败。
 */
import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import * as permissionModule from '@openliri/infra/permission';
import type {
  FineGrainedPermissionRule,
  Resource,
  Role,
  User,
} from '@openliri/infra/permission';
import * as coreAPIModule from '../../src/runtime/api/CoreAPIImpl';

interface FakeState {
  roles: Role[];
  users: User[];
  resources: Resource[];
  rules: FineGrainedPermissionRule[];
}

const state: FakeState = { roles: [], users: [], resources: [], rules: [] };
/** 记录经 `CommandsOpsPort` 下发的命令串 */
let executed: string[] = [];

function makeManager(): unknown {
  return {
    getStorage: () => ({
      getAllRoles: async () => state.roles,
      getAllUsers: async () => state.users,
      getAllResources: async () => state.resources,
      getAllRules: async () => state.rules,
    }),
  };
}

const fineSpy = spyOn(
  permissionModule,
  'createFineGrainedPermissionManager'
).mockImplementation(() => makeManager() as never);

const coreAPISpy = spyOn(coreAPIModule, 'getCoreAPI').mockReturnValue({
  getCommandsOpsPort: async () => ({
    executeCommand: async (command: string) => {
      executed.push(command);
      return { success: true, message: `ok: ${command}` };
    },
  }),
} as never);

afterAll(() => {
  fineSpy.mockRestore();
  coreAPISpy.mockRestore();
});

beforeEach(() => {
  state.roles = [];
  state.users = [];
  state.resources = [];
  state.rules = [];
  executed = [];
});

const { executeRbacAction, getRbacSnapshot } =
  await import('../../src/infrastructure/http/handlers/permission-rbac-handlers');

const rule = (
  overrides: Partial<FineGrainedPermissionRule>
): FineGrainedPermissionRule => ({
  id: 'rbac_1',
  resourceId: 'bash',
  operation: 'execute' as FineGrainedPermissionRule['operation'],
  action: 'deny' as FineGrainedPermissionRule['action'],
  priority: 0,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

describe('GET /v1/permissions/rbac 快照', () => {
  test('角色/用户/资源各自绑定数；资源不计角色绑定', async () => {
    state.roles = [
      {
        id: 'guest',
        name: 'guest' as Role['name'],
        permissions: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    state.users = [
      {
        id: 'alice',
        name: 'alice',
        roles: ['guest' as User['roles'][number]],
        permissions: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    state.resources = [
      {
        id: 'res_1',
        type: 'tool' as Resource['type'],
        name: 'bash',
        path: 'bash',
      },
    ];
    state.rules = [
      rule({ id: 'r-role', roleId: 'guest' }),
      rule({ id: 'r-user', userId: 'alice' }),
      rule({ id: 'r-resource' }),
    ];

    const snapshot = await getRbacSnapshot();

    expect(snapshot.roles[0]).toMatchObject({ name: 'guest', ruleCount: 1 });
    expect(snapshot.users[0]).toMatchObject({ name: 'alice', ruleCount: 1 });
    expect(snapshot.resources[0]).toMatchObject({ path: 'bash', ruleCount: 1 });
    expect(snapshot.bindings).toHaveLength(3);
  });
});

describe('POST /v1/permissions/rbac 动作', () => {
  test('role bind 经命令执行器下发同一命令串', async () => {
    const result = await executeRbacAction('role bind guest bash');

    expect(result.success).toBe(true);
    expect(executed).toEqual(['/permissions role bind guest bash']);
  });

  test('带空格的描述原样交给命令层（不在 HTTP 层拆参数）', async () => {
    await executeRbacAction('role add system HTTP 测试');
    expect(executed).toEqual(['/permissions role add system HTTP 测试']);
  });

  test('非法子域 / 空命令 / 前导斜杠 明确失败', async () => {
    const badArea = await executeRbacAction('group list');
    expect(badArea.success).toBe(false);
    expect(badArea.message).toContain('无效的子域: group');

    const empty = await executeRbacAction('   ');
    expect(empty.success).toBe(false);
    expect(empty.message).toContain('command 必填');

    const slash = await executeRbacAction('/permissions role list');
    expect(slash.success).toBe(false);
    expect(slash.message).toContain('不需要前导');
    expect(executed).toEqual([]);
  });
});
