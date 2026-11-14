// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P1（2026-11-07 真机）：审批「命令级免审批」链路 —— 从按钮到真正生效。
 *
 * 真机暴露两个缺陷：
 * 1. `contentPattern` 只对 `JSON.stringify(input)` 做正则 ⇒ 审批卡写下的 `^node -e.*`
 *    永远不命中（JSON 以 `{"command":"` 开头）⇒「以后这个命令免审批」批了也不生效；
 * 2. 命令类工具只认 bash ⇒ PowerShell 工具既拿不到命令级档位，设置里的命令黑名单/白名单
 *    也管不到它。
 */

import { describe, it, expect } from 'bun:test';

import { buildToolApprovalCard } from '@openliri/infra/permission';
import {
  createPermissionRule,
  isRuleMatch,
  PermissionBehavior,
} from '@openliri/infra/permission/types/PermissionRule';
import { checkBashDangerousCommand } from '../../src/tools/bash/bashSecurityGate';
import { isBaseCommandAllowed } from '../../src/tools/bash/bashCommandPolicy';

function allowRule(toolName: string, contentPattern: string) {
  return createPermissionRule({
    behavior: PermissionBehavior.ALLOW,
    toolName,
    contentPattern,
  });
}

describe('P1：命令级放行规则（contentPattern）对命令原文生效', () => {
  it('审批卡写下的 `^node -e.*` 能命中同一前缀的命令', () => {
    const rule = allowRule('bash', '^node -e.*');
    expect(
      isRuleMatch(rule, 'bash', { command: 'node -e "console.log(1)"' })
    ).toBe(true);
    // 负向：不同前缀不得命中
    expect(isRuleMatch(rule, 'bash', { command: 'node check.js' })).toBe(false);
  });

  it('无 command 字段时仍按 JSON 兜底匹配（既有内容规则不失效）', () => {
    const rule = allowRule('file_write', 'a\\.txt');
    expect(isRuleMatch(rule, 'file_write', { path: 'a.txt' })).toBe(true);
  });

  it('PowerShell 工具同样适用命令级规则（toolName 精确匹配）', () => {
    const rule = allowRule('powershell', '^Get-ChildItem.*');
    expect(
      isRuleMatch(rule, 'powershell', { command: 'Get-ChildItem -Recurse' })
    ).toBe(true);
    // 工具名不匹配 ⇒ 不命中（避免跨工具串用）
    expect(
      isRuleMatch(rule, 'bash', { command: 'Get-ChildItem -Recurse' })
    ).toBe(false);
  });
});

describe('P1：命令类工具的审批档位（powershell 与 bash 同口径）', () => {
  it('powershell 携带命令文本 ⇒ 五档（含命令级 + 本工作区永久信任 + 工具级）', () => {
    const card = buildToolApprovalCard({
      toolOrName: 'powershell',
      input: { command: 'Get-ChildItem -Recurse' },
      sessionId: 's',
    });
    expect(card.options).toEqual([
      'approve',
      'allowlist_command',
      'allowlist_workspace_command',
      'allowlist_tool',
      'deny',
    ]);
  });

  it('命令类工具但没有命令文本 ⇒ 不给命令级（否则会退化成整工具放行）', () => {
    const card = buildToolApprovalCard({
      toolOrName: 'powershell',
      input: {},
      sessionId: 's',
    });
    expect(card.options).not.toContain('allowlist_command');
    expect(card.options).toContain('allowlist_call');
  });
});

describe('P1：只读命令不再被当成危险命令', () => {
  it('只读搜索词含 exec / source ⇒ 不再命中危险模式', () => {
    expect(checkBashDangerousCommand('grep -rn "exec " src')).toBeNull();
    expect(checkBashDangerousCommand('grep -rn source src')).toBeNull();
  });

  it('【负向对照】命令位上的 exec ⇒ 仍拦截', () => {
    const blocked = checkBashDangerousCommand('exec ls');
    expect(blocked).not.toBeNull();
    expect(
      (blocked?.metadata as Record<string, unknown> | undefined)?.reason
    ).toBe('dangerous_pattern');
  });

  it('只读族已并入基命令白名单（rg / head / wc / tree / netstat）', () => {
    for (const name of ['rg', 'head', 'wc', 'tree', 'tasklist', 'netstat']) {
      expect(isBaseCommandAllowed(name)).toBe(true);
    }
    // 负向：未知可执行名仍然不放行
    expect(isBaseCommandAllowed('some-unknown-binary')).toBe(false);
  });
});
