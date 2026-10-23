/**
 * 入站 DTO 标准化 + 入站端口（通道治理 阶段 2.4，2026-10-12）。
 *
 * ① `toInboundEnvelope()` 纯函数：`MessageContext`（协议层）→ `InboundEnvelope`（标准化入站 DTO）；
 * ② `IInboundGatewayPort`：未注册 ⇒ **未注册裁决**（不伪造接受）；适配器 ⇒ 形状搬运。
 */
import { describe, expect, it } from 'bun:test';
import { toInboundEnvelope } from '../../src/channels/routing/messageRouterContract.js';
import { resolveInboundGateway } from '@openliri/kernel/spi/InboundGatewayService.js';
import { InboundGatewayPortAdapter } from '../../src/channels/gateway/InboundGatewayPortAdapter.js';

describe('入站 DTO 标准化（阶段 2.4）', () => {
  it('文本消息 ⇒ payload.type=text，sender/platform 取自通道与发送者', () => {
    const e = toInboundEnvelope({
      channelId: 'telegram',
      senderId: 'u1',
      messageId: 'm1',
      messageType: 'text',
      content: '你好',
      timestamp: 1700000000000,
    });

    expect(e).toEqual({
      messageId: 'm1',
      platform: 'telegram',
      payload: { type: 'text', content: '你好' },
      sender: { platform: 'telegram', userId: 'u1' },
      receivedAt: 1700000000000,
    });
    expect('sessionId' in e).toBe(false); // 入站阶段未知 ⇒ 不臆造
  });

  it('非文本（image/file/voice/event/unknown）⇒ 统一归 file', () => {
    for (const t of ['image', 'file', 'voice', 'event', 'unknown']) {
      expect(
        toInboundEnvelope({
          channelId: 'qq',
          senderId: 'u',
          messageId: 'm',
          messageType: t,
          content: 'c',
          timestamp: 1,
        }).payload.type
      ).toBe('file');
    }
  });

  it('附件：mimeType→type、fileName→name、保留 url/size；无附件 ⇒ 键省略', () => {
    const e = toInboundEnvelope({
      channelId: 'telegram',
      senderId: 'u',
      messageId: 'm',
      messageType: 'file',
      content: '',
      timestamp: 2,
      attachments: [
        {
          fileName: 'a.png',
          mimeType: 'image/png',
          url: 'https://x/a.png',
          size: 100,
        },
        { fileName: 'b.bin' }, // 无 mime/url/size ⇒ type 兜底 file，其余键省略
      ],
    });

    expect(e.payload.attachments).toEqual([
      { type: 'image/png', url: 'https://x/a.png', name: 'a.png', size: 100 },
      { type: 'file', name: 'b.bin' },
    ]);

    const noAtt = toInboundEnvelope({
      channelId: 'qq',
      senderId: 'u',
      messageId: 'm',
      messageType: 'text',
      content: 'c',
      timestamp: 3,
      attachments: [],
    });
    expect('attachments' in noAtt.payload).toBe(false);
  });
});

describe('入站网关端口（阶段 2.4 · UW 预留）', () => {
  it('未注册 ⇒ 未注册裁决（accepted:false，不伪造接受）', async () => {
    const v = await resolveInboundGateway().route({
      messageId: 'm',
      platform: 'telegram',
      payload: { type: 'text', content: 'hi' },
      sender: { platform: 'telegram', userId: 'u' },
      receivedAt: 1,
    });
    expect(v.accepted).toBe(false);
    expect(v.reason).toContain('not registered');
  });

  it('适配器 ⇒ core DTO 原样转发给注入的 route 委托（零业务逻辑）', async () => {
    let seen: unknown;
    const adapter = new InboundGatewayPortAdapter({
      route: async (env) => {
        seen = env;
        return { accepted: true, sessionId: 's-1' };
      },
    });

    const env = {
      messageId: 'm',
      platform: 'qq',
      payload: { type: 'text' as const, content: 'hi' },
      sender: { platform: 'qq', userId: 'u' },
      receivedAt: 7,
    };
    expect(await adapter.route(env)).toEqual({
      accepted: true,
      sessionId: 's-1',
    });
    expect(seen).toEqual(env);
  });
});
