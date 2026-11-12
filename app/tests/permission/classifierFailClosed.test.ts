// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P8（2026-11-12）：分类器异常必须 **fail-closed 到 ask**。
 *
 * 背景：此前异常分支是 fail-open（静默放行）—— 分类器真抛错（如本轮遇到的
 * `ReferenceError`）时，所有"需要判定"的命令会被直接放行。本用例锁住新口径：
 *  - 异常 ⇒ ask（可人工批准，既不阻断也不放行）；
 *  - 结构只读命令仍 allow（走分类器之前的只读短路，不因异常而弹审批）。
 */
import { afterAll, afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifierManager } from '@openliri/infra/permission/classifiers/auto-mode-classifier-manager';
import { PermissionMode } from '@openliri/infra/permission';
import { PermissionManager } from '@openliri/infra/permission/PermissionManager';
import { createPermissionContext } from '@openliri/infra/permission/types/PermissionContext';
import type { PermissionContext } from '@openliri/infra/permission/types/PermissionContext';

const tmpDirs: string[] = [];
const originalClassifier = classifierManager.getClassifier();

function createIsolatedManager(): PermissionManager {
  const dir = mkdtempSync(join(tmpdir(), 'perm-failclosed-'));
  tmpDirs.push(dir);
  const ruleFile = join(dir, 'tool_rules.json');
  writeFileSync(ruleFile, '[]');
  const pm = new PermissionManager();
  pm.getRuleManager().setRuleSource(ruleFile);
  pm.resetRules();
  return pm;
}

function breakClassifier(): void {
  classifierManager.registerClassifier({
    classify: async () => {
      throw new Error('classifier boom');
    },
    isAllowlistedTool: () => false,
  } as never);
}

async function verdict(command: string): Promise<string> {
  const pm = createIsolatedManager();
  const input = { command };
  const decision = await pm.checkPermission(
    'bash',
    input,
    createPermissionContext({
      toolName: 'bash',
      input,
      permissionMode: PermissionMode.AUTO,
      sessionId: 'sess-classifier-down',
    }) as PermissionContext
  );
  return decision.type;
}

afterEach(() => {
  classifierManager.registerClassifier(originalClassifier);
});

afterAll(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

describe('P8：分类器异常 ⇒ fail-closed 到 ask', () => {
  it('需要判定的命令 ⇒ ask（不再静默放行）', async () => {
    breakClassifier();
    expect(await verdict('python script.py')).toBe('ask');
    expect(await verdict('mv ws/a.txt ws/b.txt')).toBe('ask');
  });

  it('结构只读命令仍 allow（分类器之前的短路不受影响）', async () => {
    breakClassifier();
    expect(await verdict('ls -la')).toBe('allow');
  });
});
