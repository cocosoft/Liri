// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P38 观察口径（2026-11-10）：`relayReplyToChannel` 的「是否真的发出」归一。
 *
 * 背景：影子队列（`effect_queue`，`kind='reply'`）是观察期差异率的**唯一**数据源；
 * 主路径此前对 `sendInteractive/sendMarkdown/sendText` 无条件 `sent = true`，
 * 而插件式渠道常见「返回 `{success:false}` 不抛错」（`WebhookChannelPlugin` 即如此）
 * ⇒ 真实失败被记成 `delivered=true`，差异率分子恒为 0。
 *
 * 本用例锁归一规则（保守、向后兼容）：
 * - 带 `success` 字段 ⇒ 只认 `success === true`；
 * - 旧适配器（`void` / `boolean` / 无 `success` 的对象）⇒ 视为已发出，行为不变。
 */
import { describe, it, expect, afterEach } from 'bun:test';
import {
  isSendDelivered,
  relayReplyToChannel,
  setReplyEffectPort,
  type ReplyShadowPayload,
} from '../../src/channels/bridge/inboxChannelReply';
import { channelRegistry } from '../../src/channels/registry/ChannelRegistry';
import { channelBootstrapper } from '../../src/channels/bootstrap/ChannelBootstrapper';
import type { InboxItem } from '@openliri/service/runtime/InboxManager';

describe('isSendDelivered — outbound 返回值归一', () => {
  it('SendResult.success=true ⇒ 已发出', () => {
    expect(isSendDelivered({ success: true })).toBe(true);
    expect(isSendDelivered({ success: true, messageId: 'm1' })).toBe(true);
  });

  it('SendResult.success=false（插件捕获异常后的形态）⇒ 未发出', () => {
    expect(isSendDelivered({ success: false })).toBe(false);
    expect(isSendDelivered({ success: false, error: 'Webhook: 不支持' })).toBe(
      false
    );
  });

  it('success 非布尔（脏值）⇒ 按未发出（fail-closed）', () => {
    expect(isSendDelivered({ success: 'true' })).toBe(false);
    expect(isSendDelivered({ success: 1 })).toBe(false);
    expect(isSendDelivered({ success: undefined })).toBe(false);
  });

  it('旧适配器（void / boolean / 无 success 对象）⇒ 维持既有语义（已发出）', () => {
    expect(isSendDelivered(undefined)).toBe(true);
    expect(isSendDelivered(null)).toBe(true);
    expect(isSendDelivered(true)).toBe(true);
    expect(isSendDelivered({ messageId: 'legacy' })).toBe(true);
  });
});

/** 审批回复项夹具（只需回传路径消费的字段） */
function inboxItem(): InboxItem {
  return {
    id: 'inbox-shadow-1',
    sessionId: 'sess-shadow',
    type: 'approval',
    title: '审批探针',
    message: '请确认',
    status: 'replied',
    reply: 'approve',
    offlineCapable: false,
    source: 'probe',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    channelId: 'webhook',
    channelSessionId: 'http://127.0.0.1:9/hook',
  };
}

describe('relayReplyToChannel ⇒ 影子队列的 delivered 事实', () => {
  const shadows: ReplyShadowPayload[] = [];
  const originalGet = channelRegistry.get.bind(channelRegistry);
  const originalPlugin =
    channelBootstrapper.getPluginInstance.bind(channelBootstrapper);

  afterEach(() => {
    setReplyEffectPort(null);
    shadows.length = 0;
    channelRegistry.get = originalGet;
    channelBootstrapper.getPluginInstance = originalPlugin;
  });

  function stubPlugin(outbound: Record<string, unknown>): void {
    channelRegistry.get = (() => ({ sendMessage: async () => false })) as never;
    channelBootstrapper.getPluginInstance = (() => ({ outbound })) as never;
  }

  it('outbound 返回 success=false（不抛错）⇒ 影子记 realDelivered=false', async () => {
    stubPlugin({ sendText: async () => ({ success: false, error: 'boom' }) });
    setReplyEffectPort({
      shadow: async (input) => {
        shadows.push(input);
      },
    });

    const ok = await relayReplyToChannel(inboxItem());

    expect(ok).toBe(false);
    expect(shadows).toHaveLength(1);
    expect(shadows[0]).toMatchObject({
      inboxItemId: 'inbox-shadow-1',
      channelId: 'webhook',
      delivered: false,
    });
  });

  it('outbound 返回 success=true ⇒ 影子记 realDelivered=true', async () => {
    stubPlugin({ sendText: async () => ({ success: true }) });
    setReplyEffectPort({
      shadow: async (input) => {
        shadows.push(input);
      },
    });

    const ok = await relayReplyToChannel(inboxItem());

    expect(ok).toBe(true);
    expect(shadows).toHaveLength(1);
    expect(shadows[0].delivered).toBe(true);
  });

  it('sendInteractive 报 false ⇒ 继续降级到 sendText 成功（不误判失败）', async () => {
    const calls: string[] = [];
    stubPlugin({
      sendInteractive: async () => {
        calls.push('interactive');
        return { success: false };
      },
      sendText: async () => {
        calls.push('text');
        return { success: true };
      },
    });
    setReplyEffectPort({
      shadow: async (input) => {
        shadows.push(input);
      },
    });

    const ok = await relayReplyToChannel(inboxItem());

    expect(calls).toEqual(['interactive', 'text']);
    expect(ok).toBe(true);
    expect(shadows[0].delivered).toBe(true);
  });
});
