/**
 * Nostr 通道契约 + 诚实性桩（2026-11-01）。
 *
 * 现状（如实）：`NostrChannel` 是**遗留 EventEmitter 壳** —— `connect()` 只置标志、
 * `publishEvent()` 只生成随机 id 并 emit，**没有任何 WebSocket relay 与事件签名**。
 * 因此本用例不解码线协议，只钉住两件**不能错**的事：
 *   ① 未就绪时**不得谎报成功**（此前 `sendTextMessage` 恒返回 success，消息静默丢失）；
 *   ② 类层语义：未 connect ⇒ `publishEvent` 返回 null；connect 后 DM 走 `kind=4` 并 emit。
 *
 * 真正的 relay 传输 + secp256k1 签名是独立工作项，未在本轮臆造。
 */
import { describe, expect, it } from 'bun:test';
import {
  createNostrChannel,
  NostrChannel,
} from '../../src/channels/nostr/NostrChannel';

describe('Nostr 通道（壳语义 + 不谎报）', () => {
  it('插件层：未就绪时 sendText 必须失败并说明原因', async () => {
    const ch = createNostrChannel();

    const r = await ch.outbound.sendText('npub1xyz', '你好');

    expect(r.success).toBe(false);
    expect(r.error).toContain('未就绪');
  });

  it('类层：未 connect ⇒ publishEvent 返回 null（不伪造事件 id）', async () => {
    const c = new NostrChannel({
      enabled: true,
      relays: ['wss://relay.local'],
    });

    expect(await c.publishEvent('x')).toBeNull();
    expect(await c.sendDirectMessage('npub1xyz', 'x')).toBeNull();
  });

  it('类层：connect 后私信按 kind=4 发布并 emit event:published', async () => {
    const c = new NostrChannel({
      enabled: true,
      relays: ['wss://relay.local'],
    });
    expect(await c.connect()).toBe(true);

    const published: Array<{ kind: number; content: string }> = [];
    c.on('event:published', (e: { kind: number; content: string }) =>
      published.push(e)
    );

    const id = await c.sendDirectMessage('npub1xyz', '你好');

    expect(typeof id).toBe('string');
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({ kind: 4, content: '你好' });
  });
});
