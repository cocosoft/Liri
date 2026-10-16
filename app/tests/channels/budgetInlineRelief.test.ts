// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// 通道「就地放行」单测（Spec `.trae/specs/channel-budget-inline-relief.md` §4 验收 1–7）。
//
// 覆盖：两态文案不混 / 卡片与载荷**同源自洽** / 载荷解析**不猜** / 动作端口（未注册·抛错·非法均不静默）/
// QQ keyboard 协议形状 / QQ 意图含 INTERACTION / 出站降级链（含"带按钮失败 ⇒ 无按钮文案"）。

import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';

import {
  buildBudgetReliefCard,
  sendBudgetReliefCard,
  resetBudgetReliefCardForTest,
  serializeBudgetReliefAction,
  BUTTON_CAPABLE_CHANNELS,
} from '../../src/channels/bridge/budgetReliefCard';
import {
  handleBudgetReliefAction,
  parseBudgetReliefActionData,
  setBudgetReliefActionHandler,
  hasBudgetReliefActionHandler,
} from '../../src/channels/bridge/budgetReliefAction';
import {
  buildBudgetSuspendedNotice,
  resolveLlmFailure,
} from '../../src/channels/routing/messageRouterContract';
import { buildQQKeyboard } from '../../src/channels/qq/keyboard';
import { QQ_INTENT_FULL, QQEventType } from '../../src/channels/qq/types';

const SID = 'session_channel_relief_1';

describe('验收 1：通道侧两态文案（发送被拦 vs 运行中被挂起）', () => {
  it('挂起态：说明"进度已保存 + 自动续跑 + 无需重发"，且**不得**要求重发', () => {
    const withButtons = buildBudgetSuspendedNotice({ hasButtons: true });
    expect(withButtons).toContain('进度已保存');
    expect(withButtons).toContain('自动从这里续跑');
    expect(withButtons).toContain('无需重发消息');
    expect(withButtons).not.toContain('重发本条消息'); // 与"被拦"态的关键区分
    expect(withButtons).toContain('点下方');
  });

  it('无按钮时**不得**谎称可点按钮（必须指出桌面端出路）', () => {
    const noButtons = buildBudgetSuspendedNotice({ hasButtons: false });
    expect(noButtons).not.toContain('点下方');
    expect(noButtons).toContain('用量中心 → 日限额');
    expect(noButtons).toContain('无需重发消息');
  });

  it('撞限态（发送被拦）文案保持"重发"语义 ⇒ 两态不混', () => {
    const blocked = resolveLlmFailure('DAILY_BUDGET_EXCEEDED').outbound;
    expect(blocked).toContain('重发本条消息');
    expect(blocked).not.toContain('无需重发消息');
  });
});

describe('验收 2：卡片与按钮载荷**同源自洽**（写出即可被读入还原）', () => {
  it('两个按钮（临时提额 / 今日解除）；`value` 能被解析回 {sessionId, kind}', () => {
    const card = buildBudgetReliefCard({ sessionId: SID, text: '文案' });
    expect(card.buttons?.map((b) => b.text)).toEqual(['临时提额', '今日解除']);
    const kinds = card.buttons!.map(
      (b) => parseBudgetReliefActionData(b.value)?.kind
    );
    expect(kinds).toEqual(['boost', 'unlock-today']);
    for (const b of card.buttons!) {
      expect(parseBudgetReliefActionData(b.value)?.sessionId).toBe(SID);
    }
  });

  it('序列化真源：手工构造的载荷同样可解析（`a==="budget-relief"` 单一约定）', () => {
    const raw = serializeBudgetReliefAction({
      a: 'budget-relief',
      k: 'boost',
      s: 'x',
    });
    expect(parseBudgetReliefActionData(raw)).toEqual({
      sessionId: 'x',
      kind: 'boost',
    });
  });
});

describe('验收 5：载荷解析**不猜**（非法一律 null）', () => {
  it.each([
    ['空串', ''],
    ['非 JSON', 'not-json'],
    ['非字符串', 123],
    ['null', null],
    ['动作标识不符', JSON.stringify({ a: 'other', k: 'boost', s: 'x' })],
    [
      'kind 越界',
      JSON.stringify({ a: 'budget-relief', k: 'give-me-all', s: 'x' }),
    ],
    ['缺 sessionId', JSON.stringify({ a: 'budget-relief', k: 'boost' })],
    [
      '空 sessionId',
      JSON.stringify({ a: 'budget-relief', k: 'boost', s: '  ' }),
    ],
  ])('%s ⇒ null', (_label, raw) => {
    expect(parseBudgetReliefActionData(raw)).toBeNull();
  });
});

describe('验收 4/6/7：动作端口（未注册·抛错·非法均**不静默**）', () => {
  afterEach(() => {
    setBudgetReliefActionHandler(null);
  });

  it('未注册端口 ⇒ 回非零码（不假装成功），且**不**抛错', async () => {
    setBudgetReliefActionHandler(null);
    expect(hasBudgetReliefActionHandler()).toBe(false);
    const res = await handleBudgetReliefAction(
      serializeBudgetReliefAction({ a: 'budget-relief', k: 'boost', s: SID })
    );
    expect(res.code).not.toBe(0);
  });

  it('已注册 ⇒ 透传 {sessionId, kind} 并回传端口结果', async () => {
    const calls: Array<{ sessionId: string; kind: string }> = [];
    setBudgetReliefActionHandler(async (req) => {
      calls.push(req);
      return { code: 0, message: 'ok' };
    });
    const res = await handleBudgetReliefAction(
      serializeBudgetReliefAction({
        a: 'budget-relief',
        k: 'unlock-today',
        s: SID,
      })
    );
    expect(res.code).toBe(0);
    expect(calls).toEqual([{ sessionId: SID, kind: 'unlock-today' }]);
  });

  it('端口抛错 ⇒ 回非零码（永不抛）', async () => {
    setBudgetReliefActionHandler(async () => {
      throw new Error('boom');
    });
    const res = await handleBudgetReliefAction(
      serializeBudgetReliefAction({ a: 'budget-relief', k: 'boost', s: SID })
    );
    expect(res.code).not.toBe(0);
  });

  it('非法载荷 ⇒ **不调用**端口（负向：伪造数据不得触发放行），但仍返回结果码', async () => {
    const handler = vi.fn(async () => ({ code: 0 as const }));
    setBudgetReliefActionHandler(handler);
    const res = await handleBudgetReliefAction(
      JSON.stringify({ a: 'something-else', s: SID })
    );
    expect(handler).not.toHaveBeenCalled();
    expect(res.code).not.toBe(0);
  });
});

describe('验收 3（QQ 协议）：keyboard 形状与意图位', () => {
  it('按钮翻成 rows[].buttons[]，回调型 + 所有人可点 + data 原样带上', () => {
    const card = buildBudgetReliefCard({ sessionId: SID, text: '文案' });
    const kb = buildQQKeyboard(card);
    expect(kb).not.toBeNull();
    const buttons = kb!.content.rows[0]!.buttons;
    expect(buttons).toHaveLength(2);
    expect(buttons[0]!.action.type).toBe(1); // 回调按钮
    expect(buttons[0]!.action.permission.type).toBe(2); // 所有人
    expect(buttons[0]!.action.data).toBe(card.buttons![0]!.value);
    expect(buttons[0]!.render_data.label).toBe('临时提额');
    expect(buttons[0]!.render_data.style).toBe(1); // primary ⇒ 蓝色线框
  });

  it('无按钮卡片 ⇒ null（调用方不带 keyboard 字段，零回归）', () => {
    expect(buildQQKeyboard({ title: 't', content: 'c' })).toBeNull();
  });

  it('意图必须含 INTERACTION(1<<26)：否则**收不到按钮点击**（负向自证）', () => {
    expect(QQ_INTENT_FULL & (1 << 26)).toBe(1 << 26);
    expect(QQEventType.INTERACTION_CREATE).toBe('INTERACTION_CREATE');
  });
});

describe('验收 3（出站降级链）：失败不静默、文案随实际路径', () => {
  beforeEach(() => {
    resetBudgetReliefCardForTest();
  });

  it('有 sendInteractive ⇒ 走卡片（含按钮）', async () => {
    const interactive = vi.fn(async () => ({}));
    const ok = await sendBudgetReliefCard({
      channelName: 'qq',
      target: 'c2c:u1',
      sessionId: SID,
      resolveOutbound: () => ({ sendInteractive: interactive }),
    });
    expect(ok).toBe(true);
    expect(interactive).toHaveBeenCalledTimes(1);
    const card = interactive.mock.calls[0]![1] as {
      buttons?: unknown[];
      content: string;
    };
    expect(card.buttons).toHaveLength(2);
    expect(card.content).toContain('点下方');
  });

  it('sendInteractive 抛错（如未开通自定义按钮）⇒ 降级 Markdown，且文案换成**无按钮**版', async () => {
    const markdown = vi.fn(async () => ({}));
    const ok = await sendBudgetReliefCard({
      channelName: 'qq',
      target: 'c2c:u1',
      sessionId: SID,
      resolveOutbound: () => ({
        sendInteractive: async () => {
          throw new Error('keyboard not allowed');
        },
        sendMarkdown: markdown,
      }),
    });
    expect(ok).toBe(true);
    expect(markdown).toHaveBeenCalledTimes(1);
    const text = String(markdown.mock.calls[0]![1]);
    expect(text).not.toContain('点下方'); // 降级后不得谎称可点
    expect(text).toContain('用量中心 → 日限额');
  });

  it('无任何可用出站 ⇒ 返回 false（不谎报成功）', async () => {
    const ok = await sendBudgetReliefCard({
      channelName: 'qq',
      target: 'c2c:u1',
      sessionId: SID,
      resolveOutbound: () => ({}),
    });
    expect(ok).toBe(false);
  });

  it('同一会话重复调用 ⇒ 只发一次（去重）', async () => {
    const interactive = vi.fn(async () => ({}));
    const args = {
      channelName: 'qq',
      target: 'c2c:u1',
      sessionId: SID,
      resolveOutbound: () => ({ sendInteractive: interactive }),
    };
    expect(await sendBudgetReliefCard(args)).toBe(true);
    expect(await sendBudgetReliefCard(args)).toBe(false);
    expect(interactive).toHaveBeenCalledTimes(1);
  });
});

/**
 * Spec §2 D2 **风险项**的守卫（2026-10-17，本片自查发现的**本片引入**隐患）：
 * 实现 `sendInteractive` 的通道有 12 个，但**入站按钮回调目前只有 QQ** ⇒ 对「出站能发、入站没接」
 * 的通道给按钮，用户点了**毫无反应**（**比没有按钮更糟**）。故按**白名单**决定是否给按钮。
 */
describe('D2 风险项：入站回调未接线的通道**不得**给按钮（防「假按钮」）', () => {
  beforeEach(() => {
    resetBudgetReliefCardForTest();
  });

  it('飞书（出站有 sendInteractive 但入站未接线）⇒ 只发**无按钮**文案，绝不调 sendInteractive', async () => {
    const interactive = vi.fn(async () => ({}));
    const markdown = vi.fn(async () => ({}));
    const ok = await sendBudgetReliefCard({
      channelName: 'feishu',
      target: 'ou_xxx',
      sessionId: 'session_feishu_1',
      resolveOutbound: () => ({
        sendInteractive: interactive,
        sendMarkdown: markdown,
      }),
    });
    expect(ok).toBe(true);
    expect(interactive).not.toHaveBeenCalled(); // ★ 核心负向：不得给「点了没反应」的按钮
    expect(markdown).toHaveBeenCalledTimes(1);
    const text = String(markdown.mock.calls[0]![1]);
    expect(text).not.toContain('点下方');
    expect(text).toContain('用量中心 → 日限额');
  });

  it('白名单只含**入站回调已接线**的通道（当前 = qq）；新增通道须**同时**接完出站与入站', () => {
    expect(BUTTON_CAPABLE_CHANNELS.has('qq')).toBe(true);
    expect(BUTTON_CAPABLE_CHANNELS.has('feishu')).toBe(false);
  });
});
