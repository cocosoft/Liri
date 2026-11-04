// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P0（统一策略层方案 §5，2026-11-04）：`ToolExecutor` 的两处"静默放行"回归守卫。
 *
 * 1. `ask` **不是** `allow` —— 原实现只处理 `deny`，`ask` 直接落到末尾 `allowed: true`；
 * 2. 工具级 `checkPermissions` 返回 `allow` **不得短路**通用判定 ——
 *    原先 `buildTool` 给每个工具注入 `() => allow`，而执行器见 allow 即返回
 *    ⇒ `PermissionManager` 这条唯一生效链对所有 built 工具都被绕过。
 */

import { describe, it, expect } from 'bun:test';
import { ToolExecutor } from '../../src/tools/ToolExecutor';
import { buildTool } from '../../src/tools/ToolBuilder';

const ctx = {} as never;

const managerReturning = (decision: { type: string; reason?: string }) =>
  ({ checkPermission: async () => decision }) as never;

const bashStub = (extra: Record<string, unknown> = {}) =>
  ({ name: 'BashTool', ...extra }) as never;

describe('P0：ToolExecutor 不再把 ask 当 allow', () => {
  it('通用判定 ask ⇒ 拒绝执行（fail-closed，且带原因）', async () => {
    const executor = new ToolExecutor(
      managerReturning({ type: 'ask', reason: '需要用户确认' })
    );
    const result = await executor.checkPermissions(
      bashStub(),
      { command: 'rm -rf /tmp/x' },
      ctx
    );
    expect(result.allowed).toBe(false);
    expect(result.error).toBe('需要用户确认');
  });

  it('通用判定 allow ⇒ 放行（回归：正常路径不受影响）', async () => {
    const executor = new ToolExecutor(managerReturning({ type: 'allow' }));
    const result = await executor.checkPermissions(bashStub(), {}, ctx);
    expect(result.allowed).toBe(true);
  });

  it('工具级 check 返回 allow 不能短路通用判定（ask 仍然拒绝）', async () => {
    const executor = new ToolExecutor(
      managerReturning({ type: 'ask', reason: 'ask-by-manager' })
    );
    const tool = bashStub({
      checkPermissions: async () => ({ behavior: 'allow', reason: null }),
    });
    const result = await executor.checkPermissions(tool, {}, ctx);
    expect(result.allowed).toBe(false);
    expect(result.error).toBe('ask-by-manager');
  });

  it('工具级 check 返回 deny ⇒ 直接拒绝（收紧语义保留）', async () => {
    const executor = new ToolExecutor(managerReturning({ type: 'allow' }));
    const tool = bashStub({
      checkPermissions: async () => ({
        behavior: 'deny',
        reason: '工具自带拒绝',
      }),
    });
    const result = await executor.checkPermissions(tool, {}, ctx);
    expect(result.allowed).toBe(false);
    expect(result.error).toBe('工具自带拒绝');
  });
});

describe('P0：buildTool 不再注入默认放行桩', () => {
  it('未显式声明 checkPermissions ⇒ 产物不含该字段（回落到通用判定）', () => {
    const tool = buildTool({ name: 'SomeTool' });
    expect(tool.checkPermissions).toBeUndefined();
  });

  it('显式声明的 checkPermissions 原样保留', () => {
    const custom = async () => ({ behavior: 'deny' as const, reason: 'x' });
    const tool = buildTool({ name: 'SomeTool', checkPermissions: custom });
    expect(tool.checkPermissions).toBe(custom);
  });
});
