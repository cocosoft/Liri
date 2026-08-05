// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * permission-handlers.ts — 工具权限规则管理 HTTP handler（P1-5）
 *
 * 暴露 GET/POST/DELETE /v1/permissions/rules，
 * 复用主 PermissionManager（A 体系）的规则 CRUD，
 * 数据落盘 permissions/tool_rules.json（P1-6 存储统一）。
 */

import type http from 'http';
import { sendError, readRequestBody } from './handler-utils';
import { PermissionManager } from '@modules/permission/PermissionManager';
import {
  PermissionBehavior,
  PermissionRule,
} from '@modules/permission/types/PermissionRule';
import { createFineGrainedPermissionManager } from '@modules/permission/FineGrainedPermissionManager';
import { shadowedRuleDetector } from '@modules/permission';
import {
  ResourceType,
  OperationType,
  PermissionAction,
  RoleType,
} from '@modules/permission/Permission';

const VALID_BEHAVIORS: string[] = ['allow', 'deny', 'ask'];

/** 序列化规则（Date → ISO 字符串，供 JSON 传输） */
function serializeRule(rule: PermissionRule): Record<string, unknown> {
  return {
    id: rule.id,
    behavior: rule.behavior,
    toolName: rule.toolName,
    contentPattern: rule.contentPattern,
    source: rule.source,
    priority: rule.priority,
    createdAt:
      rule.createdAt instanceof Date
        ? rule.createdAt.toISOString()
        : rule.createdAt,
    updatedAt:
      rule.updatedAt instanceof Date
        ? rule.updatedAt.toISOString()
        : rule.updatedAt,
  };
}

/**
 * 列出工具权限规则 GET /v1/permissions/rules
 * 附带影子规则（遮蔽冲突）检测结果：deny 被更宽泛规则遮蔽时提示，防止权限配置漏洞
 */
export async function handleListPermissionRules(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const manager = PermissionManager.getInstance();
    const rules = manager.getRules() as PermissionRule[];
    const summary = manager.getRulesSummary();
    const shadowDetection = shadowedRuleDetector.detect(rules);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        rules: rules.map(serializeRule),
        summary,
        shadowDetection: {
          shadowedCount: shadowDetection.shadowedCount,
          isValid: shadowDetection.isValid,
          suggestions: shadowDetection.suggestions,
          shadowedRules: shadowDetection.shadowedRules.map((s) => ({
            reason: s.reason,
            severity: s.severity,
            shadowingIndex: s.shadowingIndex,
            shadowedRule: serializeRule(s.shadowedRule),
            shadowingRule: serializeRule(s.shadowingRule),
          })),
        },
      })
    );
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 添加工具权限规则 POST /v1/permissions/rules
 * body: { behavior: 'allow' | 'deny' | 'ask', toolName: string, contentPattern?: string }
 */
export async function handleAddPermissionRule(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const { behavior, toolName, contentPattern } = JSON.parse(body);

    if (
      typeof toolName !== 'string' ||
      !toolName ||
      typeof behavior !== 'string' ||
      !VALID_BEHAVIORS.includes(behavior)
    ) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            message: 'behavior 必须为 allow/deny/ask，toolName 必填字符串',
          },
        })
      );
      return;
    }

    const manager = PermissionManager.getInstance();
    manager.addRule(
      behavior as PermissionBehavior,
      toolName,
      typeof contentPattern === 'string' && contentPattern
        ? contentPattern
        : undefined
    );
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: '权限规则已添加' }));
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 删除工具权限规则 DELETE /v1/permissions/rules/{ruleId}
 */
export async function handleDeletePermissionRule(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  ruleId: string
): Promise<void> {
  try {
    const manager = PermissionManager.getInstance();
    manager.removeRule(ruleId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: '权限规则已删除' }));
  } catch (err) {
    sendError(res, err);
  }
}

// ========== D 体系（细粒度权限，P2-7 桥接）==========
// 只读 API：复用 CLI 核心（FineGrainedPermissionManager），
// 让休眠的 D 体系从 CLI 独占变为 HTTP 可消费。
// 数据模型为 resource+operation（文件存于 permissions/{rules,roles,users,resources}.json），
// 与 A 体系（toolName → tool_rules.json）语义不同，通过 PermissionService 门面统一出口。
// 写操作（grant/revoke/role/user CRUD）保持 CLI 路径（commands/builtin/permissions/Permissions.ts），
// HTTP 侧暂只读，避免扩大风险面。

/** D 体系权限规则（persistence 模型，与 A 体系 PermissionRule 同名不同义） */
interface DgPermissionRule {
  id: string;
  resourceId: string;
  operation: string;
  action: string;
  condition?: string;
  priority: number;
  toolName?: string;
  behavior?: string;
  contentPattern?: string;
}

function serializeDgRule(rule: DgPermissionRule): Record<string, unknown> {
  return {
    id: rule.id,
    resourceId: rule.resourceId,
    operation: rule.operation,
    action: rule.action,
    condition: rule.condition,
    priority: rule.priority,
    toolName: rule.toolName,
    behavior: rule.behavior,
    contentPattern: rule.contentPattern,
  };
}

/**
 * 列出细粒度角色 GET /v1/permissions/roles
 */
export async function handleListPermissionRoles(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const storage = createFineGrainedPermissionManager().getStorage();
    const roles = await storage.getAllRoles();
    const result = roles.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      permissionCount: r.permissions.length,
      permissions: r.permissions.map((p) => serializeDgRule(p)),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 列出细粒度用户 GET /v1/permissions/users
 */
export async function handleListPermissionUsers(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const storage = createFineGrainedPermissionManager().getStorage();
    const users = await storage.getAllUsers();
    const result = users.map((u) => ({
      id: u.id,
      name: u.name,
      roles: u.roles,
      permissionCount: u.permissions.length,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 列出细粒度资源 GET /v1/permissions/resources
 */
export async function handleListPermissionResources(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const storage = createFineGrainedPermissionManager().getStorage();
    const resources = await storage.getAllResources();
    const result = resources.map((r) => ({
      id: r.id,
      type: r.type,
      name: r.name,
      path: r.path,
      description: r.description,
      parentId: r.parentId,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    sendError(res, err);
  }
}

// ========== D 体系（细粒度权限）写操作 API（P1-5 补全）==========
// 复用 CLI 核心（FineGrainedPermissionManager + FilePermissionStorage）。
// 与 A 体系（/v1/permissions/rules → tool_rules.json）URL 分离：
// D 规则授权走 /v1/permissions/grants（permissions/rules.json，resource+operation 语义）。
// 写接口需本机可信场景使用；鉴权依赖 auth 层（内存 token），真实用户体系就绪前不开放公网。

const VALID_OPERATIONS: string[] = [
  'read',
  'write',
  'execute',
  'delete',
  'create',
  'modify',
  'all',
];
const VALID_ACTIONS: string[] = ['allow', 'deny', 'ask'];
const VALID_RESOURCE_TYPES: string[] = [
  'file',
  'directory',
  'api',
  'tool',
  'command',
  'system',
];
const VALID_ROLE_TYPES: string[] = ['admin', 'user', 'guest', 'system'];

/**
 * 创建细粒度用户 POST /v1/permissions/users
 * body: { name: string, roles?: string[] }
 */
export async function handleCreatePermissionUser(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const { name, roles } = JSON.parse(body);

    if (typeof name !== 'string' || !name) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'name 必填字符串' } }));
      return;
    }

    const storage = createFineGrainedPermissionManager().getStorage();
    const user = {
      id: `user_${Date.now()}`,
      name,
      roles:
        Array.isArray(roles) && roles.length > 0
          ? (roles as string[]).filter(
              (r): r is RoleType =>
                typeof r === 'string' && VALID_ROLE_TYPES.includes(r)
            )
          : [RoleType.GUEST],
      permissions: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const id = await storage.saveUser(user);
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id, message: '细粒度用户已创建' }));
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 删除细粒度用户 DELETE /v1/permissions/users/{userId}
 */
export async function handleDeletePermissionUser(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  userId: string
): Promise<void> {
  try {
    const storage = createFineGrainedPermissionManager().getStorage();
    await storage.deleteUser(userId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: '细粒度用户已删除' }));
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 创建细粒度角色 POST /v1/permissions/roles
 * body: { name: 'admin'|'user'|'guest'|'system', description?: string }
 */
export async function handleCreatePermissionRole(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const { name, description } = JSON.parse(body);

    if (typeof name !== 'string' || !VALID_ROLE_TYPES.includes(name)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'name 必须为 admin/user/guest/system 之一' },
        })
      );
      return;
    }

    const storage = createFineGrainedPermissionManager().getStorage();
    const role = {
      id: `role_${Date.now()}`,
      name: name as RoleType,
      description:
        typeof description === 'string' && description
          ? description
          : undefined,
      permissions: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const id = await storage.saveRole(role);
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id, message: '细粒度角色已创建' }));
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 删除细粒度角色 DELETE /v1/permissions/roles/{roleId}
 */
export async function handleDeletePermissionRole(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  roleId: string
): Promise<void> {
  try {
    const storage = createFineGrainedPermissionManager().getStorage();
    await storage.deleteRole(roleId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: '细粒度角色已删除' }));
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 添加细粒度资源 POST /v1/permissions/resources
 * body: { type: string, name: string, path?: string, description?: string }
 */
export async function handleCreatePermissionResource(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const { type, name, path, description } = JSON.parse(body);

    if (
      typeof type !== 'string' ||
      !VALID_RESOURCE_TYPES.includes(type) ||
      typeof name !== 'string' ||
      !name
    ) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            message:
              'type 必须为 file/directory/api/tool/command/system，name 必填字符串',
          },
        })
      );
      return;
    }

    const storage = createFineGrainedPermissionManager().getStorage();
    const resource = {
      id: `resource_${Date.now()}`,
      type: type as ResourceType,
      name,
      path: typeof path === 'string' && path ? path : undefined,
      description:
        typeof description === 'string' && description
          ? description
          : undefined,
      parentId: undefined,
    };
    const id = await storage.saveResource(resource);
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id, message: '细粒度资源已添加' }));
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 删除细粒度资源 DELETE /v1/permissions/resources/{resourceId}
 */
export async function handleDeletePermissionResource(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  resourceId: string
): Promise<void> {
  try {
    const storage = createFineGrainedPermissionManager().getStorage();
    await storage.deleteResource(resourceId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: '细粒度资源已删除' }));
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 授权（添加细粒度规则） POST /v1/permissions/grants
 * body: { resourceId: string, operation: string, action: string,
 *         roleId?: string, userId?: string, condition?: string, priority?: number }
 */
export async function handleCreatePermissionGrant(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const {
      resourceId,
      operation,
      action,
      roleId,
      userId,
      condition,
      priority,
    } = JSON.parse(body);

    if (
      typeof resourceId !== 'string' ||
      !resourceId ||
      typeof operation !== 'string' ||
      !VALID_OPERATIONS.includes(operation) ||
      typeof action !== 'string' ||
      !VALID_ACTIONS.includes(action)
    ) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            message:
              'resourceId 必填；operation 必须为 read/write/execute/delete/create/modify/all；action 必须为 allow/deny/ask',
          },
        })
      );
      return;
    }

    const storage = createFineGrainedPermissionManager().getStorage();
    const rule = {
      id: `rule_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      resourceId,
      operation: operation as OperationType,
      action: action as PermissionAction,
      roleId: typeof roleId === 'string' && roleId ? roleId : undefined,
      userId: typeof userId === 'string' && userId ? userId : undefined,
      condition:
        typeof condition === 'string' && condition ? condition : undefined,
      priority: typeof priority === 'number' ? priority : 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const id = await storage.saveRule(rule);
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id, message: '细粒度规则已授权' }));
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 撤销（删除细粒度规则） DELETE /v1/permissions/grants/{ruleId}
 */
export async function handleDeletePermissionGrant(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  ruleId: string
): Promise<void> {
  try {
    const storage = createFineGrainedPermissionManager().getStorage();
    await storage.deleteRule(ruleId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: '细粒度规则已撤销' }));
  } catch (err) {
    sendError(res, err);
  }
}
