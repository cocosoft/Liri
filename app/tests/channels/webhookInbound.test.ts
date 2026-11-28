// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * Webhook 渠道**入站**（2026-11-28，台账 L15880 根因修复）
 *
 * 背景：插件 `onConnect` 此前委托进程级 `webhookChannel` 单例 —— 它是
 * `new WebhookChannel()`（`enabled: false`）的空壳 ⇒ 渠道启用后监听**永不启动**，
 * 且插件没有 `createInboundAdapter` ⇒ 入站消息根本进不了路由。
 *
 * 本组用**真实 HTTP**（起真服务、发真请求）钉住修复后的语义：
 *  ① 启用（`lifecycle.connect`）后入站监听真的起来，合法 POST 能进 messageHandler；
 *  ② secret 不符 ⇒ 401，且 handler 不被调用；
 *  ③ 非法 JSON ⇒ 400；非 POST ⇒ 405；错误路径 ⇒ 404；
 *  ④ 同一时间戳 + 同一 body 重放 ⇒ 409（复用 `verifyWebhookRequest` 的防重放缓存）；
 *  ⑤ `disconnect` 真的关掉监听（同端口可再次绑定）；
 *  ⑥ payload 映射：正文/发送者取自 payload，`reply_url` 成为回投目标（conversationId）。
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import http from 'http';
import type { AddressInfo } from 'net';
import type { MessageContext } from '@modules/channels/types';
import { createWebhookChannel } from '@modules/channels/webhook/WebhookChannel';

const SECRET = 'whsec_inbound_test';

/** 取一个当前空闲的端口（先绑 0 再关，立即交给插件复用） */
async function freePort(): Promise<number> {
  const probe = http.createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

/** 渠道插件的入站适配器（默认实现必然存在；这里显式判空以满足可选类型） */
function inboundOf() {
  const inbound = plugin.inbound;
  if (!inbound) throw new Error('webhook 渠道缺少入站适配器');
  return inbound;
}

let port = 0;
let base = '';
const plugin = createWebhookChannel();
const received: MessageContext[] = [];

beforeAll(async () => {
  port = await freePort();
  base = `http://127.0.0.1:${port}`;
  inboundOf().setMessageHandler(async (message) => {
    received.push(message);
  });
  await plugin.lifecycle.connect({
    listenPort: port,
    listenHost: '127.0.0.1',
    path: '/hook',
    secret: SECRET,
    endpoints: [],
  });
});

afterAll(async () => {
  await plugin.lifecycle.disconnect();
});

/** 发一次入站请求（默认带正确 secret） */
function post(
  body: string,
  options?: {
    secret?: string | null;
    path?: string;
    method?: string;
    ts?: string;
  }
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const secret = options?.secret === undefined ? SECRET : options.secret;
  if (secret) headers['X-Webhook-Token'] = secret;
  if (options?.ts) headers['X-Webhook-Timestamp'] = options.ts;
  return fetch(`${base}${options?.path ?? '/hook'}`, {
    method: options?.method ?? 'POST',
    headers,
    ...(options?.method === 'GET' ? {} : { body }),
  });
}

describe('WebhookChannel 入站（真实 HTTP）', () => {
  it('① 启用后监听启动，合法 POST 进入 messageHandler', async () => {
    expect(inboundOf().isListening).toBe(true);
    received.length = 0;

    const payload = {
      text: '构建失败：pytest 3 failed',
      sender: 'ci-bot',
      reply_url: `${base}/reply`,
    };
    const res = await post(JSON.stringify(payload));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; messageId: string };
    expect(body.success).toBe(true);
    expect(body.messageId).toBeTruthy();

    // 先回执再异步分发 ⇒ 轮询等待（不用 sleep 固定值）
    for (let i = 0; i < 50 && received.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(received).toHaveLength(1);
    const ctx = received[0]!;
    expect(ctx.channelId).toBe('webhook');
    expect(ctx.content).toBe('构建失败：pytest 3 failed');
    expect(ctx.senderId).toBe('ci-bot');
    // ⑥ reply_url 成为回投目标（出站 target = conversationId ?? senderId）
    expect(ctx.conversationId).toBe(`${base}/reply`);
    expect(ctx.rawPayload).toMatchObject({ sender: 'ci-bot' });
  });

  it('② secret 不符 ⇒ 401，且 handler 不被调用', async () => {
    received.length = 0;
    const res = await post(JSON.stringify({ text: 'x' }), {
      secret: 'wrong-secret',
    });
    expect(res.status).toBe(401);
    await new Promise((r) => setTimeout(r, 50));
    expect(received).toHaveLength(0);
  });

  it('③ 非法 JSON ⇒ 400；非 POST ⇒ 405；错误路径 ⇒ 404', async () => {
    expect((await post('{not-json')).status).toBe(400);
    expect((await post('', { method: 'GET' })).status).toBe(405);
    expect(
      (await post(JSON.stringify({ text: 'x' }), { path: '/other' })).status
    ).toBe(404);
  });

  it('④ 同时间戳 + 同 body 重放 ⇒ 409', async () => {
    const ts = String(Date.now());
    const body = JSON.stringify({ text: 'replay-once' });
    expect((await post(body, { ts })).status).toBe(200);
    expect((await post(body, { ts })).status).toBe(409);
  });

  it('⑤ disconnect 后监听真的关闭（同端口可再次绑定）', async () => {
    await plugin.lifecycle.disconnect();
    expect(inboundOf().isListening).toBe(false);

    // 端口已释放：能再次起一个监听即证明关掉了（失败会抛 EADDRINUSE）
    const probe = http.createServer();
    await new Promise<void>((resolve, reject) => {
      probe.once('error', reject);
      probe.listen(port, '127.0.0.1', () => resolve());
    });
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    // 复原（后续用例/afterAll 仍按"已连接"语义清理）
    await plugin.lifecycle.connect({
      listenPort: port,
      listenHost: '127.0.0.1',
      path: '/hook',
      secret: SECRET,
      endpoints: [],
    });
  });
});
