/**
 * G-10 P4/P5：通道投递适配器 + `SUSPENDED` / `events.jsonl` 不变量。
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProactiveDeliveryAdapter } from '../../src/proactive/ProactiveDeliveryAdapter';
import { ProactivePushQueue } from '../../src/proactive/ProactivePushQueue';
import type { ProactiveMessagePayload } from '../../src/proactive/types';

const NOW = Date.parse('2026-10-19T12:00:00Z');

function payload(
  over: Partial<ProactiveMessagePayload> = {}
): ProactiveMessagePayload {
  return {
    id: 'p1',
    kind: 'task_result',
    priority: 'normal',
    dedupeKey: 'task:p1',
    title: '任务完成',
    body: '后台任务已完成',
    createdAt: NOW,
    expiresAt: NOW + 60 * 60_000,
    target: {
      mode: 'channel',
      channelId: 'telegram',
      conversationId: 'chat-1',
    },
    ...over,
  };
}

function fakePort() {
  const calls: Array<{
    platform: string;
    conversationId: string;
    content: string;
  }> = [];
  let available = true;
  let success = true;
  let resumeCalls = 0;
  return {
    calls,
    setAvailable(v: boolean) {
      available = v;
    },
    setSuccess(v: boolean) {
      success = v;
    },
    resumeSuspendedSession() {
      resumeCalls++;
    },
    getResumeCalls: () => resumeCalls,
    isPlatformAvailable: () => available,
    route: async (
      platform: string,
      conversationId: string,
      content: { format: 'text'; content: string }
    ) => {
      calls.push({ platform, conversationId, content: content.content });
      return { success, error: success ? undefined : 'send failed' };
    },
  };
}

describe('ProactiveDeliveryAdapter（P4）', () => {
  test('默认关闭 ⇒ 抛错（不触达通道）', async () => {
    const port = fakePort();
    const deliver = createProactiveDeliveryAdapter({ port });
    await expect(deliver(payload())).rejects.toThrow(
      'proactive_channel_routing_disabled'
    );
    expect(port.calls).toHaveLength(0);
  });

  test('启用 + 通道路由成功 ⇒ 只调用 route 一次', async () => {
    const port = fakePort();
    const deliver = createProactiveDeliveryAdapter({ port, enabled: true });
    await deliver(payload());

    expect(port.calls).toEqual([
      {
        platform: 'telegram',
        conversationId: 'chat-1',
        content: '任务完成\n\n后台任务已完成',
      },
    ]);
  });

  test('缺 channel 目标 / 通道不可用 / 投递失败 ⇒ 抛错由队列重试', async () => {
    const port = fakePort();
    const deliver = createProactiveDeliveryAdapter({ port, enabled: true });

    await expect(
      deliver(payload({ target: { mode: 'local' } }))
    ).rejects.toThrow('proactive_target_missing_channel');

    port.setAvailable(false);
    await expect(deliver(payload())).rejects.toThrow(
      'proactive_channel_unavailable:telegram'
    );

    port.setAvailable(true);
    port.setSuccess(false);
    await expect(deliver(payload())).rejects.toThrow('send failed');
  });

  test('不触碰 SUSPENDED / 恢复入口（P5 不变量）', async () => {
    const port = fakePort();
    const deliver = createProactiveDeliveryAdapter({ port, enabled: true });
    await deliver(payload());
    expect(port.getResumeCalls()).toBe(0);
  });
});

describe('队列不变量（P5）：不写 events.jsonl', () => {
  let dir: string;
  let queue: ProactivePushQueue;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'liri-proactive-invariant-'));
    queue = new ProactivePushQueue({ dbPath: join(dir, 'queue.db') });
    await queue.init();
  });

  afterEach(async () => {
    await queue.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('enqueue + scanOnce 前后会话事件文件字节不变', async () => {
    const eventsPath = join(dir, 'events.jsonl');
    const original = '{"seq":1,"type":"user/message"}\n';
    writeFileSync(eventsPath, original, 'utf8');

    await queue.enqueue(payload({ target: { mode: 'local' } }), NOW);
    await queue.scanOnce(async () => {}, NOW);

    expect(readFileSync(eventsPath, 'utf8')).toBe(original);
  });
});
