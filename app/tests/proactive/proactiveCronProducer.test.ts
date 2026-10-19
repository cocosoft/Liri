/**
 * G-10 生产者（cron 完成/失败）契约（2026-10-19）
 *
 * 决策口径：DND 延迟到窗口结束；cron 结果最高 normal（仅内核规则可 high）；
 * 队列未启用时返回 false，由调用方走原通知中心链路。
 */
import { describe, expect, it } from 'bun:test';
import {
  buildCronProactivePayload,
  enqueueCronResultProactive,
} from '../../src/proactive/ProactiveCronProducer';
import type { ProactiveGatePrefs } from '../../src/proactive/types';

const NOW = Date.parse('2026-10-19T12:00:00Z');

function prefs(over: Partial<ProactiveGatePrefs> = {}): ProactiveGatePrefs {
  return { enabled: true, maxPerHour: 3, ...over };
}

function input(success: boolean) {
  return {
    job: { id: 'job-1', name: '日报任务' },
    result: { success },
    title: '定时任务完成',
    body: '今日日报已生成',
  };
}

describe('buildCronProactivePayload', () => {
  it('失败 ⇒ normal；成功 ⇒ low（cron 不产生 high）', () => {
    expect(buildCronProactivePayload(input(false), NOW).priority).toBe(
      'normal'
    );
    expect(buildCronProactivePayload(input(true), NOW).priority).toBe('low');
  });

  it('去重键按 job + 结果区分；目标为本地通知；24h 过期', () => {
    const fail = buildCronProactivePayload(input(false), NOW);
    const ok = buildCronProactivePayload(input(true), NOW);
    expect(fail.dedupeKey).toBe('cron:job-1:fail');
    expect(ok.dedupeKey).toBe('cron:job-1:ok');
    expect(fail.target).toEqual({ mode: 'local' });
    expect(fail.expiresAt).toBe(NOW + 24 * 60 * 60 * 1000);
    expect(fail.source).toEqual({ type: 'cron', ref: 'job-1' });
  });
});

describe('enqueueCronResultProactive', () => {
  it('队列未启用 ⇒ false 且不产生副作用', async () => {
    const result = await enqueueCronResultProactive(input(true), {
      queue: null,
      now: NOW,
      prefs: prefs(),
      timezone: 'UTC',
    });
    expect(result).toBe(false);
  });

  it('正常时段 ⇒ 立即入队（nextAttemptAt = now）', async () => {
    const calls: Array<{ now: number; next: number }> = [];
    const queue = {
      enqueue: async (
        _payload: unknown,
        now: number,
        next: number
      ): Promise<boolean> => {
        calls.push({ now, next });
        return true;
      },
      listRecentDelivered: async () => [],
    };

    const result = await enqueueCronResultProactive(input(true), {
      queue: queue as never,
      now: NOW,
      prefs: prefs(),
      timezone: 'UTC',
    });

    expect(result).toBe(true);
    expect(calls).toEqual([{ now: NOW, next: NOW }]);
  });

  it('DND 内 ⇒ 入队但延迟到窗口结束', async () => {
    const calls: Array<{ next: number }> = [];
    const queue = {
      enqueue: async (
        _payload: unknown,
        _now: number,
        next: number
      ): Promise<boolean> => {
        calls.push({ next });
        return true;
      },
      listRecentDelivered: async () => [],
    };

    // UTC 23:00，DND 22:00–08:00 ⇒ 次日 08:00
    const lateNight = Date.parse('2026-10-19T23:00:00Z');
    const result = await enqueueCronResultProactive(input(false), {
      queue: queue as never,
      now: lateNight,
      prefs: prefs({ dnd: { start: '22:00', end: '08:00' } }),
      timezone: 'UTC',
    });

    expect(result).toBe(true);
    expect(calls[0]?.next).toBe(Date.parse('2026-10-20T08:00:00Z'));
  });

  it('同 dedupeKey 已投递过（有效期内）⇒ 门禁 drop，不再入队', async () => {
    let enqueued = 0;
    const queue = {
      enqueue: async (): Promise<boolean> => {
        enqueued++;
        return true;
      },
      listRecentDelivered: async () => [
        { dedupeKey: 'cron:job-1:ok', kind: 'task_result', deliveredAt: NOW },
      ],
    };

    const result = await enqueueCronResultProactive(input(true), {
      queue: queue as never,
      now: NOW,
      prefs: prefs(),
      timezone: 'UTC',
    });

    expect(result).toBe(false);
    expect(enqueued).toBe(0);
  });
});
