// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * F3（2026-11-22）：别名调用按**真名**判定。
 *
 * 背景（二次复查）：`tool_rules` 按真名配置，而 `checkPermissionForTool` 直接用调用方
 * 传入的名字构造 `PermissionContext.toolName` ⇒ 别名（wire 安全名 / 旧名）调用时
 * 工具级 deny / ask 规则不命中，风险也退回名字启发式。现口径：`context.tool` 存在时
 * 以 `tool.name`（真名）作为判定名。
 */

import { describe, expect, it } from 'bun:test';

import { PermissionMode } from '@openliri/infra/permission/PermissionMode';
import type { PermissionChecker } from '@openliri/infra/permission/PermissionChecker';
import { checkPermissionForTool } from '@openliri/infra/permission/manager/toolPermission';
import type { PermissionContext } from '@openliri/infra/permission/types/PermissionContext';
import { PermissionDecisionType } from '@openliri/infra/permission/types/PermissionDecision';

function buildDeps(seen: string[]) {
  return {
    mode: PermissionMode.DEFAULT,
    permissionChecker: {} as PermissionChecker,
    checkPermission: async (
      _toolOrName: unknown,
      _input: Record<string, unknown>,
      context?: PermissionContext
    ) => {
      seen.push(context?.toolName ?? '');
      return { type: PermissionDecisionType.ALLOW, behavior: 'allow' };
    },
  } as never;
}

describe('F3：别名 → 真名归一', () => {
  it('带工具对象时按真名构造判定上下文', async () => {
    const seen: string[] = [];
    await checkPermissionForTool(
      buildDeps(seen),
      'fw_alias',
      {},
      { tool: { name: 'file_write' } as never }
    );
    expect(seen).toEqual(['file_write']);
  });

  it('未带工具对象时保持原名字（零行为变更）', async () => {
    const seen: string[] = [];
    await checkPermissionForTool(buildDeps(seen), 'fw_alias', {});
    expect(seen).toEqual(['fw_alias']);
  });
});
