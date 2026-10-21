/**
 * MobileChannel（P2.5，2026-10-20）
 *
 * 定位：移动端 = PC 的**辅助接入入口**（thin client），不执行工具。
 * 本测试锁住：
 *   ① 能力声明：`interactive=true`（卡片出站；入站按钮走统一端点）、非 webhook 通道；
 *   ② 目录登记：`CHANNEL_CATALOG` 有条目、`exportKey` 与真实导出一致、默认不启用；
 *   ③ 出站：结构化载荷（不拼裸字符串）且**失败不伪成功**；
 *   ④ 入站上下文：只做字段搬运（channelId/senderId/conversationId）。
 */

import { afterEach, describe, expect, it } from 'bun:test';
import {
  buildMobileMessageContext,
  getMobileOutboundSink,
  mobileChannelPlugin,
  parseMobileInboundBody,
  setMobileOutboundSink,
  MOBILE_MAX_TEXT_LENGTH,
  type MobileOutboundPayload,
} from '../../src/channels/mobile/MobileChannel';
import {
  getChannelCatalogEntry,
  CHANNEL_CATALOG,
} from '../../src/channels/ChannelCatalog';
import { KNOWN_CHANNEL_IDS } from '../../src/channels/types/IChannel';

afterEach(() => {
  setMobileOutboundSink(null);
});

describe('MobileChannel：能力与目录登记', () => {
  it('能力声明：卡片出站（interactive=true），非 webhook 通道', () => {
    expect(mobileChannelPlugin.id).toBe('mobile');
    expect(mobileChannelPlugin.meta.markdownCapable).toBe(true);
    expect(mobileChannelPlugin.capabilities.interactive).toBe(true);
    expect(mobileChannelPlugin.capabilities.webhook).toBe(false);
    expect(mobileChannelPlugin.capabilities.directMessage).toBe(true);
  });

  it('目录登记：exportKey 与真实导出一致；默认不自动启用', async () => {
    const entry = getChannelCatalogEntry('mobile');
    expect(entry).toBeDefined();
    expect(entry!.exportKey).toBe('mobileChannelPlugin');
    expect(entry!.credentials).toEqual(['LIRI_MOBILE_CHANNEL']);

    // 默认（未设 LIRI_MOBILE_CHANNEL）⇒ 不启用，避免挤占 CHANNEL_MAX_COUNT
    expect(entry!.isEnabled(() => undefined)).toBe(false);
    expect(
      entry!.isEnabled((k) =>
        k === 'LIRI_MOBILE_CHANNEL' ? 'true' : undefined
      )
    ).toBe(true);

    const mod = await entry!.load();
    expect((mod as Record<string, unknown>)[entry!.exportKey]).toBe(
      mobileChannelPlugin
    );
  });

  it('KNOWN_CHANNEL_IDS 已收录 mobile', () => {
    expect(KNOWN_CHANNEL_IDS).toContain('mobile');
    expect(CHANNEL_CATALOG.some((e) => e.type === 'mobile')).toBe(true);
  });
});

describe('MobileChannel：出站载荷', () => {
  it('sendText ⇒ 结构化载荷（event/conversationId/kind/content/createdAt）', async () => {
    const captured: MobileOutboundPayload[] = [];
    setMobileOutboundSink((payload) => {
      captured.push(payload);
    });

    const result = await mobileChannelPlugin.outbound.sendText(
      'conv-1',
      'hello'
    );

    expect(result.success).toBe(true);
    expect(captured).toHaveLength(1);
    expect(captured[0]!.event).toBe('mobile:message');
    expect(captured[0]!.conversationId).toBe('conv-1');
    expect(captured[0]!.kind).toBe('text');
    expect(captured[0]!.content).toBe('hello');
    expect(typeof captured[0]!.createdAt).toBe('number');
  });

  it('sendMarkdown ⇒ kind=markdown（不降级成 text）', async () => {
    const kinds: string[] = [];
    setMobileOutboundSink((p) => {
      kinds.push(p.kind);
    });
    await mobileChannelPlugin.outbound.sendMarkdown('conv-2', '**hi**');
    expect(kinds).toEqual(['markdown']);
  });

  it('sink 抛错 ⇒ success=false（不伪成功）', async () => {
    setMobileOutboundSink(() => {
      throw new Error('sse down');
    });
    const result = await mobileChannelPlugin.outbound.sendText('conv-3', 'x');
    expect(result.success).toBe(false);
    expect(result.error).toContain('sse down');
  });

  it('sendInteractive ⇒ kind=card 且卡片 JSON **原样**进 SSE data（§2.6 ②）', async () => {
    const captured: MobileOutboundPayload[] = [];
    setMobileOutboundSink((payload) => {
      captured.push(payload);
    });
    const card = {
      title: '今日预算已用完',
      content: '请选择处理方式',
      color: 'yellow' as const,
      buttons: [
        {
          text: '临时提额',
          value: '{"a":"budget-relief","k":"boost"}',
          style: 'primary' as const,
        },
      ],
    };

    const result = await mobileChannelPlugin.outbound.sendInteractive(
      'conv-4',
      card
    );

    expect(result.success).toBe(true);
    expect(captured[0]!.kind).toBe('card');
    // 原样携带：字段与按钮 value 一字不改（前端据此决定打哪个统一端点）
    expect(captured[0]!.card).toEqual(card);
    // 纯文本降级：未升级的前端仍可读
    expect(captured[0]!.content).toBe('今日预算已用完\n请选择处理方式');
  });

  it('非卡片消息不带 card 字段（不凭空造字段）', async () => {
    const captured: MobileOutboundPayload[] = [];
    setMobileOutboundSink((payload) => {
      captured.push(payload);
    });
    await mobileChannelPlugin.outbound.sendText('conv-5', 'plain');
    expect('card' in captured[0]!).toBe(false);
  });

  it('默认 sink 已接线（未注入时仍有可用函数）', () => {
    expect(typeof getMobileOutboundSink()).toBe('function');
  });
});

describe('MobileChannel：入站上下文', () => {
  it('只做字段搬运，不臆造内容', () => {
    const ctx = buildMobileMessageContext({
      deviceId: 'dev-1',
      conversationId: 'conv-9',
      text: 'hi',
      messageId: 'msg-1',
      timestamp: 123,
    });

    expect(ctx.channelId).toBe('mobile');
    expect(ctx.senderId).toBe('dev-1');
    expect(ctx.conversationId).toBe('conv-9');
    expect(ctx.messageId).toBe('msg-1');
    expect(ctx.messageType).toBe('text');
    expect(ctx.content).toBe('hi');
    expect(ctx.timestamp).toBe(123);
    expect(ctx.isDirectMessage).toBe(true);
    expect(ctx.rawPayload['deviceId']).toBe('dev-1');
  });
});

describe('MobileChannel：入站请求体校验（POST /v1/channels/mobile/messages）', () => {
  it('最小合法体：deviceId + text ⇒ conversationId 回落到 deviceId', () => {
    const parsed = parseMobileInboundBody({ deviceId: 'd1', text: '  hi  ' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.deviceId).toBe('d1');
    expect(parsed.value.conversationId).toBe('d1');
    expect(parsed.value.text).toBe('hi');
    expect(parsed.value.messageId).toBeUndefined();
  });

  it('显式 conversationId / messageId 原样保留', () => {
    const parsed = parseMobileInboundBody({
      deviceId: 'd1',
      conversationId: 'c1',
      messageId: 'm1',
      text: 'ok',
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.conversationId).toBe('c1');
    expect(parsed.value.messageId).toBe('m1');
  });

  it('缺 deviceId / 空 text ⇒ 拒绝（fail-closed）', () => {
    expect(parseMobileInboundBody({ text: 'x' })).toEqual({
      ok: false,
      error: 'deviceId is required',
    });
    expect(parseMobileInboundBody({ deviceId: 'd1', text: '   ' })).toEqual({
      ok: false,
      error: 'text is required',
    });
  });

  it('超长文本 ⇒ 拒绝并给出上限', () => {
    const parsed = parseMobileInboundBody({
      deviceId: 'd1',
      text: 'x'.repeat(MOBILE_MAX_TEXT_LENGTH + 1),
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain(String(MOBILE_MAX_TEXT_LENGTH));
  });

  it('非对象 / 数组 ⇒ 拒绝', () => {
    expect(parseMobileInboundBody('nope').ok).toBe(false);
    expect(parseMobileInboundBody(null).ok).toBe(false);
    expect(parseMobileInboundBody(['d1', 'hi']).ok).toBe(false);
  });
});
