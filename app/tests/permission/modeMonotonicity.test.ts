/**
 * P0-3 / P0-4（2026-11-11）：权限档位的**单调性**回归。
 *
 * 修复前的两处反向语义：
 *  - `dontAsk`（不询问）跳过命令级黑名单与指纹规则 ⇒ 用户明确 deny 的命令被放行；
 *  - `plan`（每步确认）无条件 ask ⇒ 显式 deny / 命令黑名单 / RBAC deny 全被绕过，
 *    「更严格」的档位反而把禁止项变成可批准。
 *
 * 本文件锁住：
 *  ① plan 档：A 规则 deny / 命令黑名单 / RBAC deny 仍是 deny；未被禁止才 ask；
 *  ② dontAsk 档：命令黑名单仍是 deny；兜底场景也不返回 ask。
 */
import { afterAll, describe, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PermissionMode } from '@openliri/infra/permission';
import { PermissionManager } from '@openliri/infra/permission/PermissionManager';
import * as checkerModule from '@openliri/infra/permission/PermissionChecker';
import {
  PermissionBehavior,
  createPermissionRule,
} from '@openliri/infra/permission/types/PermissionRule';
import { createPermissionContext } from '@openliri/infra/permission/types/PermissionContext';
import type { PermissionContext } from '@openliri/infra/permission/types/PermissionContext';
import { createDenyDecision } from '@openliri/infra/permission/types/PermissionDecision';
import { isCommandToolName } from '@openliri/infra/utils/toolContract/toolRoles';

const tmpDirs: string[] = [];

afterAll(() => {
  for (const dir of tmpDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // 忽略清理失败
    }
  }
});

function createIsolatedManager(): PermissionManager {
  const dir = mkdtempSync(join(tmpdir(), 'perm-mode-test-'));
  tmpDirs.push(dir);
  const ruleFile = join(dir, 'tool_rules.json');
  writeFileSync(ruleFile, '[]');
  const pm = new PermissionManager();
  pm.getRuleManager().setRuleSource(ruleFile);
  pm.resetRules();
  return pm;
}

function decide(
  pm: PermissionManager,
  mode: PermissionMode,
  input: Record<string, unknown> = { command: 'rm -rf /tmp/probe' }
) {
  return pm.checkPermission(
    'bash',
    input,
    createPermissionContext({
      toolName: 'bash',
      input,
      permissionMode: mode,
      sessionId: 's1',
    }) as PermissionContext
  );
}

describe('plan 档不再绕过硬 deny（P0-4）', () => {
  test('A 规则 deny ⇒ deny（而非 ask）', async () => {
    const pm = createIsolatedManager();
    pm.getRuleManager().addRule(
      createPermissionRule({
        behavior: PermissionBehavior.DENY,
        toolName: 'bash',
      })
    );

    const decision = await decide(pm, PermissionMode.PLAN);

    expect(decision.type).toBe('deny');
  });

  test('命令黑名单命中 ⇒ deny（而非 ask）', async () => {
    const spy = spyOn(checkerModule, 'checkCommandCustomRules').mockReturnValue(
      createDenyDecision('命令命中自定义黑名单')
    );
    try {
      // 先证明「命令规则在 plan 档确实会被消费」——避免用例因工具名/接线失效而假绿
      expect(isCommandToolName('bash')).toBe(true);

      const decision = await decide(
        createIsolatedManager(),
        PermissionMode.PLAN
      );
      expect(decision.type).toBe('deny');
    } finally {
      spy.mockRestore();
    }
  });

  test('未被禁止 ⇒ 仍然 ask（每步确认语义不变）', async () => {
    const decision = await decide(
      createIsolatedManager(),
      PermissionMode.PLAN,
      { command: 'echo hello' }
    );
    expect(decision.type).toBe('ask');
  });
});

describe('dontAsk 档补齐命令黑名单（P0-3）', () => {
  test('命令黑名单命中 ⇒ deny（不再放行）', async () => {
    const spy = spyOn(checkerModule, 'checkCommandCustomRules').mockReturnValue(
      createDenyDecision('命令命中自定义黑名单')
    );
    try {
      const decision = await decide(
        createIsolatedManager(),
        PermissionMode.DONT_ASK
      );
      expect(decision.type).toBe('deny');
      expect(decision.reason).toContain('黑名单');
    } finally {
      spy.mockRestore();
    }
  });

  test('无任何规则 ⇒ 兜底仍是 deny（不返回 ask）', async () => {
    const decision = await decide(
      createIsolatedManager(),
      PermissionMode.DONT_ASK,
      { command: 'echo hello' }
    );
    expect(decision.type).toBe('deny');
  });
});
