/**
 * 移动端审计载荷（P2.5，2026-10-20）
 *
 * 只测**纯映射**（不落盘）：保证每条审计都带 `channel='mobile'` + `deviceId`，
 * 且事件类型/严重级别符合口径（消息=data_access，配对与鉴权拒绝=authentication）。
 */

import { describe, expect, it } from 'bun:test';
import { buildMobileAuditPayload } from '../../src/channels/mobile/MobileAudit';

describe('MobileAudit：审计载荷映射', () => {
  it('入站消息 ⇒ data_access，带 channel + deviceId + 会话/消息 id', () => {
    const payload = buildMobileAuditPayload({
      kind: 'message_received',
      deviceId: 'dev-1',
      conversationId: 'conv-1',
      messageId: 'msg-1',
      textLength: 42,
      success: true,
    });

    expect(payload.type).toBe('data_access');
    expect(payload.action).toBe('mobile.message.received');
    expect(payload.actor).toBe('dev-1');
    expect(payload.resource).toBe('channel:mobile');
    expect(payload.success).toBe(true);
    expect(payload.details).toEqual({
      channel: 'mobile',
      deviceId: 'dev-1',
      conversationId: 'conv-1',
      messageId: 'msg-1',
      textLength: 42,
    });
  });

  it('入站消息失败 ⇒ 保留 failureReason', () => {
    const payload = buildMobileAuditPayload({
      kind: 'message_received',
      deviceId: 'dev-1',
      conversationId: 'conv-1',
      messageId: 'msg-1',
      textLength: 1,
      success: false,
      reason: 'DAILY_BUDGET_EXCEEDED',
    });
    expect(payload.success).toBe(false);
    expect(payload.failureReason).toBe('DAILY_BUDGET_EXCEEDED');
  });

  it('配对 ⇒ authentication（失败带原因）', () => {
    const failed = buildMobileAuditPayload({
      kind: 'pairing',
      deviceId: 'dev-2',
      success: false,
      reason: '配对码已过期',
    });
    expect(failed.type).toBe('authentication');
    expect(failed.action).toBe('mobile.pairing.verify');
    expect(failed.details['deviceId']).toBe('dev-2');
    expect(failed.failureReason).toBe('配对码已过期');
  });

  it('鉴权拒绝 ⇒ authentication + warning（强制 success=false）', () => {
    const payload = buildMobileAuditPayload({
      kind: 'auth_denied',
      deviceId: 'dev-3',
      reason: 'invalid or expired device token',
    });
    expect(payload.type).toBe('authentication');
    expect(payload.severity).toBe('warning');
    expect(payload.success).toBe(false);
    expect(payload.action).toBe('mobile.auth.denied');
  });
});
