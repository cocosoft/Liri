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
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { configManager, getConfigManager } from '@openliri/infra/config';
import { APPROVAL_PAUSE_CONFIG_KEY } from '@openliri/infra/permission/approvalPause';
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

/**
 * F2（2026-11-17）：模拟与真实链**同口径**地应用「按工作区暂停」。
 *
 * 缺口现场：模拟请求本来就带 `workspaceRoots`，但规则上下文没把暂停范围带进去 ⇒
 * 同一命令"模拟说 deny、真实链说 allow"（或反之），模拟失去参考价值。
 */
describe('F2：模拟按工作区暂停（与真实链同口径）', () => {
  let dir: string;
  let manager: PermissionManager;
  let configSpy: ReturnType<typeof spyOn> | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'liri-rule-simulate-pause-'));
    manager = new PermissionManager();
    manager.getRuleManager().setRuleSource(join(dir, 'tool_rules.json'));
    manager.getRuleManager().loadRules();
    manager.setToolPermissionContext({
      alwaysAllowRules: {},
      alwaysDenyRules: {},
      alwaysAskRules: {},
    });
    manager.setMode('default');
    // 审批生成的工具级 deny（暂停后应被忽略）
    manager.getRuleManager().addRule(
      createPermissionRule({
        behavior: PermissionBehavior.DENY,
        toolName: 'bash',
        origin: 'approval',
        source: PermissionRuleSource.RULE_STORE,
      })
    );
  });

  afterEach(() => {
    configSpy?.mockRestore();
    configSpy = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  it('工作区在暂停列表 ⇒ 模拟忽略审批规则；其他根仍 deny', async () => {
    configSpy = spyOn(getConfigManager(), 'getValue').mockImplementation(((
      key: string
    ) =>
      key === APPROVAL_PAUSE_CONFIG_KEY
        ? { global: false, sessions: [], workspaces: ['e:/proj'] }
        : undefined) as unknown as typeof configManager.getValue);

    const paused = await manager.simulatePermission({
      toolName: 'bash',
      input: { command: 'git status' },
      workspaceRoots: ['E:\\Proj\\'],
    });
    expect(paused.decision).toBe('allow');
    expect(paused.matchedRules).toHaveLength(0);

    const other = await manager.simulatePermission({
      toolName: 'bash',
      input: { command: 'git status' },
      workspaceRoots: ['e:/other'],
    });
    expect(other.decision).toBe('deny');
  });

  it('会话在暂停列表 ⇒ 模拟与真实执行同结论（此前模拟缺 sessionId ⇒ 仍 deny）', async () => {
    configSpy = spyOn(getConfigManager(), 'getValue').mockImplementation(((
      key: string
    ) =>
      key === APPROVAL_PAUSE_CONFIG_KEY
        ? { global: false, sessions: ['s-paused'], workspaces: [] }
        : undefined) as unknown as typeof configManager.getValue);

    const input = { command: 'git status' };
    const simulated = await manager.simulatePermission({
      toolName: 'bash',
      input,
      mode: 'default',
      sessionId: 's-paused',
    });
    const executed = await manager.checkPermissionForTool('bash', input, {
      sessionId: 's-paused',
    });
    const executedDecision = executed.allowed
      ? 'allow'
      : executed.decision?.behavior === 'ask'
        ? 'ask'
        : 'deny';

    expect(simulated.decision).toBe(executedDecision);
    expect(simulated.decision).toBe('allow');

    // 其他会话不受暂停影响：审批 deny 仍生效
    const other = await manager.simulatePermission({
      toolName: 'bash',
      input,
      mode: 'default',
      sessionId: 's-other',
    });
    expect(other.decision).toBe('deny');
  });
});
