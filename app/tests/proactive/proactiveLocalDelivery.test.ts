/**
 * G-10 P3：主动消息本地投递契约（队列 → notifications）。
 *
 * 覆盖：字段映射（类别/优先级/动作/链接/过期秒）、投递幂等、通道目标拒收。
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotificationPersistence } from '../../src/runtime/NotificationPersistence';
import type { NotificationCreateInput } from '../../src/runtime/NotificationPersistence';
import {
  createProactiveLocalDelivery,
  PROACTIVE_NOTIFICATION_SOURCE,
  type ProactiveLocalPort,
} from '../../src/proactive/ProactiveLocalDelivery';
import type { ProactiveMessagePayload } from '../../src/proactive/types';

const NOW = Date.parse('2026-10-19T12:00:00Z');
const HOUR_MS = 60 * 60 * 1000;

function payload(
  over: Partial<ProactiveMessagePayload> = {}
): ProactiveMessagePayload {
  return {
    id: 'p1',
    kind: 'task_result',
    priority: 'normal',
    dedupeKey: 'task:t1:done',
    title: '任务完成',
    body: '构建已通过',
    createdAt: NOW,
    expiresAt: NOW + HOUR_MS,
    ...over,
  };
}

class FakePort implements ProactiveLocalPort {
  readonly created: NotificationCreateInput[] = [];
  readonly existing = new Set<string>();

  async findBySourceRef(
    source: string,
    sourceRef: string
  ): Promise<unknown | null> {
    return this.existing.has(`${source}:${sourceRef}`) ? { id: 'n0' } : null;
  }

  async create(input: NotificationCreateInput): Promise<unknown> {
    this.created.push(input);
    return { id: `n${this.created.length}` };
  }
}

describe('ProactiveLocalDelivery：字段映射', () => {
  test('critical + 动作 + 会话链接 ⇒ notice/urgent，动作降级为查看/关闭', async () => {
    const port = new FakePort();
    const deliver = createProactiveLocalDelivery({ port });
    await deliver(
      payload({
        priority: 'critical',
        actions: [
          { id: 'open', label: '打开会话', kind: 'open_session', target: 's1' },
          { id: 'dismiss', label: '关闭', kind: 'dismiss' },
        ],
        target: { mode: 'local', sessionId: 's1' },
      })
    );

    expect(port.created).toHaveLength(1);
    const input = port.created[0]!;
    expect(input.category).toBe('notice');
    expect(input.priority).toBe('urgent');
    expect(input.source).toBe(PROACTIVE_NOTIFICATION_SOURCE);
    expect(input.source_ref).toBe('p1');
    expect(input.actions).toEqual([
      { label: '打开会话', action: 'view' },
      { label: '关闭', action: 'dismiss' },
    ]);
    expect(input.link_to).toEqual({ type: 'session', id: 's1' });
    expect(input.expires_at).toBe(Math.floor((NOW + HOUR_MS) / 1000));
  });

  test('high/normal/low ⇒ normal/normal/low（high 不冒充 critical）', async () => {
    const port = new FakePort();
    const deliver = createProactiveLocalDelivery({ port });
    await deliver(payload({ id: 'a', priority: 'high' }));
    await deliver(payload({ id: 'b', priority: 'normal' }));
    await deliver(payload({ id: 'c', priority: 'low' }));

    expect(port.created.map((i) => i.priority)).toEqual([
      'normal',
      'normal',
      'low',
    ]);
  });

  test('未给 target ⇒ 仍按本地投递，且无链接', async () => {
    const port = new FakePort();
    const deliver = createProactiveLocalDelivery({ port });
    await deliver(payload());
    expect(port.created[0]?.link_to).toBeNull();
  });
});

describe('ProactiveLocalDelivery：幂等与隔离', () => {
  test('同 source_ref 已存在 ⇒ 不重复创建', async () => {
    const port = new FakePort();
    port.existing.add(`${PROACTIVE_NOTIFICATION_SOURCE}:p1`);
    const deliver = createProactiveLocalDelivery({ port });
    await deliver(payload());
    expect(port.created).toHaveLength(0);
  });

  test('channel 目标 ⇒ 拒收（交回通道适配器）', async () => {
    const port = new FakePort();
    const deliver = createProactiveLocalDelivery({ port });
    await expect(
      deliver(
        payload({
          target: {
            mode: 'channel',
            channelId: 'telegram',
            conversationId: 'c1',
          },
        })
      )
    ).rejects.toThrow('proactive_local_delivery_channel_target');
    expect(port.created).toHaveLength(0);
  });
});

describe('ProactiveLocalDelivery：真实 notifications 表', () => {
  const dirs: string[] = [];
  let persistence: NotificationPersistence | null = null;

  afterEach(async () => {
    await persistence?.dispose();
    persistence = null;
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('重放同一 payload 只落一条通知', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'liri-proactive-local-'));
    dirs.push(dir);
    persistence = new NotificationPersistence(join(dir, 'notifications.db'));
    await persistence.init();

    const deliver = createProactiveLocalDelivery({ port: persistence });
    await deliver(payload());
    await deliver(payload());

    const listed = await persistence.list({});
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]?.source).toBe(PROACTIVE_NOTIFICATION_SOURCE);
    expect(listed.items[0]?.source_ref).toBe('p1');
  });
});
