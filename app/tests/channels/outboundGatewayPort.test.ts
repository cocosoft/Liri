/**
 * 出站网关端口（通道治理 阶段 2.1「Port Layer Only」，2026-10-12）。
 *
 * 覆盖：① 未注册时 `resolveOutboundGateway()` 的空操作语义（以**失败结果**作答，不伪造成功）；
 * ② `OutboundGatewayPortAdapter` 的**形状搬运**（core DTO 原样转发给 delegate）。
 */
import { describe, expect, it } from 'bun:test';
import { resolveOutboundGateway } from '@openliri/kernel/spi/GatewayService.js';
import { OutboundGatewayPortAdapter } from '../../src/channels/gateway/OutboundGatewayPortAdapter.js';

describe('出站网关端口（阶段 2.1 · Port Layer Only）', () => {
  it('未注册 ⇒ 空操作代理以**失败结果**作答（不伪造成功，不造默认值）', async () => {
    const r = await resolveOutboundGateway().deliverToOrigin('telegram', 'c1', {
      format: 'text',
      content: 'hi',
    });
    expect(r.success).toBe(false);
    expect(r.error).toContain('not registered');

    const b = await resolveOutboundGateway().broadcast({
      format: 'text',
      content: 'hi',
    });
    expect(b).toEqual({ total: 0, success: 0, failed: 0 });
  });

  it('适配器：注入 delegate ⇒ core DTO 原样转发（形状搬运，零业务逻辑）', async () => {
    let seen: unknown;
    const adapter = new OutboundGatewayPortAdapter({
      deliverToOrigin: async (platform, conversationId, content) => {
        seen = { platform, conversationId, content };
        return { success: true, actualFormat: 'text' };
      },
      broadcast: async () => ({ total: 2, success: 2, failed: 0 }),
    });

    const r = await adapter.deliverToOrigin('qq', 'room', {
      format: 'markdown',
      content: 'x',
    });
    expect(r).toEqual({ success: true, actualFormat: 'text' });
    expect(seen).toEqual({
      platform: 'qq',
      conversationId: 'room',
      content: { format: 'markdown', content: 'x' },
    });

    expect(await adapter.broadcast({ format: 'text', content: 'y' })).toEqual({
      total: 2,
      success: 2,
      failed: 0,
    });
  });
});
