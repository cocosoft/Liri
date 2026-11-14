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
import {
  buildApprovalOptions,
  buildToolApprovalCard,
  hashCommandForExecution,
} from '@openliri/infra/permission';
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

  it('命令类工具 ⇒ 五档选项（仅这次 / 命令级 / 本工作区永久信任 / 工具级 / 拒绝）', () => {
    const card = buildToolApprovalCard({
      toolOrName: 'bash',
      input: { command: 'ls' },
      sessionId: 's',
    });
    expect(card.options).toEqual([
      'approve',
      'allowlist_command',
      'allowlist_workspace_command',
      'allowlist_tool',
      'deny',
    ]);
    expect(card.metadata['command']).toBe('ls');
    expect(card.risk).toBe(RiskClass.SHELL);
  });

  // 2026-11-08（真机 pdca_mw6mbd7w）：卡片的 commandHash 必须与执行端一致，
  // 否则用户批准后同一命令仍被 ask（"批了不生效"）。
  it('命令类工具 ⇒ commandHash 等于执行端 hashCommandForExecution(command)', () => {
    const command = 'node -e "console.log(\'pdca-approve-ok\')"';
    const card = buildToolApprovalCard({
      toolOrName: 'bash',
      input: { command },
      sessionId: 's',
    });
    expect(card.commandHash).toBe(hashCommandForExecution(command));
    // 且**不得**退化成全参数指纹（`bash:{"command":…}`）的 hash
    expect(card.commandHash).not.toBe(
      hashCommandForExecution(`bash:${JSON.stringify({ command })}`)
    );
  });

  it('外部发送类工具 ⇒ 不给永久放行选项（仅这次/拒绝）', () => {
    const card = buildToolApprovalCard({
      toolOrName: 'send_email',
      input: { to: 'a@b.c' },
      sessionId: 's',
    });
    expect(card.risk).toBe(RiskClass.EXTERNAL);
    expect(card.options).toEqual(['approve', 'deny']);
  });

  it('其余工具 ⇒ 三档选项（含参数指纹放行）', () => {
    const card = buildToolApprovalCard({
      toolOrName: 'file_write',
      input: { file_path: '/tmp/a.txt' },
      sessionId: 's',
    });
    expect(card.options).toEqual(['approve', 'allowlist_call', 'deny']);
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

/**
 * 2026-11-08（第三十八轮，真机 `pdca_mw7l43fu`）：LRO 步骤审批卡曾自写
 * `['approve','approve_session','deny']` —— P0 收敛后该路径没跟上。现两处共用
 * `buildApprovalOptions`（唯一真源），下面锁死四类判定。
 */
describe('P0：审批卡选项唯一真源 buildApprovalOptions', () => {
  it('命令类 + 有命令文本 ⇒ 四档 + 拒绝', () => {
    expect(
      buildApprovalOptions({
        toolName: 'bash',
        command: 'node -e "console.log(1)"',
        risk: RiskClass.SHELL,
      })
    ).toEqual([
      'approve',
      'allowlist_command',
      'allowlist_workspace_command',
      'allowlist_tool',
      'deny',
    ]);
  });

  it('命令类但命令为空 ⇒ 退化为指纹档（避免空 contentPattern 变成整工具放行）', () => {
    expect(
      buildApprovalOptions({
        toolName: 'bash',
        command: '   ',
        risk: RiskClass.SHELL,
      })
    ).toEqual(['approve', 'allowlist_call', 'deny']);
  });

  it('EXTERNAL ⇒ 仅本次 / 拒绝（外部副作用不给永久放行）', () => {
    expect(
      buildApprovalOptions({
        toolName: 'send_email',
        risk: RiskClass.EXTERNAL,
      })
    ).toEqual(['approve', 'deny']);
  });

  it('非命令类工具 ⇒ 指纹档', () => {
    expect(
      buildApprovalOptions({
        toolName: 'file_write',
        risk: RiskClass.WRITE_LOCAL,
      })
    ).toEqual(['approve', 'allowlist_call', 'deny']);
  });
});
