/**
 * Inbox 审批去重的 **DB 级约束**（2026-10-23，多租户/审批收口续做）
 *
 * 背景：提交前的 `findPendingApprovalId()` 只是"查询后新建"，查询与 INSERT 之间没有
 * DB 约束兜底。本用例锁定部分唯一索引：
 *  ① 同 `(sessionId, toolName, commandHash)` 的 pending approval ⇒ 只保留一张，
 *     第二次提交返回既有项（不抛错、不产生僵尸卡）；
 *  ② 参数指纹不同 / 会话不同 ⇒ 各自建卡（安全优先，不误合并）；
 *  ③ 非 approval 类型不受该索引影响。
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { InboxManager } from '../../src/runtime/InboxManager.js';

function approval(
  sessionId: string,
  toolName: string,
  commandHash: string
): Parameters<InboxManager['submit']>[0] {
  return {
    sessionId,
    type: 'approval',
    title: `工具审批: ${toolName}`,
    message: '需要人工确认',
    options: ['approve', 'deny'],
    offlineCapable: true,
    source: 'test',
    metadata: { sourceModule: 'test', toolName, commandHash },
  };
}

describe('Inbox 审批去重唯一索引', () => {
  let manager: InboxManager;

  beforeEach(() => {
    manager = new InboxManager(':memory:');
  });

  it('① 同会话 + 同工具 + 同指纹 ⇒ 只保留一张，第二次返回既有项', async () => {
    const first = await manager.submit(
      approval('sess-1', 'file_write', 'hash-a')
    );
    const second = await manager.submit(
      approval('sess-1', 'file_write', 'hash-a')
    );

    expect(second.id).toBe(first.id);
    const pending = await manager.list({ status: 'pending', type: 'approval' });
    expect(pending.total).toBe(1);
  });

  it('② 参数指纹不同 ⇒ 各自建卡（不误合并）', async () => {
    const a = await manager.submit(approval('sess-1', 'file_write', 'hash-a'));
    const b = await manager.submit(approval('sess-1', 'file_write', 'hash-b'));

    expect(b.id).not.toBe(a.id);
    const pending = await manager.list({ status: 'pending', type: 'approval' });
    expect(pending.total).toBe(2);
  });

  it('② 会话不同 ⇒ 各自建卡', async () => {
    const a = await manager.submit(approval('sess-1', 'file_write', 'hash-a'));
    const b = await manager.submit(approval('sess-2', 'file_write', 'hash-a'));

    expect(b.id).not.toBe(a.id);
    const pending = await manager.list({ status: 'pending', type: 'approval' });
    expect(pending.total).toBe(2);
  });

  it('③ 非 approval 类型不受唯一索引影响', async () => {
    const question = (
      title: string
    ): Parameters<InboxManager['submit']>[0] => ({
      sessionId: 'sess-1',
      type: 'question',
      title,
      message: '',
      offlineCapable: true,
      source: 'test',
      metadata: {
        sourceModule: 'test',
        toolName: 'file_write',
        commandHash: 'hash-a',
      },
    });

    const first = await manager.submit(question('问题 A'));
    const second = await manager.submit(question('问题 A'));

    expect(second.id).not.toBe(first.id);
  });
});
