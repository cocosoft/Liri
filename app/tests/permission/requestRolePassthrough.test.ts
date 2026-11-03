/**
 * 请求级角色 → 权限判定 · 透传回归（多租户 P0 阶段 2）
 *
 * 锁四件事：
 *  ① `createPermissionContext` 携带 `userRole`；
 *  ② `checkPermissionForTool` 把 `userRole` 放进 `PermissionContext`；
 *  ③ 不传 ⇒ 上下文该字段为 `undefined`（后台 / CLI / cron **无角色**，角色 deny 不参与）；
 *  ④ 登录不再写进程级角色 —— `setCurrentUserRole` / `currentUserRole` 不得回流
 *     （2026-11-03 收敛，见 `预存错误与待处理问题.md`「收敛进程级角色第二真源」）。
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createPermissionManager } from '@openliri/infra/permission/PermissionManager';
import { createPermissionContext } from '@openliri/infra/permission/types/PermissionContext';
import type { PermissionContext } from '@openliri/infra/permission/types/PermissionContext';

/** 仓库根（测试工作目录为 `app/`） */
const REPO_ROOT = join(process.cwd(), '..');

/** 捕获流经 `checkPermission` 的上下文（返回 allow，避免落到 Inbox 提交通路） */
function captureContexts(pm: ReturnType<typeof createPermissionManager>) {
  const seen: PermissionContext[] = [];
  (pm as unknown as Record<string, unknown>)['checkPermission'] = async (
    _toolName: string,
    _input: unknown,
    context: PermissionContext
  ) => {
    seen.push(context);
    return { type: 'allow', reason: 'captured-by-test' };
  };
  return seen;
}

describe('请求级角色透传', () => {
  it('createPermissionContext 携带 userRole', () => {
    const ctx = createPermissionContext({
      toolName: 'file_write',
      input: {},
      userRole: 'auditor',
    });
    expect(ctx.userRole).toBe('auditor');
  });

  it('checkPermissionForTool 把 userRole 放进 PermissionContext', async () => {
    const pm = createPermissionManager();
    const seen = captureContexts(pm);

    const result = await pm.checkPermissionForTool(
      'file_write',
      {},
      { userRole: 'auditor' }
    );

    expect(result.allowed).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0].userRole).toBe('auditor');
  });

  it('不传 userRole ⇒ 上下文不留该值（后台路径无角色，角色 deny 不参与）', async () => {
    const pm = createPermissionManager();
    const seen = captureContexts(pm);

    await pm.checkPermissionForTool('file_write', {});

    expect(seen[0].userRole).toBeUndefined();
  });
});

describe('进程级角色第二真源（2026-11-03 收敛·结构性守卫）', () => {
  const authHandlers = readFileSync(
    join(REPO_ROOT, 'app/src/infrastructure/http/handlers/auth-handlers.ts'),
    'utf8'
  );
  const permissionManager = readFileSync(
    join(REPO_ROOT, 'packages/infra/src/permission/PermissionManager.ts'),
    'utf8'
  );

  it('登录 / 注册 / 登出不再写进程级角色（回退旧路径必红）', () => {
    expect(authHandlers).not.toContain('setCurrentUserRole');
    expect(authHandlers).not.toContain('currentUserRole');
  });

  it('PermissionManager 不再持有进程级角色字段与访问器', () => {
    expect(permissionManager).not.toContain('currentUserRole');
    expect(permissionManager).not.toContain('setCurrentUserRole');
    expect(permissionManager).not.toContain('getCurrentUserRole');
  });
});
