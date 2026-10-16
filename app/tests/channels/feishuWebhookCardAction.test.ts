// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// 飞书 Webhook **HTTP 边界**集成测试（Spec `.trae/specs/channel-budget-inline-relief.md` §2 D3 / §4 验收 9–10）。
//
// 为什么需要它（而不是只用纯函数单测）：台账里「**webhook 侧先分流卡片回传、3 秒内回 HTTP 200 + `{toast}`**」
// 这句话是**传输层契约**——纯函数测不到分支顺序、状态码与响应体。故此处真起一个 HTTP 服务并**真发 POST**。
//
// 边界与纪律：
// - 只对 `tenant_access_token` 调用做桩（`onConnect` 会取 token；不触网）；`afterAll` **还原**
//   `globalThis.fetch`（本仓台账 `L-23-test-global-pollution` 的教训：污染未还原 ⇒ 隔离绿 / 全量红）。
// - `afterAll` 必须 `inbound.stop()`（关掉 HTTP 服务）否则测试进程不退出。

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'bun:test';

import { createFeishuChannel } from '../../src/channels/feishu/FeishuChannel';
import { setBudgetReliefActionHandler } from '../../src/channels/bridge/budgetReliefAction';
import { serializeBudgetReliefAction } from '../../src/channels/bridge/budgetReliefCard';

/** 固定高位端口（本仓既有测试惯例：`acpContract` / `voice-e2e` 亦起真实端口） */
const WEBHOOK_PORT = 18089;
const WEBHOOK_URL = `http://127.0.0.1:${WEBHOOK_PORT}/`;
const SID = 'c2c_feishu_webhook_1';

const realFetch = globalThis.fetch;
let plugin: ReturnType<typeof createFeishuChannel>;

/** 本仓飞书出站按钮的载荷形态 */
const outboundValue = () => ({
  key: 'action',
  value: serializeBudgetReliefAction({
    a: 'budget-relief',
    k: 'boost',
    s: SID,
  }),
});

async function post(body: unknown): Promise<{ status: number; json: unknown }> {
  const resp = await realFetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: resp.status, json: await resp.json() };
}

beforeAll(async () => {
  // 仅桩 token 接口（`onConnect` → `refreshAccessToken`），其余请求原样放行
  globalThis.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    if (String(input).includes('/auth/v3/tenant_access_token/internal')) {
      return new Response(
        JSON.stringify({
          code: 0,
          tenant_access_token: 't-test',
          expire: 7200,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return realFetch(input, init);
  }) as typeof fetch;

  plugin = createFeishuChannel();
  await plugin.lifecycle.connect({
    appId: 'cli_test',
    appSecret: 's-test',
    verifyToken: '',
    webhookPort: WEBHOOK_PORT,
    useWebSocket: false,
  });
  // `IChannelPlugin.inbound` 类型上可选（未创建入站能力时为 undefined）⇒ 显式断言，不静默跳过
  const inbound = plugin.inbound;
  if (!inbound) throw new Error('飞书入站适配器未创建（webhook 模式应当存在）');
  await inbound.start({});
});

afterAll(async () => {
  await plugin.inbound?.stop();
  await plugin.lifecycle.disconnect();
  globalThis.fetch = realFetch;
});

afterEach(() => {
  setBudgetReliefActionHandler(null);
});

describe('飞书 Webhook 卡片回传（真实 HTTP）', () => {
  it('旧版扁平体（本仓出站卡片结构）⇒ 200 + `{toast}` + **动作端口被调用**', async () => {
    const calls: Array<{ sessionId: string; kind: string }> = [];
    setBudgetReliefActionHandler(async (req) => {
      calls.push(req);
      return { code: 0 };
    });

    const { status, json } = await post({
      open_id: 'ou_x',
      tenant_key: 'd32',
      token: 'c-xxx',
      open_message_id: 'om_1',
      action: { ...outboundValue(), tag: 'button' },
    });

    expect(status).toBe(200); // 文档：必须 200（禁 3xx）
    expect(calls).toEqual([{ sessionId: SID, kind: 'boost' }]); // ★ 真·就地放行的接线凭据
    const body = json as { toast?: { type: string; content: string } };
    expect(body.toast?.type).toBe('info');
    expect(body.toast?.content).toContain('已放行');
    expect(Object.keys(body)).toEqual(['toast']); // 不回 card ⇒ 保持原卡片
  });

  it('新版体（schema 2.0）⇒ 同样分流并回 `{toast}`', async () => {
    const calls: string[] = [];
    setBudgetReliefActionHandler(async (req) => {
      calls.push(req.sessionId);
      return { code: 0 };
    });

    const { status, json } = await post({
      schema: '2.0',
      header: { event_id: 'e1', event_type: 'card.action.trigger' },
      event: {
        action: outboundValue(),
        context: { open_message_id: 'om_2' },
      },
    });

    expect(status).toBe(200);
    expect(calls).toEqual([SID]);
    expect((json as { toast: { content: string } }).toast.content).toContain(
      '已放行'
    );
  });

  it('动作端口**未注册** ⇒ 仍回 200 + 「未放行」toast（网关绝不被晾住，守 CS03）', async () => {
    setBudgetReliefActionHandler(null);
    const { status, json } = await post({
      open_message_id: 'om_3',
      action: { ...outboundValue(), tag: 'button' },
    });
    expect(status).toBe(200);
    expect((json as { toast: { content: string } }).toast.content).toContain(
      '未放行'
    );
  });

  it('URL 验证体 ⇒ 原样回显 `challenge`（原有行为不回归）', async () => {
    const { status, json } = await post({
      challenge: 'ajls384kdjx',
      type: 'url_verification',
    });
    expect(status).toBe(200);
    expect(json).toEqual({ challenge: 'ajls384kdjx' });
  });

  it('消息事件体 ⇒ 走原消息路径（200 `{}`），**不**误当卡片回传', async () => {
    let portCalled = false;
    setBudgetReliefActionHandler(async () => {
      portCalled = true;
      return { code: 0 };
    });
    const { status, json } = await post({
      type: 'event_callback',
      event: { message: { message_id: 'om_msg_1' } },
    });
    expect(status).toBe(200);
    expect(json).toEqual({});
    expect(portCalled).toBe(false);
  });
});
