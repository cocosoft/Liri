/**
 * G6（2026-11-14）：手机端审批联动的**纯函数 + 推送策略**回归锁。
 *
 * 锁四件事：
 *   ① 卡片按钮载荷可**原样往返**（出站序列化 ⇄ 入站解析，单一真源）；
 *   ② 只给「入站动作已接线」的通道（当前 mobile）推卡片，其余通道零行为；
 *   ③ 发送失败/返回 `{success:false}` ⇒ 降级无按钮文案（不伪成功、不静默）；
 *   ④ 同一 inbox 项只推一次（进程内去重）。
 *
 * 真正的审批落定（`resolveInboxApproval`）不在本文件覆盖 —— 它由 service 侧既有用例与
 * 真机链路兜底，本文件只锁通道侧的解析/推送层。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import {
  APPROVAL_CARD_CHANNELS,
  buildInboxApprovalCard,
  parseInboxApprovalActionData,
  resetInboxApprovalCardForTest,
  sendInboxApprovalCard,
  serializeInboxApprovalAction,
  type InboxApprovalOutbound,
} from '@modules/channels/bridge/inboxApprovalCard';
import { parseMobileApprovalActionBody } from '@modules/channels/mobile/MobileApprovalAction';
import { buildMobileAuditPayload } from '@modules/channels/mobile/MobileAudit';
import {
  mobileChannelPlugin,
  setMobileOutboundSink,
  type MobileOutboundPayload,
} from '@modules/channels/mobile/MobileChannel';
import { channelBootstrapper } from '@modules/channels/bootstrap/ChannelBootstrapper';
import { InboxManager } from '@openliri/service/runtime/InboxManager';
import {
  extractBearerToken,
  isMobileDeviceTokenPath,
  MOBILE_DEVICE_TOKEN_PATH,
} from '@modules/infrastructure/http/LocalHTTPServiceHelpers';

afterEach(() => {
  resetInboxApprovalCardForTest();
});

/** 记录型出站适配器（只记录调用，不做网络） */
function recorder(): {
  outbound: InboxApprovalOutbound;
  calls: Array<{ kind: string; target: string; payload: unknown }>;
} {
  const calls: Array<{ kind: string; target: string; payload: unknown }> = [];
  return {
    calls,
    outbound: {
      sendInteractive: async (target, card) => {
        calls.push({ kind: 'interactive', target, payload: card });
        return { success: true };
      },
      sendMarkdown: async (target, content) => {
        calls.push({ kind: 'markdown', target, payload: content });
        return { success: true };
      },
      sendText: async (target, content) => {
        calls.push({ kind: 'text', target, payload: content });
        return { success: true };
      },
    },
  };
}

describe('G6：按钮载荷单一真源', () => {
  it('卡片两个按钮的 value 可解析回同一动作（往返一致）', () => {
    const card = buildInboxApprovalCard({
      id: 'inbox_1',
      title: '工具审批: bash',
      message: '命令: mkdir demo',
    });

    expect(card.buttons).toHaveLength(2);
    const approve = parseInboxApprovalActionData(card.buttons![0]!.value);
    const deny = parseInboxApprovalActionData(card.buttons![1]!.value);

    expect(approve).toEqual({
      a: 'inbox-approval',
      i: 'inbox_1',
      d: 'approve',
    });
    expect(deny).toEqual({ a: 'inbox-approval', i: 'inbox_1', d: 'deny' });
    expect(card.buttons![0]!.text).toBe('同意');
    expect(card.buttons![1]!.text).toBe('拒绝');
    // 内容缺失时用标题兜底（不产生空卡片）
    expect(buildInboxApprovalCard({ id: 'x', title: '仅标题' }).content).toBe(
      '仅标题'
    );
  });

  it('非本动作 / 字段缺失 / 值域非法 ⇒ null（不猜）', () => {
    expect(parseInboxApprovalActionData('not-json')).toBeNull();
    expect(
      parseInboxApprovalActionData('{"a":"budget-relief","k":"boost"}')
    ).toBeNull();
    expect(
      parseInboxApprovalActionData(
        serializeInboxApprovalAction({
          a: 'inbox-approval',
          i: '',
          d: 'approve',
        })
      )
    ).toBeNull();
    expect(
      parseInboxApprovalActionData('{"a":"inbox-approval","i":"x","d":"ok"}')
    ).toBeNull();
    expect(parseInboxApprovalActionData(undefined)).toBeNull();
  });
});

describe('G6：移动端入站动作解析', () => {
  it('无 action 字段 ⇒ null（文本入站路径零变更）', () => {
    expect(
      parseMobileApprovalActionBody({ deviceId: 'd1', text: '同意' })
    ).toBeNull();
    expect(parseMobileApprovalActionBody('nope')).toBeNull();
  });

  it('action 形态：缺 deviceId / 载荷非法 ⇒ ok:false', () => {
    expect(
      parseMobileApprovalActionBody({
        action: serializeInboxApprovalAction({
          a: 'inbox-approval',
          i: 'i1',
          d: 'approve',
        }),
      })
    ).toEqual({ ok: false, error: 'deviceId is required' });

    expect(
      parseMobileApprovalActionBody({ deviceId: 'd1', action: '{"a":"x"}' })
    ).toEqual({ ok: false, error: 'invalid approval action payload' });
  });

  it('action 形态合法 ⇒ 解析出 deviceId + 动作', () => {
    const parsed = parseMobileApprovalActionBody({
      deviceId: ' d1 ',
      action: serializeInboxApprovalAction({
        a: 'inbox-approval',
        i: 'i1',
        d: 'deny',
      }),
    });
    expect(parsed).toEqual({
      ok: true,
      value: {
        deviceId: 'd1',
        action: { a: 'inbox-approval', i: 'i1', d: 'deny' },
      },
    });
  });
});

describe('G6：审批请求卡片推送策略', () => {
  it('白名单只含已接线入站动作的通道（当前 mobile）', () => {
    expect([...APPROVAL_CARD_CHANNELS]).toEqual(['mobile']);
  });

  it('非白名单通道 / 缺渠道 ⇒ 不发送', async () => {
    const { outbound, calls } = recorder();
    const resolveOutbound = () => outbound;

    expect(
      await sendInboxApprovalCard({
        item: {
          id: 'i-feishu',
          title: 't',
          channelId: 'feishu',
          channelConversationId: 'c1',
        },
        resolveOutbound,
      })
    ).toBe(false);
    expect(
      await sendInboxApprovalCard({
        item: { id: 'i-none', title: 't' },
        resolveOutbound,
      })
    ).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('mobile ⇒ 发到 conversationId 的交互卡片；重复调用只发一次', async () => {
    const { outbound, calls } = recorder();
    const item = {
      id: 'i-mobile-1',
      title: '工具审批: bash',
      message: '命令: mkdir demo',
      channelId: 'mobile',
      channelConversationId: 'conv-9',
    };

    expect(
      await sendInboxApprovalCard({ item, resolveOutbound: () => outbound })
    ).toBe(true);
    expect(
      await sendInboxApprovalCard({ item, resolveOutbound: () => outbound })
    ).toBe(false);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.kind).toBe('interactive');
    expect(calls[0]!.target).toBe('conv-9');
    const card = calls[0]!.payload as { buttons: Array<{ text: string }> };
    expect(card.buttons.map((b) => b.text)).toEqual(['同意', '拒绝']);
  });

  it('卡片发送返回 {success:false} ⇒ 降级无按钮文案（不伪成功）', async () => {
    const calls: string[] = [];
    const outbound: InboxApprovalOutbound = {
      sendInteractive: async () => ({ success: false }),
      sendMarkdown: async () => {
        calls.push('markdown');
        return { success: true };
      },
    };

    expect(
      await sendInboxApprovalCard({
        item: {
          id: 'i-fallback',
          title: 't',
          message: 'm',
          channelId: 'mobile',
          channelSessionId: 'cs-1',
        },
        resolveOutbound: () => outbound,
      })
    ).toBe(true);
    expect(calls).toEqual(['markdown']);
  });

  it('卡片发送抛错 ⇒ 降级无按钮文案，并允许下次重试', async () => {
    const calls: string[] = [];
    let interactiveAttempts = 0;
    const outbound: InboxApprovalOutbound = {
      sendInteractive: async () => {
        interactiveAttempts += 1;
        throw new Error('platform rejected card');
      },
      sendText: async () => {
        calls.push('text');
        return { success: true };
      },
    };
    const item = {
      id: 'i-throw',
      title: 't',
      message: 'm',
      channelId: 'mobile',
      channelSessionId: 'cs-2',
    };

    expect(
      await sendInboxApprovalCard({ item, resolveOutbound: () => outbound })
    ).toBe(true);
    expect(calls).toEqual(['text']);

    // 抛错分支已移除去重标记 ⇒ 下一次仍会尝试按钮
    expect(
      await sendInboxApprovalCard({ item, resolveOutbound: () => outbound })
    ).toBe(true);
    expect(interactiveAttempts).toBe(2);
  });
});

describe('G6：待审批项 → 移动端卡片（InboxManager 挂接）', () => {
  it('渠道绑定为 mobile 的审批项提交后推送一次交互卡片', async () => {
    channelBootstrapper.registerPluginChannel(
      'mobile',
      () => mobileChannelPlugin
    );
    await channelBootstrapper.bootstrap({
      channels: [{ type: 'mobile', enabled: true }],
    });

    const captured: MobileOutboundPayload[] = [];
    setMobileOutboundSink((p) => {
      captured.push(p);
    });

    const mgr = new InboxManager(':memory:');
    try {
      const item = await mgr.submit({
        sessionId: 'sess-g6-hook',
        type: 'approval',
        title: '工具审批: bash',
        message: '命令: mkdir demo',
        source: 'test',
        offlineCapable: true,
        channelId: 'mobile',
        channelSessionId: 'cs-mobile-1',
        channelConversationId: 'conv-mobile-1',
      });

      // 挂接是 fire-and-forget（动态 import）⇒ 有界轮询等它落地
      for (let i = 0; i < 100 && captured.length === 0; i++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      const cardPayload = captured.find((p) => p.kind === 'card');
      expect(cardPayload).toBeDefined();
      expect(cardPayload!.conversationId).toBe('conv-mobile-1');
      expect(cardPayload!.card?.buttons).toHaveLength(2);
      expect(
        parseInboxApprovalActionData(cardPayload!.card!.buttons![0]!.value)
      ).toEqual({ a: 'inbox-approval', i: item.id, d: 'approve' });
      expect(
        parseInboxApprovalActionData(cardPayload!.card!.buttons![1]!.value)
      ).toEqual({ a: 'inbox-approval', i: item.id, d: 'deny' });
    } finally {
      mgr.dispose();
      setMobileOutboundSink(null);
      await channelBootstrapper.disposeAll();
    }
  });

  it('无渠道绑定的审批项 ⇒ 不推送（普通会话零行为）', async () => {
    channelBootstrapper.registerPluginChannel(
      'mobile',
      () => mobileChannelPlugin
    );
    await channelBootstrapper.bootstrap({
      channels: [{ type: 'mobile', enabled: true }],
    });

    const captured: MobileOutboundPayload[] = [];
    setMobileOutboundSink((p) => {
      captured.push(p);
    });

    const mgr = new InboxManager(':memory:');
    try {
      await mgr.submit({
        sessionId: 'sess-g6-hook-2',
        type: 'approval',
        title: '工具审批: bash',
        message: 'm',
        source: 'test',
        offlineCapable: true,
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(captured).toHaveLength(0);
    } finally {
      mgr.dispose();
      setMobileOutboundSink(null);
      await channelBootstrapper.disposeAll();
    }
  });
});

describe('G6：设备 token 的传输层受理范围', () => {
  const reqWith = (authorization?: string) =>
    ({ headers: authorization ? { authorization } : {} }) as never;

  it('只对移动端入站路径放行（不扩成全 API 通行证）', () => {
    expect(MOBILE_DEVICE_TOKEN_PATH).toBe('/v1/channels/mobile/messages');
    expect(isMobileDeviceTokenPath('/v1/channels/mobile/messages')).toBe(true);
    expect(isMobileDeviceTokenPath('/v1/channels/mobile/messages/')).toBe(
      false
    );
    expect(isMobileDeviceTokenPath('/v1/channels/mobile/pairing/code')).toBe(
      false
    );
    expect(isMobileDeviceTokenPath('/v1/inbox/x/reply')).toBe(false);
  });

  it('只认 Authorization: Bearer（不猜其它头）', () => {
    expect(extractBearerToken(reqWith('Bearer abc'))).toBe('abc');
    expect(extractBearerToken(reqWith('Bearer  abc  '))).toBe('abc');
    expect(extractBearerToken(reqWith('Token abc'))).toBe('');
    expect(extractBearerToken(reqWith())).toBe('');
  });
});

describe('G6：移动端审批动作审计载荷', () => {
  it('approval_action 映射为 approval_action 类（含 inboxItemId / outcome）', () => {
    const payload = buildMobileAuditPayload({
      kind: 'approval_action',
      deviceId: 'dev-1',
      inboxItemId: 'i1',
      decision: 'approve',
      outcome: 'ok',
      success: true,
    });
    expect(payload.type).toBe('approval_action');
    expect(payload.action).toBe('mobile.approval.approve');
    expect(payload.success).toBe(true);
    expect(payload.details['inboxItemId']).toBe('i1');
    expect(payload.details['outcome']).toBe('ok');
  });

  it('未落定时记为 warning 并保留 outcome 作为失败原因', () => {
    const payload = buildMobileAuditPayload({
      kind: 'approval_action',
      deviceId: 'dev-1',
      inboxItemId: 'i1',
      decision: 'deny',
      outcome: 'already_processed',
      success: false,
    });
    expect(payload.severity).toBe('warning');
    expect(payload.failureReason).toBe('already_processed');
  });
});
