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
 */
export async function handleListPermissionRules(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const manager = PermissionManager.getInstance();
    const rules = manager.getRules() as PermissionRule[];
    const summary = manager.getRulesSummary();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ rules: rules.map(serializeRule), summary }));
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
