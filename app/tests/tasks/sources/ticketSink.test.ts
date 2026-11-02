/**
 * P35 · Trigger → Ticket 生产 sink（2026-11-02）
 *
 * 覆盖：
 * ① 新 Trigger ⇒ 建一条 `queued` 工作项（id = `trigger:<triggerId>`）；
 * ② 已存在 ⇒ **跳过**（不得把执行侧推进的终态写回 `queued`）；
 * ③ 同批次多条 ⇒ 逐条创建。
 */
import { describe, it, expect } from 'bun:test';

import {
  createTriggerTicketSink,
  triggerTicketId,
} from '../../../src/tasks/sources/ticketSink';
import type { Trigger } from '../../../src/tasks/sources/types';

function trigger(over: Partial<Trigger> = {}): Trigger {
  return {
    triggerId: 'tg1-abc',
    sourceId: 'cron',
    threadKey: 'cron:job-1' as Trigger['threadKey'],
    type: 'cron_tick',
    externalId: 'job-1@1000',
    payload: { jobId: 'job-1', name: '每日巡检', message: '检查构建' },
    receivedAt: 1000,
    ...over,
  };
}

function makeStore() {
  const rows = new Map<string, Record<string, unknown>>();
  return {
    rows,
    read: async (id: string) => rows.get(id) ?? null,
    write: async (record: Record<string, unknown>) => {
      rows.set(String(record.id), record);
    },
  };
}

describe('Trigger→Ticket sink', () => {
  it('新 Trigger ⇒ queued 工作项（字段来自 Trigger，不做语义解释）', async () => {
    const store = makeStore();
    const sink = createTriggerTicketSink({
      read: store.read,
      write: store.write,
      now: () => 2000,
    });

    await sink('cron:job-1' as Trigger['threadKey'], [trigger()]);

    const row = store.rows.get(triggerTicketId('tg1-abc'));
    expect(row).toMatchObject({
      id: 'trigger:tg1-abc',
      title: 'cron · 每日巡检',
      description: '检查构建',
      status: 'queued',
      sourceId: 'cron',
      origin: { threadId: 'cron:job-1' },
      triggerId: 'tg1-abc',
      execution: 'external',
      lastAction: 'trigger_received',
      subscriptions: [{ source: 'cron', threadId: 'cron:job-1' }],
      inputs: [
        {
          kind: 'trigger',
          triggerId: 'tg1-abc',
          type: 'cron_tick',
          at: 1000,
          payload: {
            jobId: 'job-1',
            name: '每日巡检',
            message: '检查构建',
          },
        },
      ],
    });
  });

  it('已存在（如执行侧已推进到 completed）⇒ 跳过，不写回 queued', async () => {
    const store = makeStore();
    const id = triggerTicketId('tg1-abc');
    store.rows.set(id, { id, status: 'completed', title: '已存在' });

    const writes: string[] = [];
    const sink = createTriggerTicketSink({
      read: store.read,
      write: async (record) => {
        writes.push(String(record.id));
        await store.write(record);
      },
    });

    await sink('cron:job-1' as Trigger['threadKey'], [trigger()]);

    expect(writes).toEqual([]);
    expect(store.rows.get(id)?.status).toBe('completed');
  });

  it('execution 选项 ⇒ 写入 Ticket（fs 交给消费者）', async () => {
    const store = makeStore();
    const sink = createTriggerTicketSink({
      read: store.read,
      write: store.write,
      execution: 'ticket',
    });

    await sink('cron:job-1' as Trigger['threadKey'], [trigger()]);

    expect(store.rows.get(triggerTicketId('tg1-abc'))?.execution).toBe(
      'ticket'
    );
  });

  it('budget 选项 ⇒ 建单时写 budget_max_*（缺省不写）', async () => {
    const store = makeStore();
    const sink = createTriggerTicketSink({
      read: store.read,
      write: store.write,
      budget: () => ({ maxTokens: 5000, maxUsd: 0.5 }),
    });

    await sink('cron:job-1' as Trigger['threadKey'], [trigger()]);

    expect(store.rows.get(triggerTicketId('tg1-abc'))).toMatchObject({
      budgetMaxTokens: 5000,
      budgetMaxUsd: 0.5,
    });

    const bare = makeStore();
    const noBudget = createTriggerTicketSink({
      read: bare.read,
      write: bare.write,
    });
    await noBudget('cron:job-1' as Trigger['threadKey'], [trigger()]);
    const row = bare.rows.get(triggerTicketId('tg1-abc'));
    expect(row?.budgetMaxTokens).toBeUndefined();
    expect(row?.budgetMaxUsd).toBeUndefined();
  });

  it('同批次多条 ⇒ 各建一条', async () => {
    const store = makeStore();
    const sink = createTriggerTicketSink({
      read: store.read,
      write: store.write,
    });

    await sink('cron:job-1' as Trigger['threadKey'], [
      trigger({ triggerId: 'tg1-a', externalId: 'job-1@1' }),
      trigger({ triggerId: 'tg1-b', externalId: 'job-1@2' }),
    ]);

    expect(store.rows.size).toBe(2);
    expect(store.rows.has(triggerTicketId('tg1-a'))).toBe(true);
    expect(store.rows.has(triggerTicketId('tg1-b'))).toBe(true);
  });
});
