/**
 * P37 · Inbox 结构化 attention 元数据 + 每工作项打扰计数（2026-11-02）
 *
 * 覆盖审计缺口「`toInboxMetadata` 无生产者」「无 `countByTicket` SQL 复算」：
 * ① `submit()` 统一写入固定键（kind / question / ticketId / triggerId / options）；
 * ② 无 attention、无持有者 ⇒ 仍写 kind/question（普通对话零绑定）；
 * ③ `countByTicket()` 与台账行数一致（含已回复/已过期口径）。
 */
import { describe, it, expect } from 'bun:test';
import { InboxManager } from '../../src/runtime/InboxManager.js';
import { readInboxAttention } from '@openliri/infra/attention';

function base(over: Record<string, unknown> = {}) {
  return {
    sessionId: 'sess-attention',
    type: 'approval' as const,
    title: '工具审批: bash',
    message: '是否允许执行？',
    options: ['approve', 'deny'],
    offlineCapable: true,
    source: 'permission',
    ...over,
  };
}

describe('InboxManager.submit：结构化 attention 元数据', () => {
  it('显式载荷 ⇒ 固定键完整，可被 readInboxAttention 还原', async () => {
    const manager = new InboxManager(':memory:');
    const item = await manager.submit(
      base({
        attention: {
          question: '是否继续执行？',
          ticketId: 'w-1',
          triggerId: 'tg-1',
        },
      })
    );

    expect(item.metadata).toMatchObject({
      attentionKind: 'approval',
      attentionQuestion: '是否继续执行？',
      ticketId: 'w-1',
      triggerId: 'tg-1',
      options: ['approve', 'deny'],
    });
    expect(readInboxAttention(item.metadata)).toEqual({
      kind: 'approval',
      question: '是否继续执行？',
      ticketId: 'w-1',
      triggerId: 'tg-1',
    });
  });

  it('无 attention ⇒ 仍写 kind/question；显式 metadata 同名字段优先', async () => {
    const manager = new InboxManager(':memory:');
    const item = await manager.submit(
      base({ metadata: { ticketId: 'w-explicit', sourceModule: 'lro-step' } })
    );

    expect(item.metadata).toMatchObject({
      attentionKind: 'approval',
      attentionQuestion: '是否允许执行？',
      ticketId: 'w-explicit',
      sourceModule: 'lro-step',
    });
  });
});

describe('InboxManager.countByTicket：DB 复算', () => {
  it('按 ticketId 计数；不同工作项互不影响', async () => {
    const manager = new InboxManager(':memory:');
    await manager.submit(base({ attention: { ticketId: 'w-1' } }));
    await manager.submit(base({ attention: { ticketId: 'w-1' } }));
    await manager.submit(base({ attention: { ticketId: 'w-2' } }));
    await manager.submit(base());

    expect(await manager.countByTicket('w-1')).toBe(2);
    expect(await manager.countByTicket('w-2')).toBe(1);
    expect(await manager.countByTicket('w-unknown')).toBe(0);
    expect(await manager.countByTicket('')).toBe(0);
  });
});

describe('InboxManager.listActionableTicketIds：面板四条件', () => {
  it('未解决 / 未 dismiss / 最新 / Thread 空闲 ⇒ 返回 ticketId（每项一条）', async () => {
    const manager = new InboxManager(':memory:');
    await manager.submit(base({ attention: { ticketId: 'w-1' } }));
    await manager.submit(base({ attention: { ticketId: 'w-1' } }));
    await manager.submit(base({ attention: { ticketId: 'w-2' } }));
    await manager.submit(base());

    const ids = await manager.listActionableTicketIds();
    expect(ids.sort()).toEqual(['w-1', 'w-2']);
    expect(ids.filter((id) => id === 'w-1')).toHaveLength(1);
  });

  it('Thread 排队/评估中（busy）⇒ 不提示该工作项', async () => {
    const manager = new InboxManager(':memory:');
    await manager.submit(base({ attention: { ticketId: 'w-1' } }));
    await manager.submit(base({ attention: { ticketId: 'w-2' } }));

    expect(await manager.listActionableTicketIds(['w-1'])).toEqual(['w-2']);
    expect(await manager.listActionableTicketIds(['w-1', 'w-2'])).toEqual([]);
  });

  it('已回复 / 已 dismiss / 无 ticketId ⇒ 不提示', async () => {
    const manager = new InboxManager(':memory:');
    const replied = await manager.submit(
      base({ attention: { ticketId: 'w-1' } })
    );
    await manager.submit(base({ attention: { ticketId: 'w-2' } }));
    await manager.submit(base());

    await manager.reply(replied.id, 'approve');
    expect(await manager.listActionableTicketIds()).toEqual(['w-2']);

    await manager.dismissBySession('sess-attention');
    expect(await manager.listActionableTicketIds()).toEqual([]);
  });
});
