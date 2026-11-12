/**
 * M0-②（2026-11-12）：权限决策审计的**会话归因**。
 *
 * 背景（G4 围栏的前置埋点）：`auditDecision` 曾把 `sessionContext.sessionId` 硬编码为
 * `'permission-manager'` ⇒ 审计与围栏无法把 allow/ask/deny 归因到**会话**。
 * 本用例钉住两条契约（不放宽、不依赖 IO）：
 * ① 传入真实会话 ⇒ 原样写入；
 * ② 缺失 ⇒ 显式 `'unknown'`（不复制来源标签冒充会话，也不臆造 id）。
 */

import { describe, expect, it } from 'bun:test';
import {
  createAllowDecision,
  createAskDecision,
  createDenyDecision,
} from '@openliri/infra/permission/types/PermissionDecision';
import { buildAuditEvent } from '@openliri/infra/permission/manager/decisionTelemetry';

describe('M0-②：权限决策审计的会话归因', () => {
  it('传入真实会话 id ⇒ 原样写入（不再冒充来源标签）', () => {
    const event = buildAuditEvent(
      createDenyDecision('Denied by rule'),
      'bash',
      {},
      'sess-abc'
    );
    expect(event.sessionContext.sessionId).toBe('sess-abc');
    expect(event.sessionContext.sessionId).not.toBe('permission-manager');
  });

  it('缺失会话 id ⇒ 显式 unknown（不臆造、不复制来源标签）', () => {
    const event = buildAuditEvent(createAllowDecision('ok'), 'bash', {});
    expect(event.sessionContext.sessionId).toBe('unknown');
    // 空串 / 纯空白同样视同缺失（否则审计行里会出现"看着像会话"的空值）
    const emptyId = buildAuditEvent(createAllowDecision('ok'), 'bash', {}, '');
    expect(emptyId.sessionContext.sessionId).toBe('unknown');
    const blankId = buildAuditEvent(
      createAllowDecision('ok'),
      'bash',
      {},
      '   '
    );
    expect(blankId.sessionContext.sessionId).toBe('unknown');
  });

  it('三档决策都按传入会话归因', () => {
    for (const decision of [
      createAllowDecision('a'),
      createAskDecision('b'),
      createDenyDecision('c'),
    ]) {
      const event = buildAuditEvent(decision, 'bash', {}, 'sess-x');
      expect(event.sessionContext.sessionId).toBe('sess-x');
    }
  });

  it('其余审计语义保持不变（command / behavior / decision / riskLevel）', () => {
    const deny = buildAuditEvent(
      createDenyDecision('Denied by rule'),
      'bash',
      { command: 'rm -rf /' },
      's1'
    );
    expect(deny.command).toBe('rm -rf /');
    expect(deny.behavior).toBe('deny');
    expect(deny.decision).toBe('auto_denied');
    expect(deny.riskLevel).toBe('high');

    const allow = buildAuditEvent(createAllowDecision('ok'), 'read', {}, 's1');
    expect(allow.command).toBe('read');
    expect(allow.behavior).toBe('allow');
    expect(allow.decision).toBe('auto_allowed');
    expect(allow.riskLevel).toBe('medium');

    // P0-2：默认放行（权限空转）仍须标高危 —— 与 M0-② 无关的既有语义
    const defaultAllow = buildAuditEvent(
      createAllowDecision('No matching rules, default allowing'),
      'read',
      {},
      's1'
    );
    expect(defaultAllow.riskLevel).toBe('high');
  });
});
