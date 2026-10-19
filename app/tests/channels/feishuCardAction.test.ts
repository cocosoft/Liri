// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// 飞书「卡片回传交互」入站解析单测（Spec `.trae/specs/channel-budget-inline-relief.md`；
// 协议依据 = 飞书官方「卡片回传交互回调」+「旧版回调结构」两篇文档，见模块头注）。
//
// 覆盖：两版回调体识别（v2 / v1 扁平 / 长连接帧）/ **不抢**消息与校验路径 /
// 载荷与 QQ **同源**（同一 `handleBudgetReliefAction` 入口）/ 回执体不带 `card`（保持原卡片）。

import { describe, it, expect, afterEach, vi } from 'bun:test';

import {
  extractFeishuCardAction,
  buildFeishuCardActionResponse,
} from '../../src/channels/feishu/cardActionPayload';
import {
  handleBudgetReliefAction,
  setBudgetReliefActionHandler,
} from '../../src/channels/bridge/budgetReliefAction';
import { serializeBudgetReliefAction } from '../../src/channels/bridge/budgetReliefCard';

const SID = 'c2c_feishu_session_1';

/** 本仓飞书**出站**的按钮载荷形态：`value: { key:'action', value: <序列化载荷> }` */
const outboundValue = () => ({
  key: 'action',
  value: serializeBudgetReliefAction({
    a: 'budget-relief',
    k: 'boost',
    s: SID,
  }),
});

const OM = 'om_574d639e4a44e4dd646eaf628e2';

describe('验收 A：两版回调体都能识别（本仓出站卡片是**旧版结构** ⇒ v1 必认）', () => {
  it('新版 webhook 体（schema 2.0 + header.event_type）⇒ 取 event.action.value 与 open_message_id', () => {
    const hit = extractFeishuCardAction({
      schema: '2.0',
      header: { event_id: 'f7984f2', event_type: 'card.action.trigger' },
      event: {
        operator: { open_id: 'ou_x' },
        action: { ...outboundValue(), tag: 'button' },
        context: { open_message_id: OM, open_chat_id: 'oc_x' },
      },
    });
    expect(hit?.shape).toBe('v2');
    expect(hit?.payload).toBe(outboundValue().value);
    expect(hit?.openMessageId).toBe(OM);
  });

  it('旧版扁平体（无 type/event 包裹）⇒ v1-flat', () => {
    const hit = extractFeishuCardAction({
      open_id: 'ou_sdfimx9948345',
      tenant_key: 'd32004232',
      token: 'c-xxxxx',
      open_message_id: OM,
      action: { ...outboundValue(), tag: 'button' },
    });
    expect(hit?.shape).toBe('v1-flat');
    expect(hit?.payload).toBe(outboundValue().value);
    expect(hit?.openMessageId).toBe(OM);
  });

  it('长连接帧（`data.header.event_type`）⇒ v2-ws', () => {
    const hit = extractFeishuCardAction({
      type: 'event',
      data: {
        schema: '2.0',
        header: { event_type: 'card.action.trigger' },
        event: { action: outboundValue() },
      },
    });
    expect(hit?.shape).toBe('v2-ws');
    expect(hit?.payload).toBe(outboundValue().value);
  });

  it('长连接帧（`data.type` 为事件名形态）⇒ v2-ws（两形都不漏）', () => {
    const hit = extractFeishuCardAction({
      type: 'event',
      data: {
        type: 'card.action.trigger',
        event: { action: outboundValue() },
      },
    });
    expect(hit?.shape).toBe('v2-ws');
    expect(hit?.payload).toBe(outboundValue().value);
  });

  it('`value` 直接是字符串（平台允许）⇒ 原样透传', () => {
    const raw = serializeBudgetReliefAction({
      a: 'budget-relief',
      k: 'unlock-today',
      s: SID,
    });
    const hit = extractFeishuCardAction({
      open_message_id: OM,
      action: { value: raw },
    });
    expect(hit?.payload).toBe(raw);
  });
});

describe('验收 B：**不抢**其它入站体（消息事件 / URL 校验 / 帧内消息）', () => {
  it.each([
    ['URL 校验体', { challenge: 'ajls384kdjx', type: 'url_verification' }],
    [
      '事件订阅体（消息）',
      { type: 'event_callback', event: { message: { message_id: 'om_1' } } },
    ],
    [
      '长连接帧内的消息事件',
      {
        type: 'event',
        data: { type: 'im.message.receive_v1', event: { message: {} } },
      },
    ],
    ['空对象', {}],
    ['null', null],
    ['字符串', 'not-json'],
    ['数组', []],
  ])('%s ⇒ null（走原有消息路径）', (_label, body) => {
    expect(extractFeishuCardAction(body)).toBeNull();
  });

  it('旧版体但缺 `open_message_id`（判别锚点缺失）⇒ null（不误判）', () => {
    expect(extractFeishuCardAction({ action: { value: 'x' } })).toBeNull();
  });

  it('命中卡片体但 `action.value` 缺失 ⇒ null', () => {
    expect(
      extractFeishuCardAction({
        open_message_id: OM,
        action: { tag: 'button' },
      })
    ).toBeNull();
  });
});

describe('验收 C：与 QQ **同源**（同一动作端口，不各平台各写一套放行逻辑）', () => {
  afterEach(() => {
    setBudgetReliefActionHandler(null);
  });

  it('飞书按钮载荷 ⇒ 端口收到 {sessionId, kind}（与 QQ 路径同一入口）', async () => {
    const calls: Array<{ sessionId: string; kind: string }> = [];
    setBudgetReliefActionHandler(async (req) => {
      calls.push(req);
      return { code: 0, message: 'ok' };
    });
    const hit = extractFeishuCardAction({
      open_message_id: OM,
      action: outboundValue(),
    });
    const res = await handleBudgetReliefAction(hit?.payload);
    expect(res.code).toBe(0);
    expect(calls).toEqual([{ sessionId: SID, kind: 'boost' }]);
  });

  it('非本动作的载荷（伪造/他方卡片）⇒ 非零码且**不调用**端口', async () => {
    const handler = vi.fn(async () => ({ code: 0 as const }));
    setBudgetReliefActionHandler(handler);
    const hit = extractFeishuCardAction({
      open_message_id: OM,
      action: { value: JSON.stringify({ a: 'other', s: SID }) },
    });
    const res = await handleBudgetReliefAction(hit?.payload);
    expect(handler).not.toHaveBeenCalled();
    expect(res.code).not.toBe(0);
  });

  it('`value` 为无内层字符串的对象 ⇒ 仍透传（交统一入口判定，宁拒不猜）', () => {
    const hit = extractFeishuCardAction({
      open_message_id: OM,
      action: { value: { foo: 'bar' } },
    });
    expect(hit?.payload).toBe(JSON.stringify({ foo: 'bar' }));
  });
});

describe('验收 D：回调响应体（文档：`{toast}`；**不带** `card` ⇒ 保持原卡片）', () => {
  it('成功 ⇒ success toast 含「已放行」', () => {
    const body = buildFeishuCardActionResponse({ code: 0 });
    expect(body.toast.type).toBe('success');
    expect(body.toast.content).toContain('已放行');
    expect(Object.keys(body)).toEqual(['toast']); // 不带 card ⇒ 不改卡片
  });

  it('失败 ⇒ 如实报「未放行」+ 端口给出的原因（不假装成功）', () => {
    const body = buildFeishuCardActionResponse({
      code: 1,
      message: '该会话未处于挂起态',
    });
    expect(body.toast.content).toContain('未放行');
    expect(body.toast.content).toContain('该会话未处于挂起态');
  });
});
