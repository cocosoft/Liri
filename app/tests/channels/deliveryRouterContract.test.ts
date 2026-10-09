// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import { describe, expect, it } from 'bun:test';
import { DeliveryRouter } from '../../src/channels/DeliveryRouter';
import type { DeliveryContent } from '../../src/channels/DeliveryRouter';
import { DeliveryTarget } from '../../src/channels/DeliveryTarget';
import type {
  ChannelInterface,
  ChannelOutbound,
  ChannelRegistry,
} from '../../src/channels/registry/ChannelRegistry';

/**
 * R11 **DeliveryRouter 行为契约**（第九轮审查 §5.2 的"能力降级 / 不重复 / 隔离"维度）。
 *
 * DeliveryRouter 是**跨通道共享**的出站统一路径（格式降级 + per-channel 串行化 +
 * 断线自动重连）。它对所有 26 通道**一视同仁**，正是"能力契约"应被集中验证之处：
 *   D1 **能力降级链**：`interactive → markdown → text`（通道缺能力 ⇒ 逐级降级，不静默丢）。
 *   D2 **部分能力**：有 markdown 无 interactive ⇒ 落在 markdown。
 *   D3 **全不支持**：无任何出站方法 ⇒ 失败（非静默成功）。
 *   D4 **markdown→text**：无 markdown 能力 ⇒ 文本化（去记号）。
 *   D5 **未注册通道**：明确失败 '通道未注册'（非抛错/静默）。
 *   D6 **断线自动重连**：未连接 ⇒ connect() 一次；成功继续投递、失败明确报错。
 *   D7 **per-channel 串行化**：同通道并发投递**不交错**（防乱序）。
 *   D8 **text 失败重试一次**：首抛错 ⇒ 重试成功。
 */

/** 极简假注册中心（只实现 DeliveryRouter 用到的 get / getEnabled） */
class FakeRegistry {
  constructor(private readonly channels: Map<string, ChannelInterface>) {}
  get(name: string): ChannelInterface | undefined {
    return this.channels.get(name);
  }
  getEnabled(): ChannelInterface[] {
    return [...this.channels.values()].filter((c) => c.enabled);
  }
}

function makeRouter(channels: ChannelInterface[]): DeliveryRouter {
  const map = new Map(channels.map((c) => [c.name, c]));
  return new DeliveryRouter(
    new FakeRegistry(map) as unknown as ChannelRegistry
  );
}

function fakeChannel(
  name: string,
  outbound: Partial<ChannelOutbound>,
  opts: { connected?: boolean; connectResult?: boolean } = {}
): ChannelInterface {
  return {
    name,
    type: name,
    enabled: true,
    connected: opts.connected ?? true,
    connect: async () => opts.connectResult ?? true,
    disconnect: async () => {},
    sendMessage: async () => true,
    getStatus: () => ({}),
    plugin: { outbound: outbound as ChannelOutbound },
  };
}

const textContent: DeliveryContent = { format: 'text', content: 'hi' };
const mdContent: DeliveryContent = {
  format: 'markdown',
  content: '**bold** text',
};
const cardContent: DeliveryContent = {
  format: 'interactive',
  card: { title: 'T', options: [{ label: 'A', value: 'a' }] },
  fallbackText: 'fb',
};

describe('R11 DeliveryRouter 契约', () => {
  it('D1 能力降级链：无 interactive/markdown ⇒ 落到 text，fallbackSteps 记录降级', async () => {
    const router = makeRouter([
      fakeChannel('webhook', { sendText: async () => true }),
    ]);
    const r = await router.deliverToTarget(
      new DeliveryTarget('webhook', 'room'),
      cardContent
    );
    expect(r.success).toBe(true);
    expect(r.actualFormat).toBe('text');
    expect(r.fallbackSteps).toEqual(['markdown', 'text']);
  });

  it('D2 部分能力：有 markdown 无 interactive ⇒ 落在 markdown', async () => {
    const router = makeRouter([
      fakeChannel('webhook', {
        sendText: async () => true,
        sendMarkdown: async () => true,
      }),
    ]);
    const r = await router.deliverToTarget(
      new DeliveryTarget('webhook', 'room'),
      cardContent
    );
    expect(r.success).toBe(true);
    expect(r.actualFormat).toBe('markdown');
    expect(r.fallbackSteps).toEqual(['markdown']);
  });

  it('D3 全不支持：无任何出站方法 ⇒ 失败（不静默成功）', async () => {
    const router = makeRouter([fakeChannel('webhook', {})]);
    const r = await router.deliverToTarget(
      new DeliveryTarget('webhook', 'room'),
      textContent
    );
    expect(r.success).toBe(false);
  });

  it('D4 markdown→text：无 markdown 能力 ⇒ 文本化（去记号）', async () => {
    let sent = '';
    const router = makeRouter([
      fakeChannel('webhook', {
        sendText: async (_t, c) => {
          sent = c;
          return true;
        },
      }),
    ]);
    const r = await router.deliverToTarget(
      new DeliveryTarget('webhook', 'room'),
      mdContent
    );
    expect(r.success).toBe(true);
    expect(r.actualFormat).toBe('text');
    expect(sent).toBe('bold text');
  });

  it('D5 未注册通道 ⇒ 明确失败（非抛错）', async () => {
    const router = makeRouter([]);
    const r = await router.deliverToTarget(
      new DeliveryTarget('webhook', 'room'),
      textContent
    );
    expect(r.success).toBe(false);
    expect(r.error).toBe('通道未注册');
  });

  it('D6 断线自动重连：未连接 ⇒ connect() 一次后投递成功', async () => {
    let connectCalls = 0;
    const ch = fakeChannel(
      'webhook',
      { sendText: async () => true },
      { connected: false, connectResult: true }
    );
    ch.connect = async () => {
      connectCalls++;
      return true;
    };
    const router = makeRouter([ch]);
    const r = await router.deliverToTarget(
      new DeliveryTarget('webhook', 'room'),
      textContent
    );
    expect(connectCalls).toBe(1);
    expect(r.success).toBe(true);
  });

  it('D6b 重连失败 ⇒ 明确报错', async () => {
    const ch = fakeChannel(
      'webhook',
      { sendText: async () => true },
      { connected: false, connectResult: false }
    );
    const router = makeRouter([ch]);
    const r = await router.deliverToTarget(
      new DeliveryTarget('webhook', 'room'),
      textContent
    );
    expect(r.success).toBe(false);
    expect(r.error).toBe('自动重连失败');
  });

  it('D7 per-channel 串行化：同通道并发投递不交错', async () => {
    const events: string[] = [];
    const router = makeRouter([
      fakeChannel('webhook', {
        sendText: async () => {
          events.push('start');
          await new Promise((r) => setTimeout(r, 20));
          events.push('end');
          return true;
        },
      }),
    ]);
    const t = new DeliveryTarget('webhook', 'room');
    await Promise.all([
      router.deliverToTarget(t, textContent),
      router.deliverToTarget(t, textContent),
    ]);
    expect(events).toEqual(['start', 'end', 'start', 'end']);
  });

  it('D8 text 失败重试一次：首抛错 ⇒ 重试成功', async () => {
    let calls = 0;
    const router = makeRouter([
      fakeChannel('webhook', {
        sendText: async () => {
          calls++;
          if (calls === 1) throw new Error('boom');
          return true;
        },
      }),
    ]);
    const r = await router.deliverToTarget(
      new DeliveryTarget('webhook', 'room'),
      textContent
    );
    expect(calls).toBe(2);
    expect(r.success).toBe(true);
  });
});
