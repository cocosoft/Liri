/**
 * P35 · fsSignalSource 生产接线（2026-11-02）
 *
 * 覆盖：
 * ① 策略关闭 ⇒ 事件照常落 `trigger:<id>` Ticket（status=queued）；
 * ② 策略 auto ⇒ Ticket 带 `policyId/mandate`；
 * ③ 策略 observe ⇒ 不落 Trigger、不建 Ticket（零副作用）；
 * ④ 同一事件重投 ⇒ 只留一条 Trigger（registry 幂等）。
 */
import { afterEach, describe, it, expect } from 'bun:test';

import { SourceCursorStore } from '../../../src/tasks/sources/cursor';
import {
  startFsSignalPipeline,
  stopFsSignalPipeline,
} from '../../../src/tasks/sources/fsWiring';
import { triggerTicketId } from '../../../src/tasks/sources/ticketSink';
import {
  computeTriggerId,
  type EventSource,
  type InboundEvent,
  type ThreadKey,
} from '../../../src/tasks/sources/types';
import type { LoadedAutonomyPolicy } from '../../../src/tasks/autonomy/policyConfig';
import type { AutonomyPolicyConfig } from '@openliri/infra/permission';

const EVENT: InboundEvent = {
  threadKey: 'fs:/repo/src/a.ts' as ThreadKey,
  externalId: '/repo/src/a.ts@42',
  type: 'file_changed',
  payload: { path: '/repo/src/a.ts', kind: 'change' },
  cursor: 42,
};

const TICKET_ID = triggerTicketId(
  computeTriggerId('fs', {
    externalId: EVENT.externalId,
    type: EVENT.type,
  })
);

function policy(
  config: Partial<AutonomyPolicyConfig> = {}
): LoadedAutonomyPolicy {
  return {
    config: {
      enabled: true,
      acceptMode: 'auto',
      sources: { fs: true },
      admission: {},
      rules: [{ id: 'fs.watch', text: '关注项目文件变更', enabled: true }],
      ...config,
    },
    source: 'policySettings',
    policyId: 'ps1-test',
    errors: [],
  };
}

function fakeSource() {
  let handler: ((event: InboundEvent) => void | Promise<void>) | null = null;
  const source: EventSource = {
    id: 'fs',
    async subscribe(h) {
      handler = h;
      return () => {
        handler = null;
      };
    },
  };
  return {
    source,
    emit: async (event: InboundEvent = EVENT) => {
      await handler?.(event);
    },
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
  await new Promise((r) => setTimeout(r, 20));
}

afterEach(async () => {
  await stopFsSignalPipeline();
});

describe('fsSignalSource 生产接线', () => {
  it('策略关闭 ⇒ queued Ticket（P35 基础行为）', async () => {
    const store = new SourceCursorStore(':memory:');
    const tickets = makeTicketStore();
    const fake = fakeSource();
    const pipeline = await startFsSignalPipeline({
      watchPaths: [],
      source: fake.source,
      store,
      readTicket: tickets.read,
      writeTicket: tickets.write,
      loadPolicy: () => policy({ enabled: false, acceptMode: 'off' }),
      observePolicyChange: async () => null,
    });

    try {
      await fake.emit();
      await settle();

      expect(tickets.rows.get(TICKET_ID)).toMatchObject({
        status: 'queued',
        execution: 'ticket',
        sourceId: 'fs',
        triggerId: computeTriggerId('fs', {
          externalId: EVENT.externalId,
          type: EVENT.type,
        }),
      });
      expect(await store.countTriggers('fs')).toBe(1);
    } finally {
      await pipeline.stop();
      store.close();
    }
  });

  it('策略 auto ⇒ Ticket 带 policyId/mandate', async () => {
    const store = new SourceCursorStore(':memory:');
    const tickets = makeTicketStore();
    const fake = fakeSource();
    const pipeline = await startFsSignalPipeline({
      watchPaths: [],
      source: fake.source,
      store,
      readTicket: tickets.read,
      writeTicket: tickets.write,
      loadPolicy: () => policy(),
      observePolicyChange: async () => null,
    });

    try {
      await fake.emit();
      await settle();

      expect(tickets.rows.get(TICKET_ID)).toMatchObject({
        status: 'queued',
        policyId: 'ps1-test',
        mandate: {
          strength: 'inferred',
          basis: { via: 'bot', rules: ['fs.watch'] },
          scope: { source: 'fs' },
        },
      });
    } finally {
      await pipeline.stop();
      store.close();
    }
  });

  it('策略 observe ⇒ 不落 Trigger、不建 Ticket', async () => {
    const store = new SourceCursorStore(':memory:');
    const tickets = makeTicketStore();
    const fake = fakeSource();
    const pipeline = await startFsSignalPipeline({
      watchPaths: [],
      source: fake.source,
      store,
      readTicket: tickets.read,
      writeTicket: tickets.write,
      loadPolicy: () => policy({ acceptMode: 'observe' }),
      observePolicyChange: async () => null,
    });

    try {
      await fake.emit();
      await settle();

      expect(tickets.rows.size).toBe(0);
      expect(await store.countTriggers('fs')).toBe(0);
    } finally {
      await pipeline.stop();
      store.close();
    }
  });

  it('同一事件重投 ⇒ 只留一条 Trigger', async () => {
    const store = new SourceCursorStore(':memory:');
    const tickets = makeTicketStore();
    const fake = fakeSource();
    const pipeline = await startFsSignalPipeline({
      watchPaths: [],
      source: fake.source,
      store,
      readTicket: tickets.read,
      writeTicket: tickets.write,
      loadPolicy: () => policy({ enabled: false, acceptMode: 'off' }),
      observePolicyChange: async () => null,
    });

    try {
      await fake.emit();
      await fake.emit();
      await settle();

      expect(await store.countTriggers('fs')).toBe(1);
      expect(tickets.rows.size).toBe(1);
    } finally {
      await pipeline.stop();
      store.close();
    }
  });

  it('auto + 注入执行器 ⇒ Ticket 被消费并置 completed', async () => {
    const store = new SourceCursorStore(':memory:');
    const tickets = makeTicketStore();
    const fake = fakeSource();
    const executed: Array<Record<string, unknown>> = [];
    const pipeline = await startFsSignalPipeline({
      watchPaths: [],
      source: fake.source,
      store,
      readTicket: tickets.read,
      writeTicket: tickets.write,
      listWorkItems: async () => [...tickets.rows.values()],
      claimWorkItem: async (id, from, to) => {
        const row = tickets.rows.get(id);
        if (!row || row.status !== from) return false;
        tickets.rows.set(id, { ...row, status: to });
        return true;
      },
      loadPolicy: () => policy(),
      executeTicket: async (ticket) => {
        executed.push(ticket);
        return {
          success: true,
          output: 'checked',
          tokens: 7,
          sessionId: 's-exec',
        };
      },
      observePolicyChange: async () => null,
    });

    try {
      await fake.emit();
      await settle();

      expect(executed).toHaveLength(1);
      expect(tickets.rows.get(TICKET_ID)).toMatchObject({
        status: 'completed',
        execution: 'ticket',
        sessionId: 's-exec',
        budgetUsedTokens: 7,
        costTokens: 7,
        lastAction: 'ticket_executed',
      });
    } finally {
      await pipeline.stop();
      store.close();
    }
  });
});
