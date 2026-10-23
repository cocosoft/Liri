// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * PR-2（2026-10-23）：四档审批的**档位解析**回归锁。
 *
 * 锁三条：
 *   ① `approve_session`（含选项式回复）⇒ 放行缓存 `session` 档，其余批准 ⇒ `once`；
 *   ② 「始终允许」落点缺失工具名/指纹摘要 ⇒ 解析为 null（**不**降级为工具级全放行）；
 *   ③ 由落点构造的「工具 + 参数指纹」规则确实能被 `isRuleMatch` 命中。
 */

import { describe, it, expect } from 'bun:test';
import {
  parseFingerprintAllowTarget,
  resolveApprovalScopeKind,
} from '../../src/runtime/inboxApproval.js';
import {
  hashApprovalFingerprint,
  hashCommandForExecution,
} from '../../src/permission/ApprovedCommandRegistry.js';
import {
  PermissionBehavior,
  createPermissionRule,
  isRuleMatch,
} from '../../src/permission/types/PermissionRule.js';
import { resolveApprovalFingerprint } from '../../src/permission/approvalFingerprint.js';

describe('PR-2：档位解析', () => {
  it('approve ⇒ once；approve_session ⇒ session', () => {
    expect(resolveApprovalScopeKind('approve')).toBe('once');
    expect(resolveApprovalScopeKind('approve_session')).toBe('session');
  });

  it('选项式回复（selectedOption）同样生效', () => {
    expect(resolveApprovalScopeKind('approve', 'approve_session')).toBe(
      'session'
    );
  });

  it('拒绝/白名单类不产生 session 档', () => {
    expect(resolveApprovalScopeKind('reject')).toBe('once');
    expect(resolveApprovalScopeKind('allowlist_call')).toBe('once');
  });
});

describe('PR-2：「始终允许」落点解析', () => {
  it('工具名 + 指纹摘要齐全 ⇒ 返回落点', () => {
    expect(
      parseFingerprintAllowTarget({
        toolName: 'file_write',
        approvalFingerprintHash: 'abc123',
      })
    ).toEqual({ toolName: 'file_write', inputFingerprint: 'abc123' });
  });

  it('缺工具名或缺指纹 ⇒ null（不得退化为工具级全放行）', () => {
    expect(
      parseFingerprintAllowTarget({ approvalFingerprintHash: 'abc' })
    ).toBe(null);
    expect(parseFingerprintAllowTarget({ toolName: 'file_write' })).toBe(null);
    expect(parseFingerprintAllowTarget(undefined)).toBe(null);
  });

  it('由落点构造的规则能命中同一指纹（端到端一致）', () => {
    const input = { file_path: 'notes/a.md', content: 'hello' };
    const fingerprint = resolveApprovalFingerprint('file_write', input);
    const target = parseFingerprintAllowTarget({
      toolName: 'file_write',
      approvalFingerprintHash: hashApprovalFingerprint(fingerprint),
    });
    expect(target).not.toBeNull();

    const rule = createPermissionRule({
      behavior: PermissionBehavior.ALLOW,
      toolName: target!.toolName,
      inputFingerprint: target!.inputFingerprint,
    });

    // 提交端与执行端用同一套计算（resolveApprovalFingerprint + hash）
    expect(hashCommandForExecution(fingerprint).length).toBeGreaterThan(8);
    expect(
      isRuleMatch(rule, 'file_write', input, {
        fingerprint: hashApprovalFingerprint(fingerprint),
      })
    ).toBe(true);
  });
});
