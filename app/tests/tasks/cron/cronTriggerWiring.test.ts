/**
 * P35 · Cron → Trigger → Ticket 生产接线（2026-11-02）
 *
 * 覆盖：
 * ① `onJobStart` 发出 Trigger ⇒ 位点/幂等台账落一条，Ticket 为 `queued`；
 * ② `onJobEnd` 把**同一个** Ticket 推进到 `completed/failed`（带 tokens）；
 * ③ 同一 `jobId + scheduledAt` 重复投递 ⇒ 只有 1 条 Trigger / 1 个 Ticket；
 * ④ 执行侧先写终态 ⇒ 迟到的 sink 不得写回 `queued`。
 */
import { describe, it, expect } from 'bun:test';

import { SourceCursorStore } from '../../../src/tasks/sources/cursor';
import { computeTriggerId } from '../../../src/tasks/sources/types';
import { triggerTicketId } from '../../../src/tasks/sources/ticketSink';
import { startCronTriggerPipeline } from '../../../src/tasks/cron/cronTriggerWiring';
import type { CronJob, CronJobResult } from '../../../src/tasks/cron/types';

const JOB: CronJob = {
  id: 'job-1',
  name: '每日巡检',
  prompt: '检查构建',
  skills: [],
  schedule: { kind: 'cron', display: '每天 09:00', expr: '0 9 * * *' },
  repeat: { times: null, completed: 0 },
  enabled: true,
  state: 'scheduled',
  createdAt: '2026-11-02T00:00:00.000Z',
  nextRunAt: '2026-11-02T09:00:00.000Z',
  deliver: 'none',
};

const AT = Date.parse(JOB.nextRunAt!);
const TICKET_ID = triggerTicketId(
  computeTriggerId('cron', {
    externalId: `${JOB.id}@${AT}`,
    type: 'cron_tick',
  })
);

function result(over: Partial<CronJobResult> = {}): CronJobResult {
  return {
    success: true,
    output: 'ok',
    finalResponse: 'ok',
    durationMs: 1,
    inputTokens: 10,
    outputTokens: 5,
    ...over,
  };
}

function makeTicketStore() {
  const rows = new Map<string, Record<string, unknown>>();
  return {
    rows,
    read: async (id: string) => rows.get(id) ?? null,
    write: async (record: Record<string, unknown>) => {
      rows.set(String(record.id), record);
    },
  };
}

async function settle(): Promise<void> {
  // 让 Registry 的 fire-and-forget 事件处理跑完（无定时器，只需让出事件循环）
  await new Promise((r) => setTimeout(r, 20));
}

describe('cron Trigger→Ticket 接线', () => {
  it('开始发 Trigger，结束推进同一 Ticket 到 completed（带 tokens）', async () => {
    const store = new SourceCursorStore(':memory:');
    const tickets = makeTicketStore();
    const pipeline = await startCronTriggerPipeline({
      store,
      readTicket: tickets.read,
      writeTicket: tickets.write,
      now: () => AT + 1,
    });

    try {
      await pipeline.onJobStart(JOB, AT);
      await pipeline.onJobEnd(JOB, result(), AT);
      await settle();

      const row = tickets.rows.get(TICKET_ID);
      expect(row).toMatchObject({
        status: 'completed',
        sourceId: 'cron',
        costTokens: 15,
        lastAction: 'cron_executed',
      });
      expect(await store.countTriggers('cron')).toBe(1);
    } finally {
      await pipeline.stop();
      store.close();
    }
  });

  it('失败 ⇒ failed + lastError；同一 scheduledAt 重复投递只留一条', async () => {
    const store = new SourceCursorStore(':memory:');
    const tickets = makeTicketStore();
    const pipeline = await startCronTriggerPipeline({
      store,
      readTicket: tickets.read,
      writeTicket: tickets.write,
      now: () => AT + 1,
    });

    try {
      await pipeline.onJobStart(JOB, AT);
      await pipeline.onJobStart(JOB, AT);
      await pipeline.onJobEnd(
        JOB,
        result({ success: false, error: 'boom' }),
        AT
      );
      await settle();

      expect(tickets.rows.size).toBe(1);
      expect(tickets.rows.get(TICKET_ID)).toMatchObject({
        status: 'failed',
        lastError: 'boom',
      });
      expect(await store.countTriggers('cron')).toBe(1);
    } finally {
      await pipeline.stop();
      store.close();
    }
  });

  it('执行侧先写终态 ⇒ 迟到的 sink 不把状态写回 queued', async () => {
    const store = new SourceCursorStore(':memory:');
    const tickets = makeTicketStore();
    // 预置一个已完成的 Ticket（模拟执行侧先落终态）
    tickets.rows.set(TICKET_ID, {
      id: TICKET_ID,
      title: 'Cron · 每日巡检',
      status: 'completed',
    });

    const pipeline = await startCronTriggerPipeline({
      store,
      readTicket: tickets.read,
      writeTicket: tickets.write,
      now: () => AT + 1,
    });

    try {
      await pipeline.onJobStart(JOB, AT);
      await pipeline.onJobEnd(JOB, result(), AT);
      await settle();

      expect(tickets.rows.get(TICKET_ID)?.status).toBe('completed');
    } finally {
      await pipeline.stop();
      store.close();
    }
  });
});
