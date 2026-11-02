/**
 * P38 · 统一 effects 队列（三语义 + P38-b 领取/自愈）
 *
 * 覆盖方案 §5 P38 的验收口径：
 * ① `later`：只前移 due，**attempts 不增**（暂停/槽位满不是失败）；
 * ② `generation`：运行中更新载荷 ⇒ 旧代次结算**不得**删除/改写新载荷；
 * ③ `FAILURES_BEFORE_ERROR=3`：前两次失败只退避重排，第 3 次才置 `failed`；
 * ④ P38-b：原子领取（单胜者）、陈旧窗口 `restored`、未领取不得结算、每类上限（reply=8）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  EffectQueue,
  EFFECT_CLAIM_STALE_MS,
  EFFECT_DEFAULT_LATER_MS,
  EFFECT_FAILURES_BEFORE_ERROR,
  EFFECT_STATUS_ATTEMPTING,
  EFFECT_STATUS_FAILED,
  EFFECT_STATUS_PENDING,
  EFFECT_STATUS_SETTLED,
  effectRetryDelay,
} from '../../../src/tasks/effects';

const NOW = Date.parse('2026-11-02T10:00:00Z');

let dir: string;
let queue: EffectQueue | null = null;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'p38-effects-'));
  queue = new EffectQueue(join(dir, 'effects.db'));
});

afterEach(() => {
  queue?.close();
  queue = null;
  rmSync(dir, { recursive: true, force: true });
});

describe('入队与领取', () => {
  it('到期才可领取；未到期不出现', async () => {
    const q = queue!;
    await q.enqueue('reply', 'k1', { text: 'hi' }, { now: NOW });
    await q.enqueue(
      'reply',
      'k2',
      { text: 'later' },
      { now: NOW, dueAt: NOW + 60_000 }
    );

    const due = await q.claimDue(NOW, 10);
    expect(due.map((e) => e.key)).toEqual(['k1']);
    expect(due[0].payload).toEqual({ text: 'hi' });
    expect(due[0].generation).toBe(1);

    const later = await q.claimDue(NOW + 60_000, 10);
    expect(later.map((e) => e.key)).toEqual(['k1', 'k2']);
  });

  it('同键重复入队 ⇒ 一行、generation 递增、载荷更新、attempts 归零', async () => {
    const q = queue!;
    expect(await q.enqueue('reply', 'k', { v: 1 }, { now: NOW })).toBe(1);
    expect(await q.enqueue('reply', 'k', { v: 2 }, { now: NOW + 1 })).toBe(2);

    const entry = await q.get('reply', 'k');
    expect(entry?.generation).toBe(2);
    expect(entry?.payload).toEqual({ v: 2 });
    expect(entry?.attempts).toBe(0);
    expect((await q.claimDue(NOW + 1, 10)).length).toBe(1);
  });
});

describe('generation 语义（防旧覆盖新）', () => {
  it('旧代次结算返回 false，且不删除新载荷', async () => {
    const q = queue!;
    await q.enqueue('delivery', 'k', { v: 1 }, { now: NOW });
    const first = await q.claimOne('delivery', 'k', NOW);
    expect(first.claimed).toBe(true);
    expect(first.generation).toBe(1);

    // 派发进行中，新载荷到达（同键）
    await q.enqueue('delivery', 'k', { v: 2 }, { now: NOW + 10 });

    // 旧尝试完成 ⇒ 必须被忽略
    expect(await q.settle('delivery', 'k', 1, { kind: 'done' }, NOW + 20)).toBe(
      false
    );
    const after = await q.get('delivery', 'k');
    expect(after?.status).toBe(EFFECT_STATUS_PENDING);
    expect(after?.payload).toEqual({ v: 2 });
    expect(after?.generation).toBe(2);

    // 新代次领取后结算才生效
    const second = await q.claimOne('delivery', 'k', NOW + 30);
    expect(second.claimed).toBe(true);
    expect(second.generation).toBe(2);
    expect(await q.settle('delivery', 'k', 2, { kind: 'done' }, NOW + 31)).toBe(
      true
    );
    expect((await q.get('delivery', 'k'))?.status).toBe(EFFECT_STATUS_SETTLED);
  });
});

describe('later 语义（不计失败）', () => {
  it('due 前移、attempts 不增、状态仍 pending', async () => {
    const q = queue!;
    await q.enqueue('notice', 'k', {}, { now: NOW });
    const first = await q.claimOne('notice', 'k', NOW);
    expect(first.claimed).toBe(true);

    const retryAt = NOW + 5 * 60_000;
    expect(
      await q.settle('notice', 'k', 1, { kind: 'later', retryAt }, NOW)
    ).toBe(true);

    const entry = await q.get('notice', 'k');
    expect(entry?.attempts).toBe(0);
    expect(entry?.status).toBe(EFFECT_STATUS_PENDING);
    expect(entry?.dueAt).toBe(retryAt);

    // 缺省推迟时长（需先重新领取）
    const second = await q.claimOne('notice', 'k', retryAt);
    expect(second.claimed).toBe(true);
    await q.settle('notice', 'k', 1, { kind: 'later' }, retryAt);
    expect((await q.get('notice', 'k'))?.dueAt).toBe(
      retryAt + EFFECT_DEFAULT_LATER_MS
    );
  });
});

describe('FAILURES_BEFORE_ERROR 语义', () => {
  it('前两次失败只退避重排，第 3 次才升级 failed', async () => {
    const q = queue!;
    await q.enqueue('relay', 'k', {}, { now: NOW });
    const gen = 1;

    let t = NOW;
    let claimed = await q.claimOne('relay', 'k', t);
    expect(claimed.claimed).toBe(true);
    expect(
      await q.settle('relay', 'k', gen, { kind: 'failed', error: 'e1' }, t)
    ).toBe(true);
    let entry = await q.get('relay', 'k');
    expect(entry?.status).toBe(EFFECT_STATUS_PENDING);
    expect(entry?.attempts).toBe(1);
    expect(entry?.dueAt).toBe(t + effectRetryDelay(1));

    t = entry!.dueAt;
    claimed = await q.claimOne('relay', 'k', t);
    expect(claimed.claimed).toBe(true);
    expect(
      await q.settle('relay', 'k', gen, { kind: 'failed', error: 'e2' }, t)
    ).toBe(true);
    entry = await q.get('relay', 'k');
    expect(entry?.status).toBe(EFFECT_STATUS_PENDING);
    expect(entry?.attempts).toBe(2);

    t = entry!.dueAt;
    claimed = await q.claimOne('relay', 'k', t);
    expect(claimed.claimed).toBe(true);
    expect(
      await q.settle('relay', 'k', gen, { kind: 'failed', error: 'e3' }, t)
    ).toBe(true);
    entry = await q.get('relay', 'k');
    expect(entry?.status).toBe(EFFECT_STATUS_FAILED);
    expect(entry?.attempts).toBe(EFFECT_FAILURES_BEFORE_ERROR);
    expect(entry?.lastError).toBe('e3');
  });

  it('effectRetryDelay 指数递增并封顶', () => {
    expect(effectRetryDelay(1)).toBe(30_000);
    expect(effectRetryDelay(2)).toBe(60_000);
    expect(effectRetryDelay(3)).toBe(120_000);
    expect(effectRetryDelay(20)).toBe(30 * 60_000);
  });
});

describe('原子领取与崩溃自愈（P38-b）', () => {
  it('并发领取只有一个胜者；超陈旧窗口才可重领且 restored=true', async () => {
    const q = queue!;
    await q.enqueue('reply', 'k', { text: 'x' }, { now: NOW });

    const winner = await q.claimOne('reply', 'k', NOW);
    expect(winner.claimed).toBe(true);
    expect(winner.restored).toBe(false);
    expect(winner.payload).toEqual({ text: 'x' });
    expect(winner.attempts).toBe(0);

    // 窗口内重复领取 ⇒ 失败（不双投）
    expect((await q.claimOne('reply', 'k', NOW + 1)).claimed).toBe(false);
    expect(
      (await q.claimOne('reply', 'k', NOW + EFFECT_CLAIM_STALE_MS - 1)).claimed
    ).toBe(false);

    // 超过陈旧窗口 ⇒ 允许重领，并标记为"可能已发出"的重投
    const restored = await q.claimOne(
      'reply',
      'k',
      NOW + EFFECT_CLAIM_STALE_MS
    );
    expect(restored.claimed).toBe(true);
    expect(restored.restored).toBe(true);

    const entry = await q.get('reply', 'k');
    expect(entry?.status).toBe(EFFECT_STATUS_ATTEMPTING);
    expect(entry?.restored).toBe(true);
  });

  it('未领取直接结算返回 false，且不改状态', async () => {
    const q = queue!;
    await q.enqueue('delivery', 'k', {}, { now: NOW });

    expect(await q.settle('delivery', 'k', 1, { kind: 'done' }, NOW)).toBe(
      false
    );
    const entry = await q.get('delivery', 'k');
    expect(entry?.status).toBe(EFFECT_STATUS_PENDING);
    expect(entry?.attempts).toBe(0);
  });

  it('reply 上限为 8：第 8 次失败才置 failed', async () => {
    const q = queue!;
    await q.enqueue('reply', 'k', {}, { now: NOW });

    let t = NOW;
    for (let i = 1; i <= 8; i += 1) {
      const claimed = await q.claimOne('reply', 'k', t);
      expect(claimed.claimed).toBe(true);
      expect(await q.settle('reply', 'k', 1, { kind: 'failed' }, t)).toBe(true);

      const entry = await q.get('reply', 'k');
      expect(entry?.attempts).toBe(i);
      if (i < 8) {
        expect(entry?.status).toBe(EFFECT_STATUS_PENDING);
        t = entry!.dueAt;
      } else {
        expect(entry?.status).toBe(EFFECT_STATUS_FAILED);
      }
    }
  });
});

describe('计数（DB 可复算）', () => {
  it('按状态计数（含 attempting）', async () => {
    const q = queue!;
    await q.enqueue('assessment', 'a', {}, { now: NOW });
    await q.enqueue('assessment', 'b', {}, { now: NOW });
    await q.enqueue('assessment', 'c', {}, { now: NOW });

    expect((await q.claimOne('assessment', 'a', NOW)).claimed).toBe(true);
    await q.settle('assessment', 'a', 1, { kind: 'done' }, NOW);

    let t = NOW;
    for (let i = 0; i < 3; i += 1) {
      expect((await q.claimOne('assessment', 'b', t)).claimed).toBe(true);
      await q.settle('assessment', 'b', 1, { kind: 'failed' }, t);
      const entry = await q.get('assessment', 'b');
      if (i < 2) t = entry!.dueAt;
    }

    // c 保持"已领取未结算"
    expect((await q.claimOne('assessment', 'c', NOW)).claimed).toBe(true);

    expect(await q.counts()).toEqual({
      [EFFECT_STATUS_PENDING]: 0,
      [EFFECT_STATUS_ATTEMPTING]: 1,
      [EFFECT_STATUS_SETTLED]: 1,
      [EFFECT_STATUS_FAILED]: 1,
    });
  });
});
