// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P1（2026-11-04）：工具审批卡**唯一构造点**的回归守卫。
 *
 * 背景：判定前（`PermissionChecker._submitToInbox`）与执行后（`toolApproval.ts#submitToolApproval`）
 * 曾各自拼一张卡，导致执行后路径缺 `metadata.risk`、`EXTERNAL` 类工具仍给永久放行选项。
 * 现在两者共用 `buildToolApprovalCard()`，本用例锁定"同一工具+参数 ⇒ 卡片字段一致"。
 */

import { describe, it, expect } from 'bun:test';
import { buildToolApprovalCard } from '@openliri/infra/permission';
import { RiskClass } from '@openliri/infra/permission/types/RiskClass';

describe('P1：审批卡唯一构造点', () => {
  it('同工具+同参数 ⇒ 指纹/hash/选项一致（两条路径只差来源字段）', () => {
    const base = {
      toolOrName: 'bash',
      input: { command: 'npm test' },
      sessionId: 'sess-1',
    };
    const beforeDecision = buildToolApprovalCard(base);
    const afterExecute = buildToolApprovalCard({
      ...base,
      approvalReason: '需要人工确认',
      toolCallId: 'call-1',
      sourceModule: 'chat-tool-approval',
    });

    expect(afterExecute.commandHash).toBe(beforeDecision.commandHash);
    expect(afterExecute.fingerprintHash).toBe(beforeDecision.fingerprintHash);
    expect(afterExecute.options).toEqual(beforeDecision.options);
    expect(afterExecute.risk).toBe(beforeDecision.risk);
    // 链 id 必须**每张卡唯一**（同指纹复用卡时不能把两条申请串成一条链）
    expect(afterExecute.approvalId).not.toBe(beforeDecision.approvalId);
  });

  it('命令类工具 ⇒ 五档选项（含命令白名单与工具级放行）', () => {
    const card = buildToolApprovalCard({
      toolOrName: 'bash',
      input: { command: 'ls' },
      sessionId: 's',
    });
    expect(card.options).toEqual([
      'approve',
      'approve_session',
      'allowlist_command',
      'allowlist_tool',
      'deny',
    ]);
    expect(card.metadata['command']).toBe('ls');
    expect(card.risk).toBe(RiskClass.SHELL);
  });

  it('外部发送类工具 ⇒ 不给永久放行选项（本次/本会话/拒绝）', () => {
    const card = buildToolApprovalCard({
      toolOrName: 'send_email',
      input: { to: 'a@b.c' },
      sessionId: 's',
    });
    expect(card.risk).toBe(RiskClass.EXTERNAL);
    expect(card.options).toEqual(['approve', 'approve_session', 'deny']);
  });

  it('其余工具 ⇒ 四档选项（含参数指纹放行）', () => {
    const card = buildToolApprovalCard({
      toolOrName: 'file_write',
      input: { file_path: '/tmp/a.txt' },
      sessionId: 's',
    });
    expect(card.options).toEqual([
      'approve',
      'approve_session',
      'allowlist_call',
      'deny',
    ]);
  });

  it('执行后路径的扩展字段被如实写入（risk / scope / snapshot / sourceModule）', () => {
    const card = buildToolApprovalCard({
      toolOrName: 'bash',
      input: { command: 'ls' },
      sessionId: 's',
      approvalReason: '风险拦截',
      toolCallId: 'call-9',
      sourceModule: 'chat-tool-approval',
      approvalScope: { cwd: '/tmp', envHash: 'h', platform: 'linux' } as never,
      approvalSnapshot: { original: 'ls', normalized: 'ls' } as never,
    });
    expect(card.metadata['risk']).toBe(RiskClass.SHELL);
    expect(card.metadata['toolCallId']).toBe('call-9');
    expect(card.metadata['sourceModule']).toBe('chat-tool-approval');
    expect(card.metadata['approvalScope']).toBeDefined();
    expect(card.metadata['approvalSnapshot']).toBeDefined();
    expect(card.message.startsWith('风险拦截\n')).toBe(true);
  });
});
