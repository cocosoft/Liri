/**
 * P35 · Ticket 执行消费（2026-11-02）
 *
 * 覆盖：
 * ① 策略关闭/observe ⇒ 0 次执行（记录层行为不变）；
 * ② auto + `execution='ticket'` ⇒ 原子领取 → 执行 → completed（带 tokens/sessionId）；
 * ③ 领取失败（已被抢）⇒ 跳过；
 * ④ 执行抛错 ⇒ failed + lastError；
 * ⑤ `execution='external'` ⇒ 不消费（cron 已自行执行）。
 */
import { describe, it, expect } from 'bun:test';

import type { AutonomyPolicyConfig } from '@openliri/infra/permission';
import type { LoadedAutonomyPolicy } from '../../../src/tasks/autonomy/policyConfig';
import {
  createTicketRunConsumer,
  type TicketRunConsumerOptions,
} from '../../../src/tasks/autonomy/ticketRunConsumer';

function policy(
  over: Partial<AutonomyPolicyConfig> = {}
): LoadedAutonomyPolicy {
  return {
    config: {
      enabled: true,
      acceptMode: 'auto',
      sources: { fs: true },
      admission: {},
      rules: [{ id: 'fs.watch', text: '', enabled: true }],
      ...over,
    },
    source: 'policySettings',
    policyId: 'ps1-test',
    errors: [],
  };
}

function ticket(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 't-1',
    status: 'queued',
    execution: 'ticket',
    payload: { path: '/repo/src/a.ts', kind: 'change' },
    ...over,
  };
}

function setup(
  rows: Array<Record<string, unknown>>,
  over: Partial<TicketRunConsumerOptions> = {}
) {
  const rowsMap = new Map(rows.map((row) => [String(row.id), { ...row }]));
  const executed: string[] = [];
  const writes: Record<string, unknown>[] = [];
  const consumer = createTicketRunConsumer({
    listWorkItems: async () => [...rowsMap.values()],
    readWorkItem: async (id) => rowsMap.get(id) ?? null,
    claimWorkItem: async (id, from, to) => {
      const row = rowsMap.get(id);
      if (!row || row.status !== from) return false;
      rowsMap.set(id, { ...row, status: to });
      return true;
    },
    writeWorkItem: async (record) => {
      writes.push(record);
      rowsMap.set(String(record.id), record);
    },
    loadPolicy: () => policy(),
    execute: async (row) => {
      executed.push(String(row.id));
      return { success: true, output: 'ok', tokens: 5, sessionId: 's-1' };
    },
    now: () => 1000,
    ...over,
  });
  return { consumer, executed, writes, rowsMap };
}

describe('TicketRunConsumer', () => {
  it('策略关闭 / observe ⇒ 不执行', async () => {
    for (const config of [
      { enabled: false },
      { acceptMode: 'observe' as const },
      { acceptMode: 'off' as const },
    ]) {
      const { consumer, executed } = setup([ticket()], {
        loadPolicy: () => policy(config),
      });
      expect(await consumer.runOnce()).toBe(0);
      expect(executed).toEqual([]);
    }
  });

  it('auto ⇒ 领取并执行，Ticket 置 completed（带 tokens/sessionId）', async () => {
    const { consumer, executed, rowsMap } = setup([ticket()]);

    expect(await consumer.runOnce()).toBe(1);
    expect(executed).toEqual(['t-1']);
    expect(rowsMap.get('t-1')).toMatchObject({
      status: 'completed',
      execution: 'ticket',
      sessionId: 's-1',
      budgetUsedTokens: 5,
      costTokens: 5,
      lastAction: 'ticket_executed',
    });
  });

  it('领取失败（非 queued）⇒ 跳过', async () => {
    const { consumer, executed } = setup([ticket({ status: 'active' })]);
    expect(await consumer.runOnce()).toBe(0);
    expect(executed).toEqual([]);
  });

  it('执行抛错 ⇒ failed + lastError', async () => {
    const { consumer, rowsMap } = setup([ticket()], {
      execute: async () => {
        throw new Error('model down');
      },
    });

    expect(await consumer.runOnce()).toBe(1);
    expect(rowsMap.get('t-1')).toMatchObject({
      status: 'failed',
      lastError: 'Error: model down',
      lastAction: 'ticket_executed',
    });
  });

  it('execution=external（cron 已自行执行）⇒ 不消费', async () => {
    const { consumer, executed } = setup([ticket({ execution: 'external' })]);
    expect(await consumer.runOnce()).toBe(0);
    expect(executed).toEqual([]);
  });

  it('跨执行累计：已有用量 ⇒ 累加而非覆盖', async () => {
    const { consumer, rowsMap } = setup([
      ticket({ budgetUsedTokens: 100, costTokens: 100 }),
    ]);

    expect(await consumer.runOnce()).toBe(1);
    expect(rowsMap.get('t-1')).toMatchObject({
      budgetUsedTokens: 105,
      costTokens: 105,
    });
  });
});
