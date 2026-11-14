/**
 * D1（2026-11-14）：外部事件适配器回归锁。
 *
 * 锁三层：
 *   ① 翻译：外部推送 → `InboundEvent`（线程键 / 幂等键 / 事件类型登记）；
 *   ② 来源：未订阅时投递失败（不静默）、订阅后可投递、退订后失效；
 *   ③ 受理：签名 fail-closed / 载荷校验 / 去重 / 限速，且**只在投递成功后记账**。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import {
  createExternalEventSource,
  externalEventToInbound,
  EXTERNAL_SOURCE_ID,
} from '@modules/tasks/sources/externalEventSource';
import { SOURCE_EVENT_TYPES } from '@modules/tasks/sources/types';
import {
  getExternalEventIntake,
  computeExternalEventSignature,
  DEFAULT_EXTERNAL_EVENT_CONFIG,
  ExternalEventIntake,
  REJECT_STATUS,
  verifyExternalEventSignature,
} from '@openliri/service/runtime/externalEventIntake';
import { SourceCursorStore } from '../../../src/tasks/sources/cursor';
import {
  startExternalEventPipeline,
  stopExternalEventPipeline,
} from '../../../src/tasks/sources/externalEventWiring';
import { triggerTicketId } from '../../../src/tasks/sources/ticketSink';
import { computeTriggerId } from '../../../src/tasks/sources/types';
import type { LoadedAutonomyPolicy } from '../../../src/tasks/autonomy/policyConfig';

const SECRET = 'test-secret';
const raw = (o: unknown): string => JSON.stringify(o);
const sign = (body: string): string =>
  computeExternalEventSignature(SECRET, body);

function intakeOf(
  emit: (i: {
    eventId: string;
    payload: Record<string, unknown>;
    threadId?: string;
  }) => Promise<boolean>,
  extra: { ratePerMinute?: number; now?: () => number } = {}
): ExternalEventIntake {
  return new ExternalEventIntake({
    emit,
    config: {
      secret: SECRET,
      ...(extra.ratePerMinute !== undefined
        ? { ratePerMinute: extra.ratePerMinute }
        : {}),
    },
    ...(extra.now ? { now: extra.now } : {}),
  });
}

describe('D1：事件类型与翻译', () => {
  it('external_event 已在来源类型词表登记', () => {
    expect(SOURCE_EVENT_TYPES).toContain('external_event');
  });

  it('翻译：线程键 external:<threadId>，幂等键 = eventId，载荷原样', () => {
    const event = externalEventToInbound({
      eventId: 'evt-1',
      threadId: 'issue-42',
      payload: { action: 'opened' },
    });
    expect(event).toEqual({
      threadKey: 'external:issue-42',
      externalId: 'evt-1',
      type: 'external_event',
      payload: { action: 'opened' },
    });
    // 缺省 threadId ⇒ 用 eventId（同事件重投串行）
    expect(
      externalEventToInbound({ eventId: 'evt-2', payload: {} }).threadKey
    ).toBe('external:evt-2');
  });
});

describe('D1：来源（推送型）', () => {
  it('未订阅 ⇒ emit=false（不静默吞）；订阅后可投递；退订后失效', async () => {
    const source = createExternalEventSource();
    expect(source.id).toBe(EXTERNAL_SOURCE_ID);
    expect(await source.emit({ eventId: 'e1', payload: {} })).toBe(false);

    const received: string[] = [];
    const dispose = await source.subscribe((event) => {
      received.push(event.externalId);
    });
    expect(await source.emit({ eventId: 'e2', payload: { a: 1 } })).toBe(true);
    expect(received).toEqual(['e2']);

    dispose();
    expect(await source.emit({ eventId: 'e3', payload: {} })).toBe(false);
  });
});

describe('D1：受理层（签名 / 校验 / 去重 / 限速）', () => {
  it('密钥未配置 ⇒ secret_not_configured（fail-closed 503）', async () => {
    const intake = new ExternalEventIntake({
      emit: async () => true,
      config: { secret: '' },
    });
    const result = await intake.handle({
      sourceId: 'external',
      rawBody: raw({ a: 1 }),
      eventId: 'e1',
    });
    expect(result).toEqual({ ok: false, reason: 'secret_not_configured' });
    expect(REJECT_STATUS.secret_not_configured).toBe(503);
  });

  it('签名不符 ⇒ bad_signature（401）；正确签名通过', async () => {
    let emitted = 0;
    const intake = intakeOf(async () => {
      emitted += 1;
      return true;
    });
    const body = raw({ a: 1 });

    expect(
      await intake.handle({
        sourceId: 'external',
        rawBody: body,
        eventId: 'e1',
        signature: 'sha256=deadbeef',
      })
    ).toEqual({ ok: false, reason: 'bad_signature' });
    expect(emitted).toBe(0);

    expect(verifyExternalEventSignature(SECRET, body, sign(body))).toBe(true);
    expect(
      await intake.handle({
        sourceId: 'external',
        rawBody: body,
        eventId: 'e1',
        signature: sign(body),
      })
    ).toEqual({ ok: true, eventId: 'e1' });
    expect(emitted).toBe(1);
  });

  it('载荷校验：缺 eventId / 非 JSON / 非对象 / 超限', async () => {
    const intake = intakeOf(async () => true);
    const body = raw({ a: 1 });

    expect(
      await intake.handle({
        sourceId: 'external',
        rawBody: body,
        signature: sign(body),
      })
    ).toEqual({ ok: false, reason: 'missing_event_id' });

    expect(
      await intake.handle({
        sourceId: 'external',
        rawBody: '{bad json',
        eventId: 'e1',
        signature: sign('{bad json'),
      })
    ).toEqual({ ok: false, reason: 'invalid_body' });

    const arr = '[1,2]';
    expect(
      await intake.handle({
        sourceId: 'external',
        rawBody: arr,
        eventId: 'e2',
        signature: sign(arr),
      })
    ).toEqual({ ok: false, reason: 'invalid_body' });

    const big = raw({
      blob: 'x'.repeat(DEFAULT_EXTERNAL_EVENT_CONFIG.maxPayloadBytes),
    });
    expect(
      await intake.handle({
        sourceId: 'external',
        rawBody: big,
        eventId: 'e3',
        signature: sign(big),
      })
    ).toEqual({ ok: false, reason: 'payload_too_large' });
  });

  it('同一 eventId 重复投递 ⇒ duplicate（409），只投递一次', async () => {
    let emitted = 0;
    const intake = intakeOf(async () => {
      emitted += 1;
      return true;
    });
    const body = raw({ a: 1 });
    const input = {
      sourceId: 'external',
      rawBody: body,
      eventId: 'dup-1',
      signature: sign(body),
    };

    expect((await intake.handle(input)).ok).toBe(true);
    expect(await intake.handle(input)).toEqual({
      ok: false,
      reason: 'duplicate',
    });
    expect(emitted).toBe(1);
    expect(REJECT_STATUS.duplicate).toBe(409);
  });

  it('超过速率上限 ⇒ rate_limited（429）；窗口滑出后恢复', async () => {
    let now = 1_000_000;
    const intake = intakeOf(async () => true, {
      ratePerMinute: 2,
      now: () => now,
    });
    const body = raw({ a: 1 });
    const send = (id: string) =>
      intake.handle({
        sourceId: 'external',
        rawBody: body,
        eventId: id,
        signature: sign(body),
      });

    expect((await send('r1')).ok).toBe(true);
    expect((await send('r2')).ok).toBe(true);
    expect(await send('r3')).toEqual({ ok: false, reason: 'rate_limited' });
    expect(REJECT_STATUS.rate_limited).toBe(429);

    now += 61_000;
    expect((await send('r4')).ok).toBe(true);
  });

  it('投递失败 ⇒ not_delivered 且**不记账**（允许重试）', async () => {
    let delivered = false;
    const intake = intakeOf(async () => delivered);
    const body = raw({ a: 1 });
    const input = {
      sourceId: 'external',
      rawBody: body,
      eventId: 'retry-1',
      signature: sign(body),
    };

    expect(await intake.handle(input)).toEqual({
      ok: false,
      reason: 'not_delivered',
    });
    expect(intake.size()).toBe(0);

    delivered = true;
    expect((await intake.handle(input)).ok).toBe(true);
    expect(intake.size()).toBe(1);
  });
});

describe('D1：生产接线（外部事件 ⇒ trigger 工作项）', () => {
  function policy(): LoadedAutonomyPolicy {
    return {
      config: {
        enabled: false,
        acceptMode: 'off',
        sources: { external: true },
        admission: {},
        rules: [],
      },
      source: 'policySettings',
      policyId: 'ps1-external',
      errors: [],
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

  const settle = (): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, 20));

  afterEach(async () => {
    await stopExternalEventPipeline();
  });

  it('受理 → SourceRegistry → ticketSink：生成一条 queued 工作项；重投不重复', async () => {
    const store = new SourceCursorStore(':memory:');
    const tickets = makeTicketStore();
    const pipeline = await startExternalEventPipeline({
      store,
      readTicket: tickets.read,
      writeTicket: tickets.write,
      loadPolicy: policy,
      observePolicyChange: async () => null,
      secret: SECRET,
    });

    try {
      const intake = getExternalEventIntake();
      expect(intake).not.toBeNull();

      const body = raw({ action: 'opened', number: 42 });
      const input = {
        sourceId: 'external',
        rawBody: body,
        eventId: 'ext-1',
        signature: sign(body),
      };

      expect(await intake!.handle(input)).toEqual({
        ok: true,
        eventId: 'ext-1',
      });
      await settle();

      const ticketId = triggerTicketId(
        computeTriggerId('external', {
          externalId: 'ext-1',
          type: 'external_event',
        })
      );
      expect(tickets.rows.get(ticketId)).toMatchObject({
        status: 'queued',
        sourceId: 'external',
        execution: 'ticket',
      });
      expect(await store.countTriggers('external')).toBe(1);

      // 重投：HTTP 层去重挡住（不新增 Trigger / 工作项）
      expect(await intake!.handle(input)).toEqual({
        ok: false,
        reason: 'duplicate',
      });
      await settle();
      expect(await store.countTriggers('external')).toBe(1);
      expect(pipeline.sourceId).toBe(EXTERNAL_SOURCE_ID);
    } finally {
      await pipeline.stop();
      store.close();
    }

    // 停止后端口复位 ⇒ 端点回到 503 语义
    expect(getExternalEventIntake()).toBeNull();
  });
});
