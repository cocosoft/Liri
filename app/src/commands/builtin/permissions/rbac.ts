/**
 * 细粒度 RBAC 子命令（`/permissions resource|role|user`）
 *
 * 数据落点（`resolvePermissionsDir()`）：`roles.json` / `users.json` / `resources.json` / `rules.json`。
 * **实例级策略**（与 `tool_rules.json` 同源，不按租户存储）：多租户部署下由管理面
 * （`/v1/permissions/rbac`，读 + 写均需 admin）访问，不随租户隔离（P1-1，2026-11-11 裁定）。
 *
 * 与工具规则（`tool_rules.json`，`/permissions grant|add`）是两套数据：
 * - 工具规则：按工具名 allow / deny / ask；
 * - RBAC：规则绑定到 **角色 / 用户 / 资源**，工具调用判定时由
 *   `PermissionManager.checkFineGrainedRules` 消费，优先级 **deny > ask > allow**：
 *   deny 在一切 ask/allow 之前返回；ask 在工具级 ask 之后、allow 之前；allow 最后兜底。
 *   资源绑定仅支持 `tool` 型（路径 = 工具名），其余类型不参与判定（add / bind 处拒绝）。
 *
 * 绑定档：`deny` / `allow` / `ask`（默认 `deny`，操作默认 `execute`）。
 */
import type { CommandResult } from '@modules/commands';
import {
  OperationType,
  PermissionAction,
  ResourceType,
  RoleType,
  type FineGrainedPermissionRule,
  type Resource,
  type Role,
  type User,
} from '@openliri/infra/permission';
import { randomIdSuffix } from '@openliri/infra/utils/common';
import { handleError } from '@openliri/infra/error';
// P3-11（2026-11-11）：绑定前校验工具存在（与工具面同一注册表，不另建名单）
import { getToolRegistry } from '@modules/tools';
import { liveFineGrainedManager } from './liveFineGrainedManager.js';

const ROLE_NAMES = Object.values(RoleType);
const RESOURCE_TYPES = Object.values(ResourceType);
/**
 * 可**添加 / 绑定**的资源类型（2026-11-11 收窄，修复「资源绑定空转」）。
 *
 * 判定链（`PermissionManager.checkFineGrainedRules`）只拿**工具名**去查资源规则
 * （`getRulesByResource(toolName)`）⇒ 只有 `tool` 型（路径 = 工具名）会真正参与
 * allow / ask / deny。其余类型（file/directory/api/command/system）当前**没有判定消费者**，
 * 允许添加/绑定只会产生「看起来配了、实际不生效」的空绑定 ⇒ 在此明确拒绝。
 *
 * `list` / `remove` / `unbind` 仍接受全部类型，用于清理历史数据。
 */
const BINDABLE_RESOURCE_TYPES = [ResourceType.TOOL] as const;
/**
 * 受保护的**内置角色**（P2-7，2026-11-11）：删除会让关键映射/约定失效。
 * - `admin`：本地身份的判定角色（`getEffectivePermissionRole` 映射目标）；
 * - `system`：保留角色（内部/后台语义）。
 * 其余内置角色（user / guest）可删，必要时用 `role add` 重建。
 */
const PROTECTED_ROLE_NAMES: readonly RoleType[] = [
  RoleType.ADMIN,
  RoleType.SYSTEM,
];
/** 工具判定只认这两个操作档（见 `checkFineGrainedRules`） */
const BIND_OPERATIONS = [OperationType.EXECUTE, OperationType.ALL] as const;
/** 可绑定的行为档（判定链按 deny > ask > allow 消费） */
const BIND_ACTIONS = [
  PermissionAction.DENY,
  PermissionAction.ALLOW,
  PermissionAction.ASK,
] as const;

const MODULE = 'commands:builtin:permissions:rbac';

function newRuleId(): string {
  return `rbac_${Date.now()}_${randomIdSuffix(6)}`;
}

function usage(message: string): CommandResult {
  return { success: false, message };
}

function failure(
  error: unknown,
  action: string,
  prefix: string
): CommandResult {
  handleError(error, { module: MODULE, action });
  return {
    success: false,
    message: `${prefix}: ${error instanceof Error ? error.message : '未知错误'}`,
  };
}

function parseBindOperation(raw?: string): OperationType | undefined {
  if (!raw) return OperationType.EXECUTE;
  return BIND_OPERATIONS.find((operation) => operation === raw);
}

function parseBindAction(raw?: string): PermissionAction | undefined {
  if (!raw) return PermissionAction.DENY;
  return BIND_ACTIONS.find((action) => action === raw);
}

/**
 * P3-11（2026-11-11）：工具名存在性校验（绑定/添加资源前）。
 *
 * 返回 `undefined` ⇒ 通过（含**无法判断**的情形）；返回字符串 ⇒ 拒绝原因。
 * 无法判断 = 工具注册表尚未加载（启动早期 / 单测）—— 此时不做假拒绝。
 * 别名校验同源（`getToolByAlias`），避免把 `shell` 一类别名误判成不存在。
 */
function unresolvableToolName(toolName: string): string | undefined {
  const registry = getToolRegistry();
  if (registry.getToolNames().length === 0) return undefined;
  if (registry.hasTool(toolName) || registry.getToolByAlias(toolName)) {
    return undefined;
  }
  return (
    `未找到工具: ${toolName}\n` +
    '用 /tools list 查看（MCP / 插件工具需先加载后再绑定）'
  );
}

/** 绑定规则（resourceId 固定为**工具名 / 资源路径**，与判定口径一致） */
function createBindRule(params: {
  resourceId: string;
  action: PermissionAction;
  operation: OperationType;
  roleId?: string;
  userId?: string;
}): FineGrainedPermissionRule {
  const now = Date.now();
  return {
    id: newRuleId(),
    resourceId: params.resourceId,
    operation: params.operation,
    action: params.action,
    ...(params.roleId ? { roleId: params.roleId } : {}),
    ...(params.userId ? { userId: params.userId } : {}),
    priority: 0,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 角色：list / add / remove / bind / unbind
 */
export async function handleRoleCommand(
  args: string[]
): Promise<CommandResult> {
  const [sub, ...rest] = args;
  switch (sub) {
    case 'list':
      return listRoles();
    case 'add':
      return addRole(rest);
    case 'remove':
      return removeRole(rest);
    case 'bind':
      return bindRole(rest);
    case 'unbind':
      return unbindRole(rest);
    default:
      return usage(
        '用法: /permissions role <list|add|remove|bind|unbind>\n\n' +
          '  list                              列出角色与绑定数量\n' +
          '  add <角色名> [描述]                添加角色（admin/user/guest/system）\n' +
          '  remove <角色名>                    删除角色（连带其绑定规则）\n' +
          '  bind <角色名> <工具名> [deny|allow|ask] [execute|all] 绑定规则（默认 deny/execute）\n' +
          '  unbind <角色名> <工具名>            移除该角色对此工具的绑定'
      );
  }
}

async function listRoles(): Promise<CommandResult> {
  try {
    const storage = liveFineGrainedManager().getStorage();
    const roles = await storage.getAllRoles();
    if (roles.length === 0) return { success: true, message: '暂无角色' };

    const lines = ['角色列表:'];
    for (const role of roles) {
      const rules = await storage.getRulesByRole(role.id);
      lines.push(
        `- ${role.name}${role.description ? `（${role.description}）` : ''}：绑定规则 ${rules.length} 条`
      );
    }
    return { success: true, message: lines.join('\n') };
  } catch (error) {
    return failure(error, 'listRoles', '查询失败');
  }
}

async function addRole(params: string[]): Promise<CommandResult> {
  const [name, ...descParts] = params;
  if (!name) {
    return usage(
      `用法: /permissions role add <角色名> [描述]\n可用角色: ${ROLE_NAMES.join(', ')}`
    );
  }
  if (!ROLE_NAMES.includes(name as RoleType)) {
    return usage(
      `无效的角色名: ${name}\n可用角色: ${ROLE_NAMES.join(', ')}（角色名即判定时的用户角色）`
    );
  }

  try {
    const manager = liveFineGrainedManager();
    const storage = manager.getStorage();
    const existing = await storage.getRoleByName(name as RoleType);
    if (existing) {
      return usage(`角色已存在: ${name}`);
    }

    const now = Date.now();
    const role: Role = {
      id: name,
      name: name as RoleType,
      ...(descParts.length > 0 ? { description: descParts.join(' ') } : {}),
      permissions: [],
      createdAt: now,
      updatedAt: now,
    };
    await storage.saveRole(role);
    return { success: true, message: `已添加角色 ${name}（id: ${role.id}）` };
  } catch (error) {
    return failure(error, 'addRole', '添加失败');
  }
}

async function bindRole(params: string[]): Promise<CommandResult> {
  const [roleName, toolName, actionRaw, operationRaw] = params;
  if (!roleName || !toolName) {
    return usage(
      '用法: /permissions role bind <角色名> <工具名> [deny|allow|ask] [execute|all]\n' +
        '示例: /permissions role bind guest bash allow'
    );
  }
  const action = parseBindAction(actionRaw);
  if (!action) {
    return usage(
      `无效的行为: ${actionRaw}\n可用行为: ${BIND_ACTIONS.join(', ')}`
    );
  }
  const operation = parseBindOperation(operationRaw);
  if (!operation) {
    return usage(
      `无效的操作: ${operationRaw}\n可用操作: ${BIND_OPERATIONS.join(', ')}`
    );
  }
  const unresolved = unresolvableToolName(toolName);
  if (unresolved) return usage(unresolved);

  try {
    const manager = liveFineGrainedManager();
    const storage = manager.getStorage();
    const role = await storage.getRoleByName(roleName as RoleType);
    if (!role) {
      return usage(
        `未找到角色: ${roleName}\n先用 /permissions role list 查看，或 /permissions role add 添加`
      );
    }

    const rules = await storage.getRulesByRole(role.id);
    const existing = rules.find(
      (rule) =>
        rule.resourceId === toolName &&
        rule.action === action &&
        rule.operation === operation
    );
    if (existing) {
      return {
        success: true,
        message: `角色 ${roleName} 已绑定 ${action} ${toolName}(${operation})（规则 ${existing.id}）`,
      };
    }

    const rule = createBindRule({
      resourceId: toolName,
      action,
      operation,
      roleId: role.id,
    });
    await manager.addRule(rule);
    return {
      success: true,
      message: `已为角色 ${roleName} 绑定 ${action} ${toolName}(${operation})，规则 ${rule.id}；工具判定立即生效`,
    };
  } catch (error) {
    return failure(error, 'bindRole', '绑定失败');
  }
}

async function unbindRole(params: string[]): Promise<CommandResult> {
  const [roleName, toolName] = params;
  if (!roleName || !toolName) {
    return usage('用法: /permissions role unbind <角色名> <工具名>');
  }

  try {
    const manager = liveFineGrainedManager();
    const storage = manager.getStorage();
    const role = await storage.getRoleByName(roleName as RoleType);
    if (!role) return usage(`未找到角色: ${roleName}`);

    const matched = (await storage.getRulesByRole(role.id)).filter(
      (rule) => rule.resourceId === toolName
    );
    if (matched.length === 0) {
      return {
        success: true,
        message: `角色 ${roleName} 未绑定工具 ${toolName}`,
      };
    }
    for (const rule of matched) await manager.deleteRule(rule.id);
    return {
      success: true,
      message: `已移除角色 ${roleName} 对 ${toolName} 的 ${matched.length} 条绑定`,
    };
  } catch (error) {
    return failure(error, 'unbindRole', '移除失败');
  }
}

/**
 * 删除角色：连带其绑定规则，并从用户的角色列表里摘掉（避免悬空引用）
 */
async function removeRole(params: string[]): Promise<CommandResult> {
  const [roleName] = params;
  if (!roleName) {
    return usage('用法: /permissions role remove <角色名>');
  }

  try {
    const manager = liveFineGrainedManager();
    const storage = manager.getStorage();
    const role = await storage.getRoleByName(roleName as RoleType);
    if (!role) return usage(`未找到角色: ${roleName}`);

    // P2-7（2026-11-11）：内置关键角色不可删（删除会让本地身份的 admin 映射静默失效）
    if (PROTECTED_ROLE_NAMES.includes(role.name)) {
      return usage(
        `内置角色 ${roleName} 不能删除（本地身份的判定角色映射到 admin）\n` +
          `只需清理绑定时用 /permissions role unbind ${roleName} <工具名>`
      );
    }

    const rules = await storage.getRulesByRole(role.id);
    for (const rule of rules) await manager.deleteRule(rule.id);

    const users = await storage.getAllUsers();
    let detachedUsers = 0;
    for (const user of users) {
      if (!user.roles.includes(roleName as RoleType)) continue;
      await storage.updateUser({
        ...user,
        roles: user.roles.filter((name) => name !== roleName),
        updatedAt: Date.now(),
      });
      detachedUsers += 1;
    }

    await storage.deleteRole(role.id);
    return {
      success: true,
      message:
        `已删除角色 ${roleName}（连带 ${rules.length} 条绑定规则` +
        `${detachedUsers > 0 ? `，并从 ${detachedUsers} 个用户的角色里摘除` : ''}）`,
    };
  } catch (error) {
    return failure(error, 'removeRole', '删除失败');
  }
}

/**
 * 用户：list / add / remove / role / bind / unbind
 */
export async function handleUserCommand(
  args: string[]
): Promise<CommandResult> {
  const [sub, ...rest] = args;
  switch (sub) {
    case 'list':
      return listUsers();
    case 'add':
      return addUser(rest);
    case 'remove':
      return removeUser(rest);
    case 'role':
      return setUserRole(rest);
    case 'bind':
      return bindUser(rest);
    case 'unbind':
      return unbindUser(rest);
    default:
      return usage(
        '用法: /permissions user <list|add|remove|role|bind|unbind>\n\n' +
          '  list                              列出用户与角色\n' +
          '  add <用户名> [角色名]              添加用户（默认 guest）\n' +
          '  remove <用户名>                    删除用户（连带其绑定规则）\n' +
          '  role <用户名> <角色名>             修改用户角色\n' +
          '  bind <用户名> <工具名> [deny|allow|ask] [execute|all] 绑定规则（默认 deny/execute）\n' +
          '  unbind <用户名> <工具名>            移除该用户对此工具的绑定'
      );
  }
}

const USER_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;
/** P2-8：`user bind` 自动登记用户时的提示尾注（口径唯一） */
const AUTO_REGISTERED_NOTE =
  '\n（该用户此前未登记，已自动登记；名称须与登录身份 userId 一致）';

async function listUsers(): Promise<CommandResult> {
  try {
    const storage = liveFineGrainedManager().getStorage();
    const users = await storage.getAllUsers();
    if (users.length === 0) return { success: true, message: '暂无用户' };

    const lines = ['用户列表:'];
    for (const user of users) {
      const rules = await storage.getRulesByUser(user.id);
      lines.push(
        `- ${user.name}（id: ${user.id}，角色: ${user.roles.join(', ')}）：绑定规则 ${rules.length} 条`
      );
    }
    return { success: true, message: lines.join('\n') };
  } catch (error) {
    return failure(error, 'listUsers', '查询失败');
  }
}

async function addUser(params: string[]): Promise<CommandResult> {
  const [name, roleRaw] = params;
  if (!name) {
    return usage(
      '用法: /permissions user add <用户名> [角色名]\n' +
        `角色可选: ${ROLE_NAMES.join(', ')}（默认 guest）`
    );
  }
  if (!USER_NAME_PATTERN.test(name)) {
    return usage('用户名只允许字母、数字、下划线、点和连字符（1-64 位）');
  }
  const roleName = roleRaw ?? RoleType.GUEST;
  if (!ROLE_NAMES.includes(roleName as RoleType)) {
    return usage(
      `无效的角色名: ${roleName}\n可用角色: ${ROLE_NAMES.join(', ')}`
    );
  }

  try {
    const manager = liveFineGrainedManager();
    const storage = manager.getStorage();
    const existing = await storage.getUserByName(name);
    if (existing) return usage(`用户已存在: ${name}`);

    const now = Date.now();
    const user: User = {
      id: name,
      name,
      roles: [roleName as RoleType],
      permissions: [],
      createdAt: now,
      updatedAt: now,
    };
    await storage.saveUser(user);
    return {
      success: true,
      message: `已添加用户 ${name}（角色: ${roleName}）`,
    };
  } catch (error) {
    return failure(error, 'addUser', '添加失败');
  }
}

async function setUserRole(params: string[]): Promise<CommandResult> {
  const [name, roleRaw] = params;
  if (!name || !roleRaw) {
    return usage('用法: /permissions user role <用户名> <角色名>');
  }
  if (!ROLE_NAMES.includes(roleRaw as RoleType)) {
    return usage(
      `无效的角色名: ${roleRaw}\n可用角色: ${ROLE_NAMES.join(', ')}`
    );
  }

  try {
    const manager = liveFineGrainedManager();
    const storage = manager.getStorage();
    const user = await storage.getUserByName(name);
    if (!user) return usage(`未找到用户: ${name}`);

    await storage.updateUser({
      ...user,
      roles: [roleRaw as RoleType],
      updatedAt: Date.now(),
    });
    return { success: true, message: `用户 ${name} 的角色已改为 ${roleRaw}` };
  } catch (error) {
    return failure(error, 'setUserRole', '修改失败');
  }
}

async function bindUser(params: string[]): Promise<CommandResult> {
  const [name, toolName, actionRaw, operationRaw] = params;
  if (!name || !toolName) {
    return usage(
      '用法: /permissions user bind <用户名> <工具名> [deny|allow|ask] [execute|all]\n' +
        '示例: /permissions user bind alice bash allow'
    );
  }
  const action = parseBindAction(actionRaw);
  if (!action) {
    return usage(
      `无效的行为: ${actionRaw}\n可用行为: ${BIND_ACTIONS.join(', ')}`
    );
  }
  const operation = parseBindOperation(operationRaw);
  if (!operation) {
    return usage(
      `无效的操作: ${operationRaw}\n可用操作: ${BIND_OPERATIONS.join(', ')}`
    );
  }
  // P2-8（2026-11-11）：用户名即登录身份 id（`Principal.userId`），先校验形状
  if (!USER_NAME_PATTERN.test(name)) {
    return usage(
      '用户名只允许字母、数字、下划线、点和连字符（1-64 位）\n' +
        '该名称必须与登录身份 userId 一致，绑定才会命中'
    );
  }
  const unresolved = unresolvableToolName(toolName);
  if (unresolved) return usage(unresolved);

  try {
    const manager = liveFineGrainedManager();
    const storage = manager.getStorage();
    let user = await storage.getUserByName(name);
    // P2-8（2026-11-11）：不再要求先手工 `user add` —— 直接按登录 userId 登记，
    // 避免「绑定时报未找到用户、但其实只是没登记」的假摩擦。
    const autoRegistered = !user;
    if (!user) {
      user = {
        id: name,
        name,
        roles: [RoleType.GUEST],
        permissions: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await storage.saveUser(user);
    }

    const rules = await storage.getRulesByUser(user.id);
    const existing = rules.find(
      (rule) =>
        rule.resourceId === toolName &&
        rule.action === action &&
        rule.operation === operation
    );
    if (existing) {
      return {
        success: true,
        message:
          `用户 ${name} 已绑定 ${action} ${toolName}(${operation})（规则 ${existing.id}）` +
          (autoRegistered ? AUTO_REGISTERED_NOTE : ''),
      };
    }

    const rule = createBindRule({
      resourceId: toolName,
      action,
      operation,
      userId: user.id,
    });
    await manager.addRule(rule);
    return {
      success: true,
      message:
        `已为用户 ${name} 绑定 ${action} ${toolName}(${operation})，规则 ${rule.id}；工具判定立即生效` +
        (autoRegistered ? AUTO_REGISTERED_NOTE : ''),
    };
  } catch (error) {
    return failure(error, 'bindUser', '绑定失败');
  }
}

async function unbindUser(params: string[]): Promise<CommandResult> {
  const [name, toolName] = params;
  if (!name || !toolName) {
    return usage('用法: /permissions user unbind <用户名> <工具名>');
  }

  try {
    const manager = liveFineGrainedManager();
    const storage = manager.getStorage();
    const user = await storage.getUserByName(name);
    if (!user) return usage(`未找到用户: ${name}`);

    const matched = (await storage.getRulesByUser(user.id)).filter(
      (rule) => rule.resourceId === toolName
    );
    if (matched.length === 0) {
      return { success: true, message: `用户 ${name} 未绑定工具 ${toolName}` };
    }
    for (const rule of matched) await manager.deleteRule(rule.id);
    return {
      success: true,
      message: `已移除用户 ${name} 对 ${toolName} 的 ${matched.length} 条绑定`,
    };
  } catch (error) {
    return failure(error, 'unbindUser', '移除失败');
  }
}

/**
 * 删除用户：连带其绑定规则
 */
async function removeUser(params: string[]): Promise<CommandResult> {
  const [name] = params;
  if (!name) {
    return usage('用法: /permissions user remove <用户名>');
  }

  try {
    const manager = liveFineGrainedManager();
    const storage = manager.getStorage();
    const user = await storage.getUserByName(name);
    if (!user) return usage(`未找到用户: ${name}`);

    const rules = await storage.getRulesByUser(user.id);
    for (const rule of rules) await manager.deleteRule(rule.id);
    await storage.deleteUser(user.id);

    return {
      success: true,
      message: `已删除用户 ${name}（连带 ${rules.length} 条绑定规则）`,
    };
  } catch (error) {
    return failure(error, 'removeUser', '删除失败');
  }
}

/**
 * 资源：list / add / remove / bind / unbind
 *
 * 绑定以**资源路径**作为规则的 `resourceId`，而判定链用**工具名**去查
 * （`checkFineGrainedRules` 的 `getRulesByResource(toolName)`）⇒ 只有 `tool` 型
 * （路径 = 工具名）真正生效；其余类型在 add / bind 处显式拒绝，不再产生空绑定。
 */
export async function handleResourceCommand(
  args: string[]
): Promise<CommandResult> {
  const [sub, ...rest] = args;
  switch (sub) {
    case 'list':
      return listResources();
    case 'add':
      return addResource(rest);
    case 'remove':
      return removeResource(rest);
    case 'bind':
      return bindResource(rest);
    case 'unbind':
      return unbindResource(rest);
    default:
      return usage(
        '用法: /permissions resource <list|add|remove|bind|unbind>\n\n' +
          `  list                              列出资源（类型: ${RESOURCE_TYPES.join('/')}）\n` +
          `  add <类型> <路径>                  添加资源（仅 ${BINDABLE_RESOURCE_TYPES.join('/')}，路径 = 工具名）\n` +
          '  remove <类型> <路径>               删除资源（连带其绑定规则）\n' +
          '  bind <类型> <路径> [deny|allow|ask] [execute|all] 绑定规则（默认 deny/execute）\n' +
          '  unbind <类型> <路径>               移除该资源的绑定'
      );
  }
}

function parseResourceType(raw?: string): ResourceType | undefined {
  return RESOURCE_TYPES.find((type) => type === raw);
}

/** 非 `tool` 类型的拒绝文案（添加/绑定共用，口径唯一） */
function resourceTypeNotBindable(type: ResourceType): string {
  return (
    `资源类型 ${type} 不参与权限判定（判定链只按工具名查资源规则）\n` +
    '请改用: /permissions resource add tool <工具名>（或 bind）\n' +
    `可用类型: ${BINDABLE_RESOURCE_TYPES.join(', ')}\n` +
    '（list / remove / unbind 仍支持全部类型，便于清理历史数据）'
  );
}

/**
 * 只保留「资源绑定」规则：同一份 `rules.json` 里角色/用户绑定的规则也用
 * `resourceId = 工具名`，混进来会把别人的绑定算成资源的、甚至被 unbind 顺手删掉。
 */
function resourceOnlyRules(
  rules: FineGrainedPermissionRule[]
): FineGrainedPermissionRule[] {
  return rules.filter((rule) => !rule.roleId && !rule.userId);
}

async function listResources(): Promise<CommandResult> {
  try {
    const storage = liveFineGrainedManager().getStorage();
    const resources = await storage.getAllResources();
    if (resources.length === 0) return { success: true, message: '暂无资源' };

    const lines = ['资源列表:'];
    for (const resource of resources) {
      const rules = resourceOnlyRules(
        await storage.getRulesByResource(resource.path ?? '')
      );
      lines.push(
        `- ${resource.type} ${resource.path ?? resource.name}（${rules.length} 条绑定）`
      );
    }
    return { success: true, message: lines.join('\n') };
  } catch (error) {
    return failure(error, 'listResources', '查询失败');
  }
}

async function addResource(params: string[]): Promise<CommandResult> {
  const [typeRaw, path] = params;
  if (!typeRaw || !path) {
    return usage(
      `用法: /permissions resource add <类型> <路径>\n可用类型: ${BINDABLE_RESOURCE_TYPES.join(', ')}（路径 = 工具名）`
    );
  }
  const type = parseResourceType(typeRaw);
  if (!type) {
    return usage(
      `无效的资源类型: ${typeRaw}\n可用类型: ${RESOURCE_TYPES.join(', ')}`
    );
  }
  if (!BINDABLE_RESOURCE_TYPES.includes(type as ResourceType.TOOL)) {
    return usage(resourceTypeNotBindable(type));
  }
  // P3-11：工具类资源的「路径」就是工具名 ⇒ 添加时先校验存在
  const unresolved = unresolvableToolName(path);
  if (unresolved) return usage(unresolved);

  try {
    const manager = liveFineGrainedManager();
    const storage = manager.getStorage();
    const existing = await storage.getResourceByPath(path, type);
    if (existing) {
      return usage(`资源已存在: ${type} ${path}（id: ${existing.id}）`);
    }

    const now = Date.now();
    const resource: Resource = {
      id: `res_${now}_${randomIdSuffix(6)}`,
      type,
      name: path.split(/[\\/]/).pop() || path,
      path,
      description: `${type} ${path}`,
    };
    await manager.addResource(resource);
    return {
      success: true,
      message: `已添加资源 ${type} ${path}（id: ${resource.id}）`,
    };
  } catch (error) {
    return failure(error, 'addResource', '添加失败');
  }
}

async function bindResource(params: string[]): Promise<CommandResult> {
  const [typeRaw, path, actionRaw, operationRaw] = params;
  if (!typeRaw || !path) {
    return usage(
      '用法: /permissions resource bind <类型> <路径> [deny|allow|ask] [execute|all]\n' +
        `可用类型: ${BINDABLE_RESOURCE_TYPES.join(', ')}（路径 = 工具名）\n` +
        '示例: /permissions resource bind tool bash allow'
    );
  }
  const type = parseResourceType(typeRaw);
  if (!type) {
    return usage(
      `无效的资源类型: ${typeRaw}\n可用类型: ${RESOURCE_TYPES.join(', ')}`
    );
  }
  if (!BINDABLE_RESOURCE_TYPES.includes(type as ResourceType.TOOL)) {
    return usage(resourceTypeNotBindable(type));
  }
  // P3-11：工具类资源的「路径」就是工具名 ⇒ 绑定前先校验存在
  const unresolved = unresolvableToolName(path);
  if (unresolved) return usage(unresolved);
  const action = parseBindAction(actionRaw);
  if (!action) {
    return usage(
      `无效的行为: ${actionRaw}\n可用行为: ${BIND_ACTIONS.join(', ')}`
    );
  }
  const operation = parseBindOperation(operationRaw);
  if (!operation) {
    return usage(
      `无效的操作: ${operationRaw}\n可用操作: ${BIND_OPERATIONS.join(', ')}`
    );
  }

  try {
    const manager = liveFineGrainedManager();
    const storage = manager.getStorage();
    const resource = await storage.getResourceByPath(path, type);
    if (!resource) {
      return usage(
        `未找到资源: ${type} ${path}\n先用 /permissions resource add ${type} ${path} 添加`
      );
    }

    const rules = resourceOnlyRules(await storage.getRulesByResource(path));
    const existing = rules.find(
      (rule) =>
        rule.resourceId === path &&
        rule.action === action &&
        rule.operation === operation
    );
    if (existing) {
      return {
        success: true,
        message: `资源 ${path} 已绑定 ${action}(${operation})（规则 ${existing.id}）`,
      };
    }

    const rule = createBindRule({ resourceId: path, action, operation });
    await manager.addRule(rule);
    return {
      success: true,
      message: `已为资源 ${path} 绑定 ${action}(${operation})，规则 ${rule.id}；判定立即生效`,
    };
  } catch (error) {
    return failure(error, 'bindResource', '绑定失败');
  }
}

async function unbindResource(params: string[]): Promise<CommandResult> {
  const [typeRaw, path] = params;
  if (!typeRaw || !path) {
    return usage('用法: /permissions resource unbind <类型> <路径>');
  }
  const type = parseResourceType(typeRaw);
  if (!type) {
    return usage(
      `无效的资源类型: ${typeRaw}\n可用类型: ${RESOURCE_TYPES.join(', ')}`
    );
  }

  try {
    const manager = liveFineGrainedManager();
    const storage = manager.getStorage();
    const resource = await storage.getResourceByPath(path, type);
    if (!resource) return usage(`未找到资源: ${type} ${path}`);

    const matched = resourceOnlyRules(
      await storage.getRulesByResource(path)
    ).filter((rule) => rule.resourceId === path);
    if (matched.length === 0) {
      return { success: true, message: `资源 ${path} 暂无绑定` };
    }
    for (const rule of matched) await manager.deleteRule(rule.id);
    return {
      success: true,
      message: `已移除资源 ${path} 的 ${matched.length} 条绑定`,
    };
  } catch (error) {
    return failure(error, 'unbindResource', '移除失败');
  }
}

/**
 * 删除资源：连带其**资源绑定**规则（不碰角色/用户绑定的同名规则）
 */
async function removeResource(params: string[]): Promise<CommandResult> {
  const [typeRaw, path] = params;
  if (!typeRaw || !path) {
    return usage('用法: /permissions resource remove <类型> <路径>');
  }
  const type = parseResourceType(typeRaw);
  if (!type) {
    return usage(
      `无效的资源类型: ${typeRaw}\n可用类型: ${RESOURCE_TYPES.join(', ')}`
    );
  }

  try {
    const manager = liveFineGrainedManager();
    const storage = manager.getStorage();
    const resource = await storage.getResourceByPath(path, type);
    if (!resource) return usage(`未找到资源: ${type} ${path}`);

    const rules = resourceOnlyRules(await storage.getRulesByResource(path));
    for (const rule of rules) await manager.deleteRule(rule.id);
    await storage.deleteResource(resource.id);

    return {
      success: true,
      message: `已删除资源 ${type} ${path}（连带 ${rules.length} 条绑定规则）`,
    };
  } catch (error) {
    return failure(error, 'removeResource', '删除失败');
  }
}
