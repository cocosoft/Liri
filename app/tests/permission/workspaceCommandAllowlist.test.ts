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

import {
  createPermissionRule,
  isRuleMatch,
  PermissionBehavior,
  PermissionRuleSource,
} from '@openliri/infra/permission/types/PermissionRule';
import { deduplicateRules } from '@openliri/infra/permission/RuleManager';
import { buildApprovalOptions } from '@openliri/infra/permission/toolApprovalSubmission';
import { RiskClass } from '@openliri/infra/permission/types/RiskClass.js';

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
