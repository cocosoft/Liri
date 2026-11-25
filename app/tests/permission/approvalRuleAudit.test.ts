// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 审批放行规则巡检的分类（2026-11-25）。
 *
 * 回归：历史审批规则中的 `^powershell -Command.*` / `^cd /d.*` / `^git push.*`
 * 会把一次批准放大成"任意参数/复合命令"；本用例锁定 high/review/low/ok 四档判据。
 */
import { describe, expect, it } from 'bun:test';

import {
  auditApprovalRules,
  classifyApprovalRule,
  type AuditRuleInput,
} from '@openliri/infra/permission';
import { PermissionBehavior } from '@openliri/infra/permission/types/PermissionRule';

const allow = (
  id: string,
  toolName: string,
  contentPattern?: string,
  extra: Partial<AuditRuleInput> = {}
): AuditRuleInput =>
  ({
    id,
    behavior: PermissionBehavior.ALLOW,
    toolName,
    ...(contentPattern !== undefined ? { contentPattern } : {}),
    source: 'ruleStore' as never,
    priority: 1,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...extra,
  }) as AuditRuleInput;

const levelOf = (rule: AuditRuleInput): string =>
  classifyApprovalRule(rule)?.level ?? 'none';

describe('classifyApprovalRule（审批规则巡检）', () => {
  it('解释器/壳内建前缀 ⇒ high', () => {
    expect(levelOf(allow('a', 'bash', '^powershell -Command.*'))).toBe('high');
    expect(levelOf(allow('b', 'bash', '^cd /d.*'))).toBe('high');
    expect(levelOf(allow('c', 'bash', '^python "C:\\\\x.py".*'))).toBe('high');
  });

  it('危险命令头前缀 ⇒ high；ask 档可变前缀 ⇒ review', () => {
    expect(levelOf(allow('d', 'bash', '^git push.*'))).toBe('high');
    expect(levelOf(allow('e', 'bash', '^rm -rf.*'))).toBe('high');
    // `gh pr merge` 属 ask 档（非硬拒），不在硬拒词表 ⇒ 归入 review（需人工判断）
    expect(levelOf(allow('e2', 'bash', '^gh pr merge.*'))).toBe('review');
  });

  it('只读命令前缀 ⇒ low；非只读可变前缀 ⇒ review', () => {
    expect(levelOf(allow('f', 'bash', '^dir "C:\\\\a".*'))).toBe('low');
    // `git` 不在严格只读基命令集合（子命令差异大）⇒ 保守归 review
    expect(levelOf(allow('g', 'bash', '^git status.*'))).toBe('review');
  });

  it('精确匹配 / 参数指纹 / 非命令工具 ⇒ ok 或 none', () => {
    expect(levelOf(allow('h', 'bash', '^python "C:\\\\a.py"$'))).toBe('ok');
    expect(
      levelOf(allow('i', 'bash', undefined, { inputFingerprint: 'fp' }))
    ).toBe('ok');
    expect(levelOf(allow('j', 'file_write', '^.*'))).toBe('none');
  });

  it('命令类工具整工具放行（无内容条件/无指纹）⇒ high', () => {
    expect(levelOf(allow('k', 'bash', undefined))).toBe('high');
  });

  it('无法解析命令头 ⇒ review', () => {
    expect(levelOf(allow('l', 'bash', '^.*'))).toBe('review');
  });

  it('auditApprovalRules：排序、计数与 origin 推导', () => {
    const report = auditApprovalRules([
      allow('ok-1', 'bash', '^python "C:\\\\a.py"$'),
      allow('low-1', 'bash', '^dir .*'),
      allow('high-1', 'bash', '^cd /d.*', {
        origin: 'approval',
        hitCount: 12,
      }),
      allow('high-2', 'bash', '^git push.*'),
    ]);

    expect(report.counts).toEqual({ high: 2, review: 0, low: 1, ok: 1 });
    expect(report.audited.map((row) => row.id)).toEqual([
      'high-1',
      'high-2',
      'low-1',
      'ok-1',
    ]);
    expect(report.high.map((row) => row.id)).toEqual(['high-1', 'high-2']);
    // 显式 origin 保留；缺省按匹配条件推导（普通内容规则 ⇒ user）
    expect(report.audited.find((row) => row.id === 'high-1')?.origin).toBe(
      'approval'
    );
    expect(report.audited.find((row) => row.id === 'high-2')?.origin).toBe(
      'user'
    );
    expect(report.audited.find((row) => row.id === 'high-1')?.hitCount).toBe(
      12
    );
  });
});
