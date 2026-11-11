/**
 * `/permissions mode` 接线回归（2026-11-11，旧服务链删除后）
 *
 * 背景：该命令原先读写 `PermissionModeIntegrationService` + `SessionMetadataService`
 * 两个**影子存储**（写进去不影响任何判定）。现在改为直连 ChatManager 持有的
 * `PermissionManager` —— 也就是 `ToolExecutionService` 经
 * `facadeWiring.getPermissionManager: () => host.permissionManager` 取到的同一实例。
 *
 * 本用例锁住：
 *  ① 读路径与真实管理器同源（不再恒显示 default）；
 *  ② 写路径真正调用 `setMode`（不再"看着成功、实际无效"）；
 *  ③ 首个对话前（`llmChatOps` 尚未装配）⇒ 命令**补装配**同一个字段，不无声失败；
 *  ④ 组合根不可用 ⇒ 明确失败，不伪装成功。
 *
 * 注：命令的值域来自 `PERMISSION_MODES`（5 档），旧值 `ask`/`strict` 等必须被拒。
 */
import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import {
  PermissionBehavior,
  PermissionRuleSource,
  RoleType,
  type FineGrainedPermissionRule,
  type PermissionMode,
  type PermissionRule,
  type Resource,
  type Role,
  type User,
} from '@openliri/infra/permission';
import * as coreAPIModule from '../../src/runtime/api/CoreAPIImpl';
import * as fineGrainedModule from '../../src/commands/builtin/permissions/liveFineGrainedManager';

interface FakeRuleManager {
  addRule: (rule: PermissionRule) => void;
  removeRule: (rule: PermissionRule) => void;
  getRules: () => PermissionRule[];
}

interface FakeManager {
  getMode: () => PermissionMode;
  setMode: (mode: PermissionMode) => void;
  getRuleManager: () => FakeRuleManager;
}

let mode: PermissionMode = 'plan';
let setCalls: PermissionMode[] = [];
let injectCalls = 0;
/** 真实规则（模拟 `tool_rules.json` 的内存视图） */
let rules: PermissionRule[] = [];
/** `llmChatOps` 是否已装配（false ⇒ 模拟"首个对话前"） */
let managerPresent = true;
/** 组合根是否可用（false ⇒ `getChatManager()` 直接抛错） */
let compositionReady = true;
let manager: FakeManager | undefined;

function makeManager(): FakeManager {
  return {
    getMode: () => mode,
    setMode: (next) => {
      mode = next;
      setCalls.push(next);
    },
    getRuleManager: () => ({
      addRule: (rule) => {
        rules = [...rules.filter((item) => item.id !== rule.id), rule];
      },
      removeRule: (rule) => {
        rules = rules.filter((item) => item.id !== rule.id);
      },
      getRules: () => rules,
    }),
  };
}

const coreAPIStub = {
  getChatManager: () => {
    if (!compositionReady) throw new Error('组合根未装配');
    return {
      getPermissionManager: () => (managerPresent ? manager : undefined),
      setPermissionManager: (next: unknown) => {
        injectCalls += 1;
        manager = next as FakeManager;
        managerPresent = true;
      },
    };
  },
};

const getCoreAPISpy = spyOn(coreAPIModule, 'getCoreAPI').mockReturnValue(
  coreAPIStub as never
);

afterAll(() => {
  getCoreAPISpy.mockRestore();
});

beforeEach(() => {
  mode = 'plan';
  setCalls = [];
  injectCalls = 0;
  rules = [];
  managerPresent = true;
  compositionReady = true;
  manager = makeManager();
});

const { default: permissionsCommand } =
  await import('../../src/commands/builtin/permissions/Permissions');

describe('/permissions mode 直连真实权限管理器', () => {
  test('① 读：显示管理器里的当前模式，并高亮它', async () => {
    const result = await permissionsCommand.execute('mode', {});

    expect(result.success).toBe(true);
    expect(result.message).toContain('当前模式: plan');
    expect(result.message).toContain('* plan (当前)');
  });

  test('② 写：调用 setMode（不再写影子存储）', async () => {
    const result = await permissionsCommand.execute('mode set bypass', {});

    expect(result.success).toBe(true);
    expect(setCalls).toEqual(['bypass']);
    expect(mode).toBe('bypass');
    expect(result.message).toContain('全自动');
  });

  test('③ 收缩前的旧值（strict / ask）被拒，且列出 5 档', async () => {
    for (const legacy of ['strict', 'ask', 'acceptEdits', 'alwaysAsk']) {
      const result = await permissionsCommand.execute(`mode set ${legacy}`, {});
      expect(result.success).toBe(false);
      expect(result.message).toContain('无效的权限模式');
      expect(result.message).toContain('default, plan, dontAsk, auto, bypass');
    }
    expect(setCalls).toEqual([]);
  });

  test('④ 首个对话前未装配 ⇒ 命令补装配同一字段，设置可生效', async () => {
    managerPresent = false;

    const set = await permissionsCommand.execute('mode set bypass', {});

    expect(set.success).toBe(true);
    // 补装配一次，且后续读到的就是它（同一实例）
    expect(injectCalls).toBe(1);
    expect(manager?.getMode()).toBe('bypass');

    const show = await permissionsCommand.execute('mode', {});
    expect(show.message).toContain('当前模式: bypass');
  });

  test('⑤ 组合根不可用 ⇒ 明确失败，不伪装成功', async () => {
    compositionReady = false;

    const show = await permissionsCommand.execute('mode', {});
    expect(show.success).toBe(true);
    expect(show.message).toContain('未初始化（首次对话后装配）');

    const set = await permissionsCommand.execute('mode set plan', {});
    expect(set.success).toBe(false);
    expect(set.message).toContain('尚未初始化');
    expect(setCalls).toEqual([]);
  });
});

describe('/permissions grant / revoke / rules / status 走真实规则', () => {
  test('grant：写入 allow 规则（判定同源 + 落盘来源）', async () => {
    const result = await permissionsCommand.execute('grant bash', {});

    expect(result.success).toBe(true);
    expect(result.message).toContain('已允许工具 bash');
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      behavior: PermissionBehavior.ALLOW,
      toolName: 'bash',
      source: PermissionRuleSource.RULE_STORE,
    });
  });

  test('grant 缺参数 ⇒ 用法提示，不写规则', async () => {
    const result = await permissionsCommand.execute('grant', {});

    expect(result.success).toBe(false);
    expect(result.message).toContain('用法: /permissions grant <工具名>');
    expect(rules).toEqual([]);
  });

  test('revoke：移除该工具的全部规则，保留其他工具', async () => {
    rules = [
      {
        id: 'r1',
        behavior: PermissionBehavior.ALLOW,
        toolName: 'bash',
        source: PermissionRuleSource.RULE_STORE,
        priority: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'r2',
        behavior: PermissionBehavior.DENY,
        toolName: 'bash',
        source: PermissionRuleSource.RULE_STORE,
        priority: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'r3',
        behavior: PermissionBehavior.ALLOW,
        toolName: 'read',
        source: PermissionRuleSource.RULE_STORE,
        priority: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const result = await permissionsCommand.execute('revoke bash', {});

    expect(result.success).toBe(true);
    expect(result.message).toContain('已移除工具 bash 的 2 条规则');
    expect(rules.map((rule) => rule.id)).toEqual(['r3']);
  });

  test('revoke 无匹配规则 ⇒ 如实说明，不误报成功移除', async () => {
    const result = await permissionsCommand.execute('revoke bash', {});

    expect(result.success).toBe(true);
    expect(result.message).toContain('工具 bash 当前没有规则');
  });

  test('rules：按 behavior 分组显示真实规则与来源', async () => {
    rules = [
      {
        id: 'r1',
        behavior: PermissionBehavior.ALLOW,
        toolName: 'bash',
        contentPattern: 'git status',
        source: PermissionRuleSource.RULE_STORE,
        priority: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'r2',
        behavior: PermissionBehavior.DENY,
        toolName: 'rm',
        source: PermissionRuleSource.RULE_STORE,
        priority: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const result = await permissionsCommand.execute('rules', {});

    expect(result.success).toBe(true);
    expect(result.message).toContain('共 2 条');
    expect(result.message).toContain('允许 (allow)');
    expect(result.message).toContain('bash(git status)');
    expect(result.message).toContain('拒绝 (deny)');
    expect(result.message).toContain('rm');
    expect(result.message).toContain('来源: ruleStore');
  });

  test('rules --json：输出真实规则数', async () => {
    const result = await permissionsCommand.execute('rules --json', {});
    const payload = JSON.parse(result.message ?? '') as {
      mode: string | null;
      ruleCount: number;
    };

    expect(result.success).toBe(true);
    expect(payload).toEqual({ mode: 'plan', rules: [], ruleCount: 0 });
  });

  test('status：统计真实规则而非静态示例清单', async () => {
    rules = [
      {
        id: 'r1',
        behavior: PermissionBehavior.ALLOW,
        toolName: 'bash',
        source: PermissionRuleSource.RULE_STORE,
        priority: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'r2',
        behavior: PermissionBehavior.ALLOW,
        toolName: 'read',
        source: PermissionRuleSource.RULE_STORE,
        priority: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'r3',
        behavior: PermissionBehavior.ASK,
        toolName: 'write',
        source: PermissionRuleSource.RULE_STORE,
        priority: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const result = await permissionsCommand.execute('status', {});

    expect(result.success).toBe(true);
    expect(result.message).toContain('规则总数: 3');
    expect(result.message).toContain('允许 (allow): 2');
    expect(result.message).toContain('询问 (ask): 1');
    expect(result.message).toContain('plan (每步确认)');
  });

  test('组合根不可用 ⇒ grant / rules 明确失败', async () => {
    compositionReady = false;

    const grant = await permissionsCommand.execute('grant bash', {});
    expect(grant.success).toBe(false);
    expect(grant.message).toContain('尚未初始化');

    const list = await permissionsCommand.execute('rules', {});
    expect(list.success).toBe(false);
    expect(list.message).toContain('尚未初始化');
  });
});

describe('/permissions list / show / add / remove 只认真实规则', () => {
  const seed = (overrides: Partial<PermissionRule>): PermissionRule => ({
    id: 'r1',
    behavior: PermissionBehavior.ALLOW,
    toolName: 'bash',
    source: PermissionRuleSource.RULE_STORE,
    priority: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  test('list：输出真实规则，不再出现虚构权限名', async () => {
    rules = [seed({ id: 'r1', toolName: 'bash' })];

    const result = await permissionsCommand.execute('list', {});

    expect(result.success).toBe(true);
    expect(result.message).toContain('bash');
    expect(result.message).toContain('共 1 条');
    expect(result.message).not.toContain('file.read');
    expect(result.message).not.toContain('shell.execute');
  });

  test('show：只显示该工具的规则', async () => {
    rules = [
      seed({ id: 'r1', toolName: 'bash' }),
      seed({ id: 'r2', toolName: 'read', behavior: PermissionBehavior.DENY }),
    ];

    const result = await permissionsCommand.execute('show bash', {});

    expect(result.success).toBe(true);
    expect(result.message).toContain('工具 bash 的规则 (1 条)');
    expect(result.message).not.toContain('read');
  });

  test('show：无规则的工具如实说明，不报错', async () => {
    const result = await permissionsCommand.execute('show bash', {});

    expect(result.success).toBe(true);
    expect(result.message).toContain('工具 bash 当前没有规则');
  });

  test('add：写入真实 deny 规则（可带内容模式）', async () => {
    const deny = await permissionsCommand.execute('add deny bash', {});
    expect(deny.success).toBe(true);
    expect(rules[0]).toMatchObject({
      behavior: PermissionBehavior.DENY,
      toolName: 'bash',
      source: PermissionRuleSource.RULE_STORE,
    });
    expect(rules[0].contentPattern).toBeUndefined();

    const allow = await permissionsCommand.execute(
      'add allow bash "git status"',
      {}
    );
    expect(allow.success).toBe(true);
    expect(rules[1]).toMatchObject({
      behavior: PermissionBehavior.ALLOW,
      toolName: 'bash',
      contentPattern: 'git status',
    });
  });

  test('add：非法行为被拒，不写规则', async () => {
    const result = await permissionsCommand.execute('add foo bash', {});

    expect(result.success).toBe(false);
    expect(result.message).toContain('无效的行为: foo');
    expect(rules).toEqual([]);
  });

  test('remove：按真实规则 ID 删除', async () => {
    rules = [
      seed({ id: 'r1', toolName: 'bash' }),
      seed({ id: 'r2', toolName: 'read' }),
    ];

    const result = await permissionsCommand.execute('remove r1', {});

    expect(result.success).toBe(true);
    expect(result.message).toContain('已移除规则 r1');
    expect(rules.map((rule) => rule.id)).toEqual(['r2']);
  });

  test('remove：规则不存在时如实失败', async () => {
    const result = await permissionsCommand.execute('remove missing', {});

    expect(result.success).toBe(false);
    expect(result.message).toContain('未找到规则: missing');
  });
});

/* ── 细粒度 RBAC：写入与绑定（roles/users/resources/rules.json） ── */

interface FakeRbacState {
  roles: Role[];
  users: User[];
  resources: Resource[];
  rules: FineGrainedPermissionRule[];
}

const rbacState: FakeRbacState = {
  roles: [],
  users: [],
  resources: [],
  rules: [],
};

function makeFineGrainedManager(): unknown {
  return {
    addRule: async (rule: FineGrainedPermissionRule) => {
      rbacState.rules.push(rule);
      return rule.id;
    },
    deleteRule: async (id: string) => {
      rbacState.rules = rbacState.rules.filter((rule) => rule.id !== id);
    },
    addResource: async (resource: Resource) => {
      rbacState.resources.push(resource);
      return resource.id;
    },
    getStorage: () => ({
      getAllRoles: async () => rbacState.roles,
      getRoleByName: async (name: string) =>
        rbacState.roles.find((role) => role.name === name) ?? null,
      saveRole: async (role: Role) => {
        rbacState.roles.push(role);
        return role.id;
      },
      deleteRole: async (id: string) => {
        rbacState.roles = rbacState.roles.filter((role) => role.id !== id);
      },
      getRulesByRole: async (roleId: string) =>
        rbacState.rules.filter((rule) => rule.roleId === roleId),
      getAllUsers: async () => rbacState.users,
      getUserByName: async (name: string) =>
        rbacState.users.find((user) => user.name === name) ?? null,
      saveUser: async (user: User) => {
        rbacState.users.push(user);
        return user.id;
      },
      deleteUser: async (id: string) => {
        rbacState.users = rbacState.users.filter((user) => user.id !== id);
      },
      updateUser: async (user: User) => {
        rbacState.users = rbacState.users.map((item) =>
          item.id === user.id ? user : item
        );
      },
      getRulesByUser: async (userId: string) =>
        rbacState.rules.filter((rule) => rule.userId === userId),
      getAllResources: async () => rbacState.resources,
      getResourceByPath: async (path: string, type: string) =>
        rbacState.resources.find(
          (resource) => resource.path === path && resource.type === type
        ) ?? null,
      saveResource: async (resource: Resource) => {
        rbacState.resources.push(resource);
        return resource.id;
      },
      deleteResource: async (id: string) => {
        rbacState.resources = rbacState.resources.filter(
          (resource) => resource.id !== id
        );
      },
      getRulesByResource: async (resourceId: string) =>
        rbacState.rules.filter((rule) => rule.resourceId === resourceId),
    }),
  };
}

const fineGrainedSpy = spyOn(
  fineGrainedModule,
  'liveFineGrainedManager'
).mockImplementation(() => makeFineGrainedManager() as never);

afterAll(() => {
  fineGrainedSpy.mockRestore();
});

beforeEach(() => {
  rbacState.roles = [];
  rbacState.users = [];
  rbacState.resources = [];
  rbacState.rules = [];
});

describe('/permissions role 写入与绑定', () => {
  test('add：写入角色，重复添加与非法角色名被拒', async () => {
    const added = await permissionsCommand.execute('role add guest 访客', {});
    expect(added.success).toBe(true);
    expect(rbacState.roles[0]).toMatchObject({
      id: 'guest',
      name: 'guest',
      description: '访客',
    });

    const duplicate = await permissionsCommand.execute('role add guest', {});
    expect(duplicate.success).toBe(false);
    expect(duplicate.message).toContain('角色已存在');

    const invalid = await permissionsCommand.execute('role add root', {});
    expect(invalid.success).toBe(false);
    expect(invalid.message).toContain('无效的角色名: root');
    expect(rbacState.roles).toHaveLength(1);
  });

  test('list：显示角色与绑定数量', async () => {
    rbacState.roles = [
      {
        id: 'guest',
        name: RoleType.GUEST,
        description: '访客',
        permissions: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    rbacState.rules = [
      {
        id: 'rbac_1',
        resourceId: 'bash',
        operation: 'execute' as FineGrainedPermissionRule['operation'],
        action: 'deny' as FineGrainedPermissionRule['action'],
        roleId: 'guest',
        priority: 0,
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    const result = await permissionsCommand.execute('role list', {});
    expect(result.success).toBe(true);
    expect(result.message).toContain('guest');
    expect(result.message).toContain('绑定规则 1 条');
  });

  test('bind / unbind：写入与移除真实 deny 规则（幂等）', async () => {
    rbacState.roles = [
      {
        id: 'guest',
        name: RoleType.GUEST,
        permissions: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    const bound = await permissionsCommand.execute('role bind guest bash', {});
    expect(bound.success).toBe(true);
    expect(rbacState.rules[0]).toMatchObject({
      resourceId: 'bash',
      action: 'deny',
      operation: 'execute',
      roleId: 'guest',
    });

    const again = await permissionsCommand.execute('role bind guest bash', {});
    expect(again.message).toContain('已绑定');
    expect(rbacState.rules).toHaveLength(1);

    const unbound = await permissionsCommand.execute(
      'role unbind guest bash',
      {}
    );
    expect(unbound.success).toBe(true);
    expect(rbacState.rules).toEqual([]);
  });

  test('bind：未知角色 / 非法操作被拒', async () => {
    const unknown = await permissionsCommand.execute(
      'role bind ghost bash',
      {}
    );
    expect(unknown.success).toBe(false);
    expect(unknown.message).toContain('未找到角色: ghost');

    rbacState.roles = [
      {
        id: 'guest',
        name: RoleType.GUEST,
        permissions: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    const invalid = await permissionsCommand.execute(
      'role bind guest bash write',
      {}
    );
    expect(invalid.success).toBe(false);
    expect(invalid.message).toContain('无效的行为: write');
  });

  test('bind allow / ask：按行为分别落规则，互不覆盖', async () => {
    rbacState.roles = [
      {
        id: 'guest',
        name: RoleType.GUEST,
        permissions: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    const allow = await permissionsCommand.execute(
      'role bind guest bash allow',
      {}
    );
    expect(allow.success).toBe(true);
    expect(rbacState.rules[0]).toMatchObject({
      resourceId: 'bash',
      action: 'allow',
      operation: 'execute',
      roleId: 'guest',
    });

    const ask = await permissionsCommand.execute(
      'role bind guest bash ask all',
      {}
    );
    expect(ask.success).toBe(true);
    expect(rbacState.rules[1]).toMatchObject({
      action: 'ask',
      operation: 'all',
    });

    // 同工具同操作但不同行为 ⇒ 不合并
    const deny = await permissionsCommand.execute('role bind guest bash', {});
    expect(deny.success).toBe(true);
    expect(rbacState.rules).toHaveLength(3);

    // 完全相同的绑定 ⇒ 幂等
    const again = await permissionsCommand.execute(
      'role bind guest bash allow',
      {}
    );
    expect(again.message).toContain('已绑定');
    expect(rbacState.rules).toHaveLength(3);
  });
});

describe('/permissions user 写入与绑定', () => {
  test('add：默认 guest 角色；重复与非法用户名被拒', async () => {
    const added = await permissionsCommand.execute('user add alice', {});
    expect(added.success).toBe(true);
    expect(rbacState.users[0]).toMatchObject({
      id: 'alice',
      name: 'alice',
      roles: ['guest'],
    });

    const duplicate = await permissionsCommand.execute('user add alice', {});
    expect(duplicate.success).toBe(false);
    expect(duplicate.message).toContain('用户已存在');

    const invalid = await permissionsCommand.execute('user add "bad name"', {});
    expect(invalid.success).toBe(false);
    expect(invalid.message).toContain('用户名只允许');
  });

  test('role：修改用户角色', async () => {
    rbacState.users = [
      {
        id: 'alice',
        name: 'alice',
        roles: [RoleType.GUEST],
        permissions: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    const result = await permissionsCommand.execute(
      'user role alice admin',
      {}
    );
    expect(result.success).toBe(true);
    expect(rbacState.users[0].roles).toEqual(['admin']);
  });

  test('bind / unbind：写入 userId 绑定的 deny 规则', async () => {
    rbacState.users = [
      {
        id: 'alice',
        name: 'alice',
        roles: [RoleType.GUEST],
        permissions: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    const bound = await permissionsCommand.execute(
      'user bind alice bash deny all',
      {}
    );
    expect(bound.success).toBe(true);
    expect(rbacState.rules[0]).toMatchObject({
      resourceId: 'bash',
      userId: 'alice',
      action: 'deny',
      operation: 'all',
    });

    const unbound = await permissionsCommand.execute(
      'user unbind alice bash',
      {}
    );
    expect(unbound.success).toBe(true);
    expect(rbacState.rules).toEqual([]);
  });

  test('bind：未知用户被拒', async () => {
    const result = await permissionsCommand.execute('user bind bob bash', {});
    expect(result.success).toBe(false);
    expect(result.message).toContain('未找到用户: bob');
  });

  test('bind allow / ask：行为写入规则，默认仍是 deny', async () => {
    rbacState.users = [
      {
        id: 'alice',
        name: 'alice',
        roles: [RoleType.GUEST],
        permissions: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    const allow = await permissionsCommand.execute(
      'user bind alice bash allow',
      {}
    );
    expect(allow.success).toBe(true);
    expect(rbacState.rules[0]).toMatchObject({
      userId: 'alice',
      action: 'allow',
      operation: 'execute',
    });

    const ask = await permissionsCommand.execute(
      'user bind alice bash ask',
      {}
    );
    expect(ask.success).toBe(true);
    expect(rbacState.rules[1]).toMatchObject({ action: 'ask' });

    const deny = await permissionsCommand.execute('user bind alice bash', {});
    expect(deny.success).toBe(true);
    expect(rbacState.rules[2]).toMatchObject({ action: 'deny' });
  });
});

describe('/permissions resource 写入与绑定', () => {
  test('add / list：写入资源并按路径展示绑定数量', async () => {
    const added = await permissionsCommand.execute(
      'resource add tool bash',
      {}
    );
    expect(added.success).toBe(true);
    expect(rbacState.resources[0]).toMatchObject({
      type: 'tool',
      path: 'bash',
      name: 'bash',
    });

    const duplicate = await permissionsCommand.execute(
      'resource add tool bash',
      {}
    );
    expect(duplicate.success).toBe(false);
    expect(duplicate.message).toContain('资源已存在');

    const list = await permissionsCommand.execute('resource list', {});
    expect(list.success).toBe(true);
    expect(list.message).toContain('tool bash（0 条绑定）');
  });

  test('add：非法资源类型被拒', async () => {
    const result = await permissionsCommand.execute('resource add db x', {});
    expect(result.success).toBe(false);
    expect(result.message).toContain('无效的资源类型: db');
  });

  test('bind / unbind：以资源路径作为 resourceId 写入 deny 规则', async () => {
    rbacState.resources = [
      {
        id: 'res_1',
        type: 'tool' as Resource['type'],
        name: 'bash',
        path: 'bash',
      },
    ];

    const bound = await permissionsCommand.execute(
      'resource bind tool bash',
      {}
    );
    expect(bound.success).toBe(true);
    expect(rbacState.rules[0]).toMatchObject({
      resourceId: 'bash',
      action: 'deny',
      operation: 'execute',
    });

    const unbound = await permissionsCommand.execute(
      'resource unbind tool bash',
      {}
    );
    expect(unbound.success).toBe(true);
    expect(rbacState.rules).toEqual([]);
  });

  test('bind：资源不存在时给出下一步命令', async () => {
    const result = await permissionsCommand.execute(
      'resource bind tool bash',
      {}
    );
    expect(result.success).toBe(false);
    expect(result.message).toContain('未找到资源: tool bash');
  });

  test('bind allow：资源绑定同样支持行为档', async () => {
    rbacState.resources = [
      {
        id: 'res_1',
        type: 'tool' as Resource['type'],
        name: 'bash',
        path: 'bash',
      },
    ];

    const result = await permissionsCommand.execute(
      'resource bind tool bash allow all',
      {}
    );
    expect(result.success).toBe(true);
    expect(rbacState.rules[0]).toMatchObject({
      resourceId: 'bash',
      action: 'allow',
      operation: 'all',
    });
  });
});

describe('/permissions 删除能力（角色 / 用户 / 资源）', () => {
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

  test('role remove：连带绑定规则，并从用户角色里摘除', async () => {
    rbacState.roles = [
      {
        id: 'guest',
        name: RoleType.GUEST,
        permissions: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    rbacState.users = [
      {
        id: 'alice',
        name: 'alice',
        roles: [RoleType.GUEST],
        permissions: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    rbacState.rules = [
      rule({ id: 'r-role', roleId: 'guest' }),
      rule({ id: 'r-resource' }),
    ];

    const result = await permissionsCommand.execute('role remove guest', {});

    expect(result.success).toBe(true);
    expect(result.message).toContain('连带 1 条绑定规则');
    expect(result.message).toContain('从 1 个用户的角色里摘除');
    expect(rbacState.roles).toEqual([]);
    expect(rbacState.users[0].roles).toEqual([]);
    expect(rbacState.rules.map((item) => item.id)).toEqual(['r-resource']);
  });

  test('role remove：未知角色被拒', async () => {
    const result = await permissionsCommand.execute('role remove ghost', {});
    expect(result.success).toBe(false);
    expect(result.message).toContain('未找到角色: ghost');
  });

  test('user remove：连带其绑定规则', async () => {
    rbacState.users = [
      {
        id: 'alice',
        name: 'alice',
        roles: [RoleType.GUEST],
        permissions: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    rbacState.rules = [
      rule({ id: 'r-user', userId: 'alice' }),
      rule({ id: 'r-role', roleId: 'guest' }),
    ];

    const result = await permissionsCommand.execute('user remove alice', {});

    expect(result.success).toBe(true);
    expect(result.message).toContain('连带 1 条绑定规则');
    expect(rbacState.users).toEqual([]);
    expect(rbacState.rules.map((item) => item.id)).toEqual(['r-role']);
  });

  test('resource remove：只删资源绑定，不动同名角色绑定', async () => {
    rbacState.resources = [
      {
        id: 'res_1',
        type: 'tool' as Resource['type'],
        name: 'bash',
        path: 'bash',
      },
    ];
    rbacState.rules = [
      rule({ id: 'r-resource' }),
      rule({ id: 'r-role', roleId: 'guest' }),
    ];

    const result = await permissionsCommand.execute(
      'resource remove tool bash',
      {}
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain('连带 1 条绑定规则');
    expect(rbacState.resources).toEqual([]);
    expect(rbacState.rules.map((item) => item.id)).toEqual(['r-role']);
  });

  test('resource remove：未知资源被拒', async () => {
    const result = await permissionsCommand.execute(
      'resource remove tool bash',
      {}
    );
    expect(result.success).toBe(false);
    expect(result.message).toContain('未找到资源: tool bash');
  });
});
