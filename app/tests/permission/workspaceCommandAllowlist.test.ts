// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * G3（2026-11-14）：命令级「本工作区永久信任」的规则语义回归锁。
 *
 * 锁住三件事（任何一条失守都会让新档退化成"全局前缀放行"）：
 * 1. 带 `workspaceRoot` 的规则只在**同一工作区根**下命中（缺根 ⇒ fail-closed）；
 * 2. 精确命令（`^…$`）不多放行一个参数；
 * 3. 审批卡下发该档，且仅命令类工具下发；同命令不同工作区的两条规则不被去重合并。
 */
import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createPermissionRule,
  isRuleMatch,
  PermissionBehavior,
  PermissionRuleSource,
} from '@openliri/infra/permission/types/PermissionRule';
import { deduplicateRules } from '@openliri/infra/permission/RuleManager';
import { buildApprovalOptions } from '@openliri/infra/permission/toolApprovalSubmission';
import { RiskClass } from '@openliri/infra/permission/types/RiskClass.js';
import { PermissionManager } from '@openliri/infra/permission/PermissionManager';
import type { ToolPermissionResult } from '@openliri/infra/permission/manager/toolPermission';

const WORKSPACE = 'e:\\PY\\Documents\\CODES\\PY_APP';

function exactCommandRule(command: string, workspaceRoot?: string) {
  return createPermissionRule({
    behavior: PermissionBehavior.ALLOW,
    toolName: 'bash',
    contentPattern: `^${command}$`,
    workspaceRoot,
    source: PermissionRuleSource.RULE_STORE,
  });
}

describe('G3 本工作区永久信任 —— 规则匹配', () => {
  it('同一工作区根命中（分隔符/大小写归一）', () => {
    const rule = exactCommandRule('npm test', 'E:/PY/Documents/CODES/PY_APP/');
    expect(
      isRuleMatch(
        rule,
        'bash',
        { command: 'npm test' },
        {
          workspaceRoots: [WORKSPACE],
        }
      )
    ).toBe(true);
  });

  it('不同工作区根不命中', () => {
    const rule = exactCommandRule('npm test', WORKSPACE);
    expect(
      isRuleMatch(
        rule,
        'bash',
        { command: 'npm test' },
        {
          workspaceRoots: ['e:\\PY\\Documents\\OTHER'],
        }
      )
    ).toBe(false);
  });

  it('调用方未提供工作区根 ⇒ 不命中（fail-closed）', () => {
    const rule = exactCommandRule('npm test', WORKSPACE);
    expect(isRuleMatch(rule, 'bash', { command: 'npm test' })).toBe(false);
  });

  it('精确命令不多放行参数（前缀不同不命中）', () => {
    const rule = exactCommandRule('npm test', WORKSPACE);
    expect(
      isRuleMatch(
        rule,
        'bash',
        { command: 'npm test -- --watch' },
        {
          workspaceRoots: [WORKSPACE],
        }
      )
    ).toBe(false);
  });

  it('无 workspaceRoot 的规则保持全局语义（既有行为不变）', () => {
    const rule = exactCommandRule('npm test');
    expect(isRuleMatch(rule, 'bash', { command: 'npm test' })).toBe(true);
  });
});

describe('G3 本工作区永久信任 —— 执行链与 simulate 同源（2026-11-27）', () => {
  const toDecision = (r: ToolPermissionResult): string =>
    r.allowed ? 'allow' : r.decision?.behavior === 'ask' ? 'ask' : 'deny';

  const build = () => {
    const dir = mkdtempSync(join(tmpdir(), 'g3-roots-'));
    const manager = new PermissionManager();
    manager.getRuleManager().setRuleSource(join(dir, 'tool_rules.json'));
    manager.getRuleManager().loadRules();
    manager.setToolPermissionContext({
      alwaysAllowRules: {},
      alwaysDenyRules: {},
      alwaysAskRules: {},
    });
    manager.setMode('default');
    const rule = createPermissionRule({
      behavior: PermissionBehavior.ALLOW,
      toolName: 'bash',
      contentPattern: '^npm test$',
      workspaceRoot: join(dir, 'wsA'),
      source: PermissionRuleSource.RULE_STORE,
    });
    manager.getRuleManager().addRule(rule);
    return { dir, manager, rule };
  };

  // default 档对「无规则的 bash」本就走 allow（命令类安全闸在工具层），判 decision 无法分辨规则是否命中
  // ⇒ 用 `dontAsk` 档（未命中即 deny）证明**执行链**确实带上了根。
  it('dontAsk 档：同一根 ⇒ allow；异根 ⇒ deny（此前执行链不传根 ⇒ 恒 deny）', async () => {
    const { dir, manager } = build();
    try {
      manager.setMode('dontAsk');
      const input = { command: 'npm test' };
      const sameRoot = await manager.checkPermissionForTool('bash', input, {
        workspaceRoots: [join(dir, 'wsA')],
      });
      const otherRoot = await manager.checkPermissionForTool('bash', input, {
        workspaceRoots: [join(dir, 'wsB')],
      });
      expect(toDecision(sameRoot)).toBe('allow');
      expect(toDecision(otherRoot)).toBe('deny');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('simulate 与执行同源：同根命中该规则，异根不命中', async () => {
    const { dir, manager, rule } = build();
    try {
      const input = { command: 'npm test' };
      const simSame = await manager.simulatePermission({
        toolName: 'bash',
        input,
        mode: 'default',
        workspaceRoots: [join(dir, 'wsA')],
      });
      const simOther = await manager.simulatePermission({
        toolName: 'bash',
        input,
        mode: 'default',
        workspaceRoots: [join(dir, 'wsB')],
      });
      expect(simSame.matchedRules.some((r) => r.id === rule.id)).toBe(true);
      expect(simOther.matchedRules.some((r) => r.id === rule.id)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('`workspaceRoot` 规则不参与「整体工具」匹配（否则退化成全局放行）', () => {
    const manager = new PermissionManager();
    const rule = createPermissionRule({
      behavior: PermissionBehavior.ALLOW,
      toolName: 'bash',
      contentPattern: '^npm test$',
      workspaceRoot: WORKSPACE,
      source: PermissionRuleSource.RULE_STORE,
    });
    expect(manager.getRuleManager().toolMatchesRule('bash', rule)).toBe(false);
  });
});

describe('G3 本工作区永久信任 —— 去重与档位', () => {
  it('同命令不同工作区 ⇒ 两条规则都保留', () => {
    const rules = [
      exactCommandRule('npm test', WORKSPACE),
      exactCommandRule('npm test', 'e:\\PY\\Documents\\OTHER'),
    ];
    expect(deduplicateRules(rules)).toHaveLength(2);
  });

  it('命令类审批卡下发本档；非命令类不下发', () => {
    const commandOptions = buildApprovalOptions({
      toolName: 'bash',
      command: 'npm test',
      risk: RiskClass.SHELL,
    });
    expect(commandOptions).toContain('allowlist_workspace_command');
    const nonCommandOptions = buildApprovalOptions({
      toolName: 'file_read',
      risk: RiskClass.READ,
    });
    expect(nonCommandOptions).not.toContain('allowlist_workspace_command');
  });
});
