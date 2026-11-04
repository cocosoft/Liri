// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P1（2026-11-04）：**会话级权限模式优先于进程默认档**。
 *
 * 取证背景：会话元数据里的 `permission_mode` 此前只进通知服务（方案 §1.1），
 * 判定链读不到。现在由执行入口把它放进 `context.permissionMode`，`PermissionManager`
 * 在每次判定时按 `context.permissionMode ?? this.mode` 取档 —— **不改全局单例**，
 * 因此两个并发会话各用各的模式，互不串档。
 *
 * 用例用 `checkPermission()`（而非 `checkPermissionForTool()`）：后者在 `ask` 时会
 * 提交 Inbox 审批卡（写库），本用例只验证**决策**，避免副作用。
 */

import { describe, it, expect } from 'bun:test';
import { createPermissionManager } from '@openliri/infra/permission/PermissionManager';
import type { PermissionContext } from '@openliri/infra/permission/types/PermissionContext';

const PROBE_TOOL = 'p1_probe_tool';

function ctx(overrides: Partial<PermissionContext> = {}): PermissionContext {
  return {
    toolName: PROBE_TOOL,
    input: {},
    sessionId: 'sess-p1',
    ...overrides,
  };
}

/** 在指定进程默认档下构造一个实例，跑完即恢复 env（避免污染同进程其他用例） */
async function withProcessMode<T>(
  mode: string,
  fn: (pm: ReturnType<typeof createPermissionManager>) => Promise<T>
): Promise<T> {
  const original = process.env['PERMISSION_MODE'];
  process.env['PERMISSION_MODE'] = mode;
  try {
    return await fn(createPermissionManager());
  } finally {
    if (original === undefined) delete process.env['PERMISSION_MODE'];
    else process.env['PERMISSION_MODE'] = original;
  }
}

describe('P1：会话级 permissionMode 覆盖进程默认档', () => {
  it('无会话覆盖 ⇒ 用进程默认档（alwaysAsk ⇒ ask）', async () => {
    await withProcessMode('alwaysAsk', async (pm) => {
      const decision = await pm.checkPermission(PROBE_TOOL, {}, ctx());
      expect(decision.type).toBe('ask');
    });
  });

  it('会话传 bypass ⇒ 放行（会话可放宽）', async () => {
    await withProcessMode('alwaysAsk', async (pm) => {
      const decision = await pm.checkPermission(
        PROBE_TOOL,
        {},
        ctx({ permissionMode: 'bypass' })
      );
      expect(decision.type).toBe('allow');
    });
  });

  it('会话传 alwaysAsk ⇒ 收紧进程默认档（bypass ⇒ ask）', async () => {
    await withProcessMode('bypass', async (pm) => {
      const decision = await pm.checkPermission(
        PROBE_TOOL,
        {},
        ctx({ permissionMode: 'alwaysAsk' })
      );
      expect(decision.type).toBe('ask');
    });
  });

  it('同一实例上两个会话各自的模式互不影响（不串档）', async () => {
    await withProcessMode('alwaysAsk', async (pm) => {
      const a = await pm.checkPermission(
        PROBE_TOOL,
        {},
        ctx({ sessionId: 'sess-a', permissionMode: 'bypass' })
      );
      const b = await pm.checkPermission(
        PROBE_TOOL,
        {},
        ctx({ sessionId: 'sess-b' })
      );
      expect(a.type).toBe('allow');
      expect(b.type).toBe('ask');
    });
  });
});
