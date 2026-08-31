/**
 * InboxManager 幂等性契约（M2-T2.1 / M2-T2.2）
 *
 * T2.1 first-responder-wins：同一审批双渠道并发答复 → 恰一个抢到锁，
 *     二次答复幂等拒绝（DB 级 CAS：UPDATE ... WHERE status = expected）。
 * T2.2 dismissBySession：删除会话时级联关闭孤儿审批项（pending/processing → dismissed），
 *     已回复项不受影响，被关闭项不可再答复。
 *
 * 使用 :memory: DB 独立实例，不污染真实 inbox_items。
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { InboxManager } from '../../src/runtime/InboxManager.js';

describe('InboxManager CAS 幂等（M2-T2.1）', () => {
  let manager: InboxManager;

  beforeEach(() => {
    manager = new InboxManager(':memory:');
  });

  async function submitItem(sessionId = 'sess-1', title = '工具审批: test') {
    return manager.submit({
      sessionId,
      type: 'approval',
      title,
      message: '需要人工确认',
      options: ['approve', 'deny'],
      offlineCapable: true,
      source: 'test',
      metadata: { sourceModule: 'test' },
    });
  }

  it('① 双渠道并发答复：first-responder-wins（恰一个抢到锁）', async () => {
    const item = await submitItem();
    expect(item.status).toBe('pending');

    // 并发两次 CAS（模拟 HTTP 双渠道同时 reply）
    const results = await Promise.all([
      manager.tryUpdateStatus(item.id, 'pending', 'processing'),
      manager.tryUpdateStatus(item.id, 'pending', 'processing'),
    ]);

    expect(results.filter(Boolean).length).toBe(1);
  });

  it('② 抢锁成功后 reply 放行；未抢到方二次 reply 幂等拒绝', async () => {
    const item = await submitItem();
    const locked = await manager.tryUpdateStatus(
      item.id,
      'pending',
      'processing'
    );
    expect(locked).toBe(true);

    // 抢锁方 reply 成功
    const replied = await manager.reply(item.id, 'approve');
    expect(replied).toBeTruthy();
    expect(replied?.status).toBe('replied');

    // 未抢到方（或重复答复）再 reply → 拒绝（非 pending/processing）
    const again = await manager.reply(item.id, 'approve');
    expect(again).toBeNull();
  });

  it('③ reply 前状态已变（expired）→ CAS 失败且 reply 拒绝', async () => {
    const item = await submitItem();
    // 模拟过期调度已把状态置为 expired
    const expired = await manager.tryUpdateStatus(
      item.id,
      'pending',
      'expired'
    );
    expect(expired).toBe(true);

    // 过期后并发答复 → CAS 失败
    const locked = await manager.tryUpdateStatus(
      item.id,
      'pending',
      'processing'
    );
    expect(locked).toBe(false);
    const replied = await manager.reply(item.id, 'approve');
    expect(replied).toBeNull();
  });
});

describe('InboxManager dismissBySession 级联关闭（M2-T2.2）', () => {
  let manager: InboxManager;

  beforeEach(() => {
    manager = new InboxManager(':memory:');
  });

  it('① 删除会话关闭所有 pending/processing 审批项，已回复项不受影响', async () => {
    const p1 = await manager.submit({
      sessionId: 'sess-del',
      type: 'approval',
      title: '审批1',
      message: 'm',
      offlineCapable: true,
      source: 'test',
      metadata: { sourceModule: 'test' },
    });
    const p2 = await manager.submit({
      sessionId: 'sess-del',
      type: 'approval',
      title: '审批2',
      message: 'm',
      offlineCapable: true,
      source: 'test',
      metadata: { sourceModule: 'test' },
    });
    // 一个已回复项
    await manager.tryUpdateStatus(p2.id, 'pending', 'processing');
    await manager.reply(p2.id, 'approve');

    // 另一个会话的 pending 项不应被关闭
    const other = await manager.submit({
      sessionId: 'sess-other',
      type: 'approval',
      title: '其他审批',
      message: 'm',
      offlineCapable: true,
      source: 'test',
      metadata: { sourceModule: 'test' },
    });

    const closed = await manager.dismissBySession('sess-del');
    expect(closed).toBe(1); // 仅 p1（pending）被关闭，p2 已 replied 不受影响

    const dismissed = await manager.get(p1.id);
    expect(dismissed?.status).toBe('dismissed');
    // 被关闭项不可再答复
    expect(await manager.reply(p1.id, 'approve')).toBeNull();

    const replied = await manager.get(p2.id);
    expect(replied?.status).toBe('replied');
    // 其他会话不受影响
    expect((await manager.get(other.id))?.status).toBe('pending');
  });
});
