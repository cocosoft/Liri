/**
 * 请求级角色 → 权限判定 · 透传回归（多租户 P0 阶段 2）
 *
 * 阶段 1 的 `resolveEffectiveRole(context.userRole, processRole)` 此前**吃不到**请求级角色 ——
 * `checkPermissionForTool` 的入参类型与 `createPermissionContext` 都没有 `userRole` 位
 * ⇒ 该分支在工具执行主路径上不可达。本文件锁住补齐后的透传。
 *
 * 锁三件事：
 *  ① `createPermissionContext` 携带 `userRole`；
 *  ② `checkPermissionForTool` 把 `userRole` 放进 `PermissionContext`；
 *  ③ 不传 ⇒ 上下文该字段为 `undefined`（桌面/后台走进程级回退，零行为变更）。
 */
import { describe, expect, it } from 'bun:test';

import { createPermissionManager } from '../../src/permission/PermissionManager.js';
import { createPermissionContext } from '../../src/permission/types/PermissionContext.js';
import type { PermissionContext } from '../../src/permission/types/PermissionContext.js';

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

  it('不传 userRole ⇒ 上下文不留该值（桌面/后台零行为变更）', async () => {
    const pm = createPermissionManager();
    const seen = captureContexts(pm);

    await pm.checkPermissionForTool('file_write', {});

    expect(seen[0].userRole).toBeUndefined();
  });
});
