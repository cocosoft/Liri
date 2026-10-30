/**
 * G-10 P2：主动消息挂起队列契约。
 *
 * 覆盖：去重、优先级取件、成功投递、失败退避/终止、过期、保留期清理。
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProactivePushQueue } from '../../src/proactive/ProactivePushQueue';
import type { ProactiveMessagePayload } from '../../src/proactive/types';

const NOW = Date.parse('2026-10-19T12:00:00Z');

let dir: string;
let queue: ProactivePushQueue;

function payload(
  id: string,
  over: Partial<ProactiveMessagePayload> = {}
): ProactiveMessagePayload {
  return {
    id,
    kind: 'task_result',
    priority: 'normal',
    dedupeKey: `task:${id}`,
    title: `任务 ${id}`,
    body: '完成',
    createdAt: NOW,
    expiresAt: NOW + 60 * 60_000,
    ...over,
  };
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'liri-proactive-queue-'));
  queue = new ProactivePushQueue({
    dbPath: join(dir, 'queue.db'),
    maxAttempts: 2,
    baseRetryMs: 1_000,
    maxRetryMs: 5_000,
    retentionDays: 1,
  });
  await queue.init();
});

afterEach(async () => {
  await queue.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('ProactivePushQueue：入队与取件', () => {
  test('pending 期间同 dedupeKey 只入队一次', async () => {
    expect(await queue.enqueue(payload('a'), NOW)).toBe(true);
    expect(
      await queue.enqueue(payload('a2', { dedupeKey: 'task:a' }), NOW)
    ).toBe(false);
    expect((await queue.stats()).pending).toBe(1);
  });

  test('按优先级取件：critical > high > normal > low', async () => {
    await queue.enqueue(payload('low', { priority: 'low' }), NOW);
    await queue.enqueue(payload('normal', { priority: 'normal' }), NOW);
    await queue.enqueue(payload('critical', { priority: 'critical' }), NOW);
    await queue.enqueue(payload('high', { priority: 'high' }), NOW);

    const due = await queue.claimDue(NOW, 10);
    expect(due.map((e) => e.id)).toEqual(['critical', 'high', 'normal', 'low']);
  });

  test('nextAttemptAt 晚于 now（DND/冷却）⇒ 到期前不取件', async () => {
    await queue.enqueue(payload('delayed'), NOW, NOW + 60_000);

    expect(await queue.claimDue(NOW + 59_999, 10)).toHaveLength(0);
    const due = await queue.claimDue(NOW + 60_000, 10);
    expect(due.map((e) => e.id)).toEqual(['delayed']);
  });

  test('listRecentDelivered 返回已投递记录（门禁输入）', async () => {
    await queue.enqueue(payload('recent'), NOW);
    await queue.scanOnce(async () => {}, NOW);

    const recent = await queue.listRecentDelivered(NOW - 1);
    expect(recent).toEqual([
      { dedupeKey: 'task:recent', kind: 'task_result', deliveredAt: NOW },
    ]);
  });
});

describe('ProactivePushQueue：投递与重试', () => {
  test('投递成功 ⇒ delivered，且不再被取件', async () => {
    await queue.enqueue(payload('ok'), NOW);
    const result = await queue.scanOnce(async () => {}, NOW);

    expect(result).toEqual({ delivered: 1, retried: 0, dropped: 0 });
    expect(await queue.claimDue(NOW + 10_000, 10)).toHaveLength(0);
    expect((await queue.stats()).delivered).toBe(1);
  });

  test('失败一次 ⇒ 指数退避；再次失败达上限 ⇒ dropped', async () => {
    await queue.enqueue(payload('fail'), NOW);

    const first = await queue.scanOnce(async () => {
      throw new Error('network down');
    }, NOW);
    expect(first).toEqual({ delivered: 0, retried: 1, dropped: 0 });
    // 未到 next_attempt_at ⇒ 取不到
    expect(await queue.claimDue(NOW + 999, 10)).toHaveLength(0);

    const second = await queue.scanOnce(async () => {
      throw new Error('network down');
    }, NOW + 1_000);
    expect(second).toEqual({ delivered: 0, retried: 0, dropped: 1 });

    const stats = await queue.stats();
    expect(stats.dropped).toBe(1);
    expect(stats.pending).toBe(0);
  });
});

describe('ProactivePushQueue：过期与保留期', () => {
  test('已过期 ⇒ 不取件且标记 expired', async () => {
    await queue.enqueue(
      payload('expired', { expiresAt: NOW - 1 }),
      NOW - 10_000
    );
    expect(await queue.claimDue(NOW, 10)).toHaveLength(0);
    expect((await queue.stats()).expired).toBe(1);
  });

  test('终态记录超过保留期 ⇒ 物理删除', async () => {
    await queue.enqueue(payload('old'), NOW);
    await queue.scanOnce(async () => {}, NOW);
    expect((await queue.stats()).delivered).toBe(1);

    const removed = await queue.pruneRetention(NOW + 2 * 24 * 60 * 60_000);
    expect(removed).toBe(1);
    expect((await queue.stats()).total).toBe(0);
  });
});

/**
 * 2026-10-31 根因修复：门禁的回看必须包含 **pending**。
 *
 * 缺陷复现口径：AlwaysOn 一个 tick 内并发为 N 个项目入队，`enqueue` 后行是 pending；
 * 若门禁只查 delivered，这一批读到同一份"空"快照 ⇒ 去重/冷却/每小时上限被整批穿透。
 */
describe('listRecentCommitted（含 pending）', () => {
  test('pending 计入"已承诺"；只查 delivered 时为空', async () => {
    await queue.enqueue(payload('p1'), NOW);
    const committed = await queue.listRecentCommitted(NOW - 60_000);
    expect(committed.map((c) => c.dedupeKey)).toEqual(['task:p1']);
    // 对照：只回看 delivered ⇒ 空（这正是旧实现的输入，导致限流失效）
    expect(await queue.listRecentDelivered(NOW - 60_000)).toEqual([]);
  });
});
