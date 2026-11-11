/**
 * P0-1（2026-11-11）：**执行入口统一授权**回归。
 *
 * 背景：CLI / 语音 / 工作流等入口经 `ToolManager.executeTool` 执行工具，此前只做
 * shield + `DefaultToolPolicy`（缺省 owner）⇒ RBAC / ask 规则 / 权限档全部失效。
 *
 * 本文件锁四件事：
 *  ① deny ⇒ 不执行工具，返回可读失败；
 *  ② ask  ⇒ 不执行工具，提示需人工审批（非交互入口没有就地审批 UI）；
 *  ③ allow ⇒ 正常执行，且把本机身份位（userId / userRoles）传进授权层；
 *  ④ 上游已授权的调用方（CoreAPI）用 `policyContext.permissionAuthorized` 跳过二次判定。
 */
import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';

import * as permissionModule from '@openliri/infra/permission';
import type { AuthorizeOutcome } from '@openliri/infra/permission';
import { ToolManager } from '../../src/tools/ToolManager';
import { ToolRegistry } from '../../src/tools/ToolRegistry';
import type { Tool } from '../../src/tools/types/Tool';

const TOOL_NAME = 'guard_probe';

let outcome: AuthorizeOutcome = { allowed: true };
const seenContexts: Array<Record<string, unknown> | undefined> = [];

const authSpy = spyOn(permissionModule, 'authorizeToolCall').mockImplementation(
  async (
    _port: unknown,
    request: { context?: Record<string, unknown> }
  ): Promise<AuthorizeOutcome> => {
    seenContexts.push(request.context);
    return outcome;
  }
);

afterAll(() => {
  authSpy.mockRestore();
});

beforeEach(() => {
  outcome = { allowed: true };
  seenContexts.length = 0;
});

function createManager(calls: { count: number }): ToolManager {
  const manager = new ToolManager({
    loadBuiltinTools: false,
    registry: new ToolRegistry(),
  });
  const tool = {
    name: TOOL_NAME,
    description: '执行入口授权探针',
    params: [],
    execute: async () => {
      calls.count += 1;
      return { success: true, data: { ok: true } };
    },
    getInfo: () => ({ name: TOOL_NAME, description: '探针', params: [] }),
  } as unknown as Tool;
  manager.registerTool(tool);
  return manager;
}

describe('ToolManager.executeTool：执行入口统一授权', () => {
  test('deny ⇒ 不执行工具，返回被拒绝', async () => {
    const calls = { count: 0 };
    outcome = { allowed: false, kind: 'deny', reason: 'rule-42' };

    const result = (await createManager(calls).executeTool(
      TOOL_NAME,
      {},
      {}
    )) as { success?: boolean; error?: string };

    expect(calls.count).toBe(0);
    expect(result.success).toBe(false);
    expect(result.error).toContain('被权限拒绝');
    expect(result.error).toContain('rule-42');
  });

  test('ask ⇒ 不执行工具，提示需人工审批', async () => {
    const calls = { count: 0 };
    outcome = {
      allowed: false,
      kind: 'ask',
      reason: 'needs approval',
      submittedToInbox: false,
    };

    const result = (await createManager(calls).executeTool(
      TOOL_NAME,
      {},
      {}
    )) as { success?: boolean; error?: string };

    expect(calls.count).toBe(0);
    expect(result.success).toBe(false);
    expect(result.error).toContain('需要人工审批');
  });

  test('allow ⇒ 执行，并携带本机身份位', async () => {
    const calls = { count: 0 };

    const result = (await createManager(calls).executeTool(
      TOOL_NAME,
      {},
      {}
    )) as { success?: boolean };

    expect(calls.count).toBe(1);
    expect(result.success).toBe(true);
    expect(seenContexts).toHaveLength(1);
    expect(seenContexts[0]?.userId).toBe('local');
    expect(seenContexts[0]?.userRoles).toEqual(['admin']);
  });

  test('policyContext.permissionAuthorized=true ⇒ 跳过二次判定（CoreAPI 路径）', async () => {
    const calls = { count: 0 };

    const result = (await createManager(calls).executeTool(
      TOOL_NAME,
      {},
      { policyContext: { permissionAuthorized: true } }
    )) as { success?: boolean };

    expect(calls.count).toBe(1);
    expect(result.success).toBe(true);
    expect(seenContexts).toHaveLength(0);
  });
});
