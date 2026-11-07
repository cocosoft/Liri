// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 2026-11-07 真机：PowerShell 的 ask 档此前只回失败文本（无 `requireApproval`）
 * ⇒ 永远没有审批卡可批，命令成为死路。本用例锁住「ask ⇒ 审批卡可建」与
 * 「已批准/规则命中 ⇒ 放行继续执行」两条契约（硬 deny 不受影响）。
 */
import { describe, expect, it } from 'bun:test';

import { buildPowerShellSecurityBlock } from '../../src/tools/PowerShellTool/PowerShellTool';

const approval = {
  scope: { platform: process.platform, cwd: 'C:\\proj' },
  snapshot: {
    originalCommand: 'Remove-Item -Recurse -Force x',
    normalizedCommand: 'Remove-Item -Recurse -Force x',
    rewrites: [],
  },
};
const askDecision = {
  allowed: false,
  behavior: 'ask' as const,
  code: 'USER_CONFIRMATION_REQUIRED' as const,
  message: '检测到递归删除操作，请确认目标和范围',
};

describe('buildPowerShellSecurityBlock', () => {
  it('ask 且未获批 ⇒ requireApproval + 作用域/快照（进入审批卡）', () => {
    const result = buildPowerShellSecurityBlock(askDecision, {
      preApproved: false,
      approval,
      startTime: Date.now(),
    });
    expect(result).not.toBeNull();
    const r = result as unknown as {
      success?: boolean;
      requireApproval?: boolean;
      approvalReason?: string;
      failureKind?: string;
      metadata?: Record<string, unknown>;
    };
    expect(r.success).toBe(false);
    expect(r.requireApproval).toBe(true);
    expect(r.approvalReason).toContain('递归删除');
    expect(r.failureKind).toBe('permission_denied');
    expect(r.metadata?.['approvalScope']).toEqual(approval.scope);
    expect(r.metadata?.['approvalSnapshot']).toEqual(approval.snapshot);
  });

  it('ask 但已批准/规则命中 ⇒ 不阻断（继续走硬拦截与执行）', () => {
    expect(
      buildPowerShellSecurityBlock(askDecision, {
        preApproved: true,
        approval,
        startTime: Date.now(),
      })
    ).toBeNull();
  });

  it('deny 即使已批准也阻断（且不带 requireApproval）', () => {
    const result = buildPowerShellSecurityBlock(
      {
        allowed: false,
        behavior: 'deny',
        code: 'SECURITY_DENIED',
        message: '命令被阻止执行',
      },
      { preApproved: true, approval, startTime: Date.now() }
    );
    const r = result as unknown as { requireApproval?: boolean };
    expect(result).not.toBeNull();
    expect(r.requireApproval).toBeUndefined();
  });

  it('allowed ⇒ 不阻断', () => {
    expect(
      buildPowerShellSecurityBlock(
        { allowed: true, behavior: 'allow' },
        { preApproved: false, approval, startTime: Date.now() }
      )
    ).toBeNull();
  });
});
