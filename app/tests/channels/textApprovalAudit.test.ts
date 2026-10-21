/**
 * 文本审批（IM 渠道"回复同意/拒绝"）必须留审计痕迹
 *
 * 背景：`tryHandleTextApproval` 是**绕过前端审批卡**的放行路径 —— 用户在飞书/钉钉里
 * 回一句"同意"，工具就真的被执行了。移动端 HTTP 路径有 `recordMobileAudit`，
 * 这条路径此前完全没有审计 ⇒ 无法回答"谁批准了这次危险操作"。
 *
 * 覆盖：
 * ① 载荷口径（approve / reject / 失败三种）；
 * ② **接线级**：调用 `recordTextApprovalAudit` 后，企业审计里能查到这条 `approval_action`
 *    （用临时数据根，避免写入真实 `~/.pyapp`）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { setUserDataDirOverride } from '../../src/core/paths.js';
import {
  buildTextApprovalAuditPayload,
  recordTextApprovalAudit,
  type TextApprovalAuditInput,
} from '../../src/channels/routing/textApproval.js';
import {
  AuditEventType,
  EnterpriseAuditService,
} from '../../src/config/enterprise/audit/EnterpriseAuditService.js';

const BASE: TextApprovalAuditInput = {
  channelName: 'feishu',
  senderId: 'ou_user_1',
  conversationId: 'oc_chat_1',
  itemId: 'inbox-1',
  itemTitle: '执行 rm -rf build',
  intent: 'approve',
  traceId: 'trace-1',
  success: true,
};

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'liri-text-approval-audit-'));
  setUserDataDirOverride(root);
});

afterEach(() => {
  setUserDataDirOverride(null);
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // @ignore-catch — 清理临时目录失败不影响断言
  }
});

describe('buildTextApprovalAuditPayload', () => {
  it('批准 ⇒ approval_action / info，资源指向 inbox 条目，details 带渠道与人', () => {
    const payload = buildTextApprovalAuditPayload(BASE);
    expect(payload.type).toBe('approval_action');
    expect(payload.severity).toBe('info');
    expect(payload.action).toBe('channel.approval.approve');
    expect(payload.resource).toBe('inbox:inbox-1');
    expect(payload.actor).toBe('ou_user_1');
    expect(payload.success).toBe(true);
    expect(payload.failureReason).toBeUndefined();
    expect(payload.details).toMatchObject({
      channel: 'feishu',
      conversationId: 'oc_chat_1',
      itemId: 'inbox-1',
      intent: 'approve',
      traceId: 'trace-1',
    });
  });

  it('拒绝 ⇒ action 区分 reject（审计要能看出"拒绝"而非"批准"）', () => {
    const payload = buildTextApprovalAuditPayload({
      ...BASE,
      intent: 'reject',
    });
    expect(payload.action).toBe('channel.approval.reject');
    expect(payload.severity).toBe('info');
  });

  it('失败 ⇒ warning + failureReason（写入失败也要留痕）', () => {
    const payload = buildTextApprovalAuditPayload({
      ...BASE,
      success: false,
      failureReason: 'Inbox 不可用',
    });
    expect(payload.severity).toBe('warning');
    expect(payload.success).toBe(false);
    expect(payload.failureReason).toBe('Inbox 不可用');
  });
});

describe('recordTextApprovalAudit（接线级）', () => {
  it('落进企业审计：可按 APPROVAL_ACTION 查到，且字段与载荷一致', async () => {
    await recordTextApprovalAudit(BASE);

    const service = EnterpriseAuditService.getInstance();
    const result = await service.query({
      types: [AuditEventType.APPROVAL_ACTION],
      resource: 'inbox:inbox-1',
    });

    expect(result.total).toBe(1);
    const event = result.events[0]!;
    expect(event.action).toBe('channel.approval.approve');
    expect(event.actor).toBe('ou_user_1');
    expect(event.severity).toBe('info');
    expect(event.success).toBe(true);
    expect(event.details).toMatchObject({
      channel: 'feishu',
      itemId: 'inbox-1',
    });
  });
});
