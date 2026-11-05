/**
 * P38-b-3 · `reply` effects 派发运行时
 *
 * 验收口径（方案 §6 / §7）：
 * ① 开关开启：入队 → 扫描器领取 → 真实回传 → 结算；
 * ② 并发扫描只有一个胜者（`claimOne` 原子条件更新）；
 * ③ 陈旧 `effect_attempting` 可被自愈重领；
 * ④ 失败按退避重排（达 8 次才 failed）；项已不存在 ⇒ 失败累计；
 * ⑤ 开关关闭：入队返回 false（回落原链路）、扫描器不启动（回滚）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { EffectQueue } from '../../../src/tasks/effects/EffectQueue';
import {
  dispatchDueReplies,
  enqueueReplyEffect,
  setReplyEffectQueueForTest,
  startReplyEffectDispatcher,
  type ReplyDispatchDeps,
} from '../../../src/tasks/effects/replyEffectRuntime';
import {
  REPLY_EFFECT_KIND,
  replyEffectKey,
} from '../../../src/tasks/effects/replyShadow';
import {
  EFFECT_CLAIM_STALE_MS,
  EFFECT_STATUS_FAILED,
  EFFECT_STATUS_PENDING,
  EFFECT_STATUS_SETTLED,
} from '../../../src/tasks/effects';
import type { InboxItem } from '@openliri/service/runtime/InboxManager';

const NOW = Date.parse('2026-11-02T12:00:00Z');

function fakeItem(id: string): InboxItem {
  return {
    id,
    channelId: 'feishu',
    channelSessionId: 'cs-1',
    channelConversationId: 'conv-1',
    status: 'replied',
    reply: 'approve',
    title: '审批项',
  } as unknown as InboxItem;
}

let dir: string;
let queue: EffectQueue | null = null;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'p38b3-reply-'));
  queue = new EffectQueue(join(dir, 'effects.db'));
  setReplyEffectQueueForTest(queue);
  process.env.FEATURE_EFFECT_REPLY_MIGRATION = 'true';
});

afterEach(() => {
  setReplyEffectQueueForTest(null);
  delete process.env.FEATURE_EFFECT_REPLY_MIGRATION;
  queue?.close();
  queue = null;
  rmSync(dir, { recursive: true, force: true });
});

const key = replyEffectKey('feishu', 'inbox-1');

async function seed(): Promise<void> {
  await queue!.enqueue(
    REPLY_EFFECT_KIND,
    key,
    {
      inboxItemId: 'inbox-1',
      channelId: 'feishu',
      channelSessionId: 'cs-1',
    },
    { now: NOW }
  );
}

describe('派发（开关开启）', () => {
  it('入队 → 领取 → 回传 → settled', async () => {
    await seed();
    const relayed: string[] = [];
    const deps: ReplyDispatchDeps = {
      loadItem: async (id) => fakeItem(id),
      relay: async (item) => {
        relayed.push(item.id);
        return true;
      },
    };

    expect(await dispatchDueReplies(deps, NOW)).toBe(1);
    expect(relayed).toEqual(['inbox-1']);
    expect((await queue!.get(REPLY_EFFECT_KIND, key))?.status).toBe(
      EFFECT_STATUS_SETTLED
    );
  });

  it('回传未成功 ⇒ 按退避重排（attempts+1，仍 pending）', async () => {
    await seed();
    const deps: ReplyDispatchDeps = {
      loadItem: async (id) => fakeItem(id),
      relay: async () => false,
    };

    expect(await dispatchDueReplies(deps, NOW)).toBe(1);
    const entry = await queue!.get(REPLY_EFFECT_KIND, key);
    expect(entry?.status).toBe(EFFECT_STATUS_PENDING);
    expect(entry?.attempts).toBe(1);
    expect(entry?.dueAt).toBeGreaterThan(NOW);
  });

  it('Inbox 项已不存在 ⇒ 失败累计（不误判成功）', async () => {
    await seed();
    const deps: ReplyDispatchDeps = {
      loadItem: async () => null,
      relay: async () => true,
    };

    expect(await dispatchDueReplies(deps, NOW)).toBe(1);
    const entry = await queue!.get(REPLY_EFFECT_KIND, key);
    expect(entry?.status).toBe(EFFECT_STATUS_PENDING);
    expect(entry?.attempts).toBe(1);
    expect(entry?.lastError).toBe('inbox_item_missing');
  });

  it('回传抛错 ⇒ 失败累计（不中断扫描器）', async () => {
    await seed();
    const deps: ReplyDispatchDeps = {
      loadItem: async (id) => fakeItem(id),
      relay: async () => {
        throw new Error('channel down');
      },
    };

    expect(await dispatchDueReplies(deps, NOW)).toBe(1);
    const entry = await queue!.get(REPLY_EFFECT_KIND, key);
    expect(entry?.attempts).toBe(1);
    expect(entry?.lastError).toContain('relay_failed');
  });

  it('并发扫描只有单胜者（回传只发生一次）', async () => {
    await seed();
    let calls = 0;
    const deps: ReplyDispatchDeps = {
      loadItem: async (id) => fakeItem(id),
      relay: async () => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return true;
      },
    };

    const [a, b] = await Promise.all([
      dispatchDueReplies(deps, NOW),
      dispatchDueReplies(deps, NOW),
    ]);
    expect(calls).toBe(1);
    expect(a + b).toBe(1);
  });

  it('陈旧 attempting 可自愈重领（窗口内不可）', async () => {
    await seed();
    expect((await queue!.claimOne(REPLY_EFFECT_KIND, key, NOW)).claimed).toBe(
      true
    );

    let calls = 0;
    const deps: ReplyDispatchDeps = {
      loadItem: async (id) => fakeItem(id),
      relay: async () => {
        calls += 1;
        return true;
      },
    };

    // 窗口内：无候选
    expect(await dispatchDueReplies(deps, NOW + 1)).toBe(0);
    expect(calls).toBe(0);

    // 超过陈旧窗口：重领并投递
    expect(await dispatchDueReplies(deps, NOW + EFFECT_CLAIM_STALE_MS)).toBe(1);
    expect(calls).toBe(1);
    expect((await queue!.get(REPLY_EFFECT_KIND, key))?.status).toBe(
      EFFECT_STATUS_SETTLED
    );
  });

  it('reply 达 8 次失败才置 failed', async () => {
    await seed();
    const deps: ReplyDispatchDeps = {
      loadItem: async (id) => fakeItem(id),
      relay: async () => false,
    };

    let t = NOW;
    for (let i = 1; i <= 8; i += 1) {
      expect(await dispatchDueReplies(deps, t)).toBe(1);
      const entry = await queue!.get(REPLY_EFFECT_KIND, key);
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

describe('开关与回滚', () => {
  it('开关关闭：入队返回 false，且不写队列（回落原链路）', async () => {
    process.env.FEATURE_EFFECT_REPLY_MIGRATION = 'false';
    expect(
      await enqueueReplyEffect({
        inboxItemId: 'inbox-9',
        channelId: 'feishu',
      })
    ).toBe(false);
    expect(
      await queue!.get(REPLY_EFFECT_KIND, replyEffectKey('feishu', 'inbox-9'))
    ).toBe(undefined);
  });

  it('开关开启：入队返回 true 并落库', async () => {
    expect(
      await enqueueReplyEffect({
        inboxItemId: 'inbox-9',
        channelId: 'feishu',
      })
    ).toBe(true);
    expect(
      (await queue!.get(REPLY_EFFECT_KIND, replyEffectKey('feishu', 'inbox-9')))
        ?.status
    ).toBe(EFFECT_STATUS_PENDING);
  });

  it('开关关闭：扫描器不启动（回滚后不再消费队列）', async () => {
    process.env.FEATURE_EFFECT_REPLY_MIGRATION = 'false';
    let called = 0;
    const stop = startReplyEffectDispatcher({
      loadItem: async (id) => {
        called += 1;
        return fakeItem(id);
      },
      relay: async () => true,
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(called).toBe(0);
    stop();
  });
});
