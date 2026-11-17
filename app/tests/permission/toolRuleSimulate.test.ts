// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * R0（2026-11-17）：权限判定模拟（`POST /v1/permissions/rules/simulate` 的内核）。
 *
 * 锁两个契约：
 * 1. **同源**：模拟复用 `handleAuto` / `handleDefault` 的同一实现（不是第二套匹配逻辑）——
 *    规则 deny ⇒ deny、只读命令短路 ⇒ allow、指纹规则按同一指纹命中；
 * 2. **只读**：不执行工具、不写规则文件、不污染真实拒绝计数。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PermissionManager } from '@openliri/infra/permission/PermissionManager';
import {
  PermissionBehavior,
  PermissionRuleSource,
  createPermissionRule,
} from '@openliri/infra/permission/types/PermissionRule';
import { hashApprovalFingerprint } from '@openliri/infra/permission/ApprovedCommandRegistry';
import { resolveApprovalFingerprint } from '@openliri/infra/permission/approvalFingerprint';

describe('R0：权限判定模拟（只读、复用真实判定链）', () => {
  let dir: string;
  let file: string;
  let manager: PermissionManager;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'liri-rule-simulate-'));
    file = join(dir, 'tool_rules.json');
    // 独立实例（非单例）：避免污染同进程其它用例；规则源指向临时文件
    manager = new PermissionManager();
    manager.getRuleManager().setRuleSource(file);
    manager.getRuleManager().loadRules();
    // settings 来源的规则取决于本机配置文件 ⇒ 清空，保证用例可复现
    manager.setToolPermissionContext({
      alwaysAllowRules: {},
      alwaysDenyRules: {},
      alwaysAskRules: {},
    });
    manager.setMode('auto');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('auto 档命中工具级 deny 规则 ⇒ deny，并在 matchedRules 里给出该规则', async () => {
    // auto 档只读取**工具级**规则（内容级规则在 default 档生效，见下一个用例）
    const denyRule = createPermissionRule({
      behavior: PermissionBehavior.DENY,
      toolName: 'bash',
      source: PermissionRuleSource.RULE_STORE,
    });
    manager.getRuleManager().addRule(denyRule);

    const result = await manager.simulatePermission({
      toolName: 'bash',
      input: { command: 'rm -rf build' },
    });

    expect(result.decision).toBe('deny');
    expect(result.mode).toBe('auto');
    expect(result.matchedRules.map((r) => r.id)).toContain(denyRule.id);
    expect(result.evaluated.rbac).toBe('skipped');
  });

  it('default 档命中内容级 deny 规则 ⇒ deny（内容规则只在 default 档参与判定）', async () => {
    const denyRule = createPermissionRule({
      behavior: PermissionBehavior.DENY,
      toolName: 'bash',
      contentPattern: '^rm ',
      source: PermissionRuleSource.RULE_STORE,
    });
    manager.getRuleManager().addRule(denyRule);

    const result = await manager.simulatePermission({
      toolName: 'bash',
      input: { command: 'rm -rf build' },
      mode: 'default',
    });

    expect(result.decision).toBe('deny');
    expect(result.matchedRules.map((r) => r.id)).toContain(denyRule.id);
  });

  it('结构只读命令在 auto 档短路为 allow（无规则命中）', async () => {
    const result = await manager.simulatePermission({
      toolName: 'bash',
      input: { command: 'git status' },
    });

    expect(result.decision).toBe('allow');
    expect(result.matchedRules).toHaveLength(0);
  });

  it('工具级 allow 规则对非命令工具生效（按工具名判定，不要求 command）', async () => {
    const allowRule = createPermissionRule({
      behavior: PermissionBehavior.ALLOW,
      toolName: 'nonexistent_tool',
      source: PermissionRuleSource.RULE_STORE,
    });
    manager.getRuleManager().addRule(allowRule);

    const result = await manager.simulatePermission({
      toolName: 'nonexistent_tool',
      input: { any: 'payload' },
    });

    expect(result.decision).toBe('allow');
    expect(result.matchedRules.map((r) => r.id)).toContain(allowRule.id);
  });

  it('「始终允许」指纹规则按同一指纹命中；换命令即不命中', async () => {
    const command = 'echo hello';
    const fingerprint = hashApprovalFingerprint(
      resolveApprovalFingerprint('bash', { command })
    );
    const fpRule = createPermissionRule({
      behavior: PermissionBehavior.ALLOW,
      toolName: 'bash',
      inputFingerprint: fingerprint,
      source: PermissionRuleSource.RULE_STORE,
    });
    manager.getRuleManager().addRule(fpRule);

    // 指纹规则属内容级 ⇒ 在 default 档参与判定
    const hit = await manager.simulatePermission({
      toolName: 'bash',
      input: { command },
      mode: 'default',
    });
    expect(hit.decision).toBe('allow');
    expect(hit.reason).toContain('Allowed by rule');
    expect(hit.matchedRules.map((r) => r.id)).toContain(fpRule.id);

    const miss = await manager.simulatePermission({
      toolName: 'bash',
      input: { command: 'echo hello-world' },
      mode: 'default',
    });
    expect(miss.matchedRules.map((r) => r.id)).not.toContain(fpRule.id);
  });

  it('mode=default 走 default 档（无只读短路，按默认行为放行）', async () => {
    const result = await manager.simulatePermission({
      toolName: 'bash',
      input: { command: 'git status' },
      mode: 'default',
    });

    expect(result.mode).toBe('default');
    expect(result.decision).toBe('allow');
    expect(result.reason).toContain('default allowing');
  });

  it('只读：模拟前后规则文件内容逐字不变', async () => {
    manager.getRuleManager().addRule(
      createPermissionRule({
        behavior: PermissionBehavior.ALLOW,
        toolName: 'bash',
        contentPattern: '^git ',
        source: PermissionRuleSource.RULE_STORE,
      })
    );
    const before = readFileSync(file, 'utf8');

    await manager.simulatePermission({
      toolName: 'bash',
      input: { command: 'git status' },
    });
    await manager.simulatePermission({
      toolName: 'bash',
      input: { command: 'rm -rf /' },
    });

    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('不支持的档位（bypass）⇒ 抛错，不静默给出错误档位的结论', async () => {
    await expect(
      manager.simulatePermission({
        toolName: 'bash',
        input: { command: 'ls' },
        mode: 'bypass',
      })
    ).rejects.toThrow('不支持的模拟权限档');
  });
});
