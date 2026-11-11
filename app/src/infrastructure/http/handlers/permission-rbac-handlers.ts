/**
 * permission-rbac-handlers.ts — 细粒度 RBAC（D 体系）HTTP 入口
 *
 * 2026-11-11：**撤销 P3-3 第二步**（2026-11-03 曾摘除 D 体系的 HTTP/UI 入口）。
 * 撤销理由：CLI 已补齐 RBAC 的写入 / 绑定 / 解绑 / 删除
 * （`/permissions role|user|resource`），前端面板需要同源数据；为此重新开放
 * HTTP 入口，且**写操作直接复用命令层实现**（单一实现，不另写一套增删改）。
 *
 * 路由：
 * - `GET  /v1/permissions/rbac` → 角色/用户/资源/绑定快照（结构化，供面板渲染）
 * - `POST /v1/permissions/rbac` → `{ command: 'role bind guest bash' }`
 *   （CLI 子命令串，经 `CommandsOpsPort` 交给**同一个**命令执行器 ⇒ 行为不漂移）
 *
 * 安全：该前缀已登记在 `adminWriteRoutes`（`/v1/permissions`），写请求受管理面校验。
 */
import type http from 'http';
import { sendError, readRequestBody } from './handler-utils';
import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';
import { getFineGrainedPermissionManager } from '@openliri/infra/permission';

/** 允许经 HTTP 触达的 RBAC 子域（与 CLI 的三个子命令一一对应） */
const RBAC_AREAS = ['role', 'user', 'resource'] as const;
type RbacArea = (typeof RBAC_AREAS)[number];

export interface RbacBindingView {
  id: string;
  resourceId: string;
  operation: string;
  action: string;
  roleId?: string;
  userId?: string;
  priority: number;
}

export interface RbacSnapshot {
  roles: Array<{
    id: string;
    name: string;
    description?: string;
    ruleCount: number;
  }>;
  users: Array<{
    id: string;
    name: string;
    roles: string[];
    ruleCount: number;
  }>;
  resources: Array<{
    id: string;
    type: string;
    name: string;
    path?: string;
    ruleCount: number;
  }>;
  bindings: RbacBindingView[];
}

/**
 * 读取 RBAC 快照（角色/用户/资源 + 全部绑定规则）
 *
 * 统计口径与命令层一致：资源的 `ruleCount` 只算**资源绑定**
 * （`!roleId && !userId`），否则会把同名的角色/用户绑定算进来。
 */
export async function getRbacSnapshot(): Promise<RbacSnapshot> {
  // P2-4（2026-11-11）：与工具判定共用**同一**管理器实例（存储 mtime 缓存才有意义）
  const storage = getFineGrainedPermissionManager().getStorage();
  const [roles, users, resources, rules] = await Promise.all([
    storage.getAllRoles(),
    storage.getAllUsers(),
    storage.getAllResources(),
    storage.getAllRules(),
  ]);

  return {
    roles: roles.map((role) => ({
      id: role.id,
      name: role.name,
      ...(role.description ? { description: role.description } : {}),
      ruleCount: rules.filter((rule) => rule.roleId === role.id).length,
    })),
    users: users.map((user) => ({
      id: user.id,
      name: user.name,
      roles: user.roles,
      ruleCount: rules.filter((rule) => rule.userId === user.id).length,
    })),
    resources: resources.map((resource) => ({
      id: resource.id,
      type: resource.type,
      name: resource.name,
      ...(resource.path ? { path: resource.path } : {}),
      ruleCount: rules.filter(
        (rule) =>
          rule.resourceId === (resource.path ?? '') &&
          !rule.roleId &&
          !rule.userId
      ).length,
    })),
    bindings: rules.map((rule) => ({
      id: rule.id,
      resourceId: rule.resourceId,
      operation: rule.operation,
      action: rule.action,
      ...(rule.roleId ? { roleId: rule.roleId } : {}),
      ...(rule.userId ? { userId: rule.userId } : {}),
      priority: rule.priority,
    })),
  };
}

/**
 * 执行一条 RBAC 变更（复用命令层实现，保证 CLI 与 HTTP 行为一致）
 *
 * 经 `CommandsOpsPort` 走**同一个**命令执行器（模块边界规则禁止 handler 直接 import
 * `commands` 域），因此行为与手动输入 `/permissions …` 完全同源。
 *
 * `command` 是 `/permissions` 之后的部分，例如：
 * - `'role bind guest bash'`
 * - `'user role alice admin'`
 * - `'role add system HTTP 测试'`（描述可含空格，由命令层按 CLI 语法解析）
 */
export async function executeRbacAction(
  command: string
): Promise<{ success: boolean; message: string }> {
  if (!command.trim()) {
    return {
      success: false,
      message: 'command 必填（如 "role bind guest bash"）',
    };
  }
  if (/[\r\n]/.test(command)) {
    return { success: false, message: 'command 不能包含换行' };
  }
  if (command.trimStart().startsWith('/')) {
    return {
      success: false,
      message: 'command 不需要前导 "/"，从子域开始（如 "role list"）',
    };
  }
  const area = command.trim().split(/\s+/)[0];
  if (!RBAC_AREAS.includes(area as RbacArea)) {
    return {
      success: false,
      message: `无效的子域: ${area}\n可用: ${RBAC_AREAS.join(', ')}`,
    };
  }

  const result = await (
    await getCoreAPI().getCommandsOpsPort()
  ).executeCommand(`/permissions ${command.trim()}`);
  const data = (result.data ?? {}) as { value?: string; message?: string };
  const message =
    result.message ??
    data.message ??
    result.value?.toString() ??
    data.value?.toString() ??
    '';
  return { success: result.success !== false, message };
}

/** GET /v1/permissions/rbac */
export async function handleGetPermissionRbac(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const snapshot = await getRbacSnapshot();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(snapshot));
  } catch (err) {
    sendError(res, err);
  }
}

/** POST /v1/permissions/rbac */
export async function handlePermissionRbacAction(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const parsed = JSON.parse(body) as { command?: unknown };
    const { command } = parsed;

    if (typeof command !== 'string') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            message:
              'body 需为 { command: string }（如 { "command": "role bind guest bash" }）',
          },
        })
      );
      return;
    }

    const result = await executeRbacAction(command);
    res.writeHead(result.success ? 200 : 400, {
      'Content-Type': 'application/json; charset=utf-8',
    });
    res.end(JSON.stringify(result));
  } catch (err) {
    sendError(res, err);
  }
}
