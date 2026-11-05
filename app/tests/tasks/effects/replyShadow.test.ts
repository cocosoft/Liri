/**
 * P38-b-2 · `reply` 影子队列（只写不派发）
 *
 * 验收口径（方案 §5 / §7）：
 * ① 真实回传结束后写一条影子记录（幂等键 `channelId:inboxItemId`）；
 * ② 真实失败也照写（队列侧会重试，差异只记日志）；
 * ③ 影子写失败**不得**影响真实链路（不抛出）；
 * ④ 开关 `EFFECT_REPLY_MIGRATION=true` ⇒ 影子停止（b-3 由真实链路自己入队）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { EffectQueue } from '../../../src/tasks/effects/EffectQueue';
import { EFFECT_STATUS_PENDING } from '../../../src/tasks/effects';
import {
  REPLY_EFFECT_KIND,
  replyEffectKey,
  setReplyShadowQueueForTest,
  shadowReplyRelay,
} from '../../../src/tasks/effects/replyShadow';

let dir: string;
let queue: EffectQueue | null = null;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'p38b2-reply-'));
  queue = new EffectQueue(join(dir, 'effects.db'));
  setReplyShadowQueueForTest(queue);
});

afterEach(() => {
  setReplyShadowQueueForTest(null);
  delete process.env.FEATURE_EFFECT_REPLY_MIGRATION;
  queue?.close();
  queue = null;
  rmSync(dir, { recursive: true, force: true });
});

describe('影子写（只写不派发）', () => {
  it('真实发送成功后入队一条 pending，载荷为最小字段', async () => {
    await shadowReplyRelay({
      inboxItemId: 'inbox-1',
      channelId: 'feishu',
      channelSessionId: 'cs-1',
      conversationId: 'conv-1',
      reply: 'approve',
      delivered: true,
    });

    const entry = await queue!.get(
      REPLY_EFFECT_KIND,
      replyEffectKey('feishu', 'inbox-1')
    );
    expect(entry?.status).toBe(EFFECT_STATUS_PENDING);
    expect(entry?.attempts).toBe(0);
    expect(entry?.generation).toBe(1);
    expect(entry?.payload).toEqual({
      inboxItemId: 'inbox-1',
      channelId: 'feishu',
      channelSessionId: 'cs-1',
      conversationId: 'conv-1',
      reply: 'approve',
      // P38 观察字段：差异率复算用（真实投递成功）
      realDelivered: true,
    });
    // 只写不派发：仍可被领取，但本批没有任何消费者
    expect((await queue!.claimDue(Date.now(), 10)).length).toBe(1);
  });

  it('真实失败也照写；同 Inbox 项重复入队 ⇒ 单行、generation+1', async () => {
    const input = {
      inboxItemId: 'inbox-2',
      channelId: 'feishu',
      channelSessionId: 'cs-2',
      reply: 'reject',
      delivered: false,
    };
    await shadowReplyRelay(input);
    await shadowReplyRelay(input);

    const key = replyEffectKey('feishu', 'inbox-2');
    const entry = await queue!.get(REPLY_EFFECT_KIND, key);
    expect(entry?.generation).toBe(2);
    expect(entry?.attempts).toBe(0);
    // P38 观察字段：真实投递失败 ⇒ 差异率分子（不依赖日志轮转）
    expect(entry?.payload.realDelivered).toBe(false);
    const counts = await queue!.counts();
    expect(counts[EFFECT_STATUS_PENDING]).toBe(1);
  });
});

describe('影响面隔离', () => {
  it('影子写失败不抛出（不影响真实回传）', async () => {
    setReplyShadowQueueForTest({
      enqueue: async () => {
        throw new Error('db unavailable');
      },
    });

    await expect(
      shadowReplyRelay({
        inboxItemId: 'inbox-3',
        channelId: 'feishu',
        delivered: true,
      })
    ).resolves.toBeUndefined();
  });

  it('开关打开时不写影子（b-3 由真实链路入队）', async () => {
    let calls = 0;
    setReplyShadowQueueForTest({
      enqueue: async () => {
        calls += 1;
        return 1;
      },
    });
    process.env.FEATURE_EFFECT_REPLY_MIGRATION = 'true';

    await shadowReplyRelay({
      inboxItemId: 'inbox-4',
      channelId: 'feishu',
      delivered: true,
    });
    expect(calls).toBe(0);

    process.env.FEATURE_EFFECT_REPLY_MIGRATION = 'false';
    await shadowReplyRelay({
      inboxItemId: 'inbox-4',
      channelId: 'feishu',
      delivered: true,
    });
    expect(calls).toBe(1);
  });
});
