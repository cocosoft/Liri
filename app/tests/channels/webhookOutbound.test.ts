// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P38 观察期（2026-11-10）：webhook 渠道的**真实 outbound**。
 *
 * 背景：`WebhookChannel.sendMessage` 此前只 `emit` 一个事件就返回 `true`（从未真正发请求），
 * 插件层又无条件 `{success:true}` ⇒ 该渠道的 `delivered` 恒真、reply 影子差异率无法观测。
 * 现按 target 真实 POST，并让插件如实回传 `SendResult`。
 */
import { afterAll, describe, expect, it } from 'bun:test';
import http from 'http';
import type { AddressInfo } from 'net';
import {
  WebhookChannel,
  createWebhookChannel,
  webhookChannel,
} from '@modules/channels/webhook/WebhookChannel';

interface Received {
  url: string;
  contentType: string | undefined;
  body: string;
}

const received: Received[] = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk: Buffer) => {
    body += chunk.toString();
  });
  req.on('end', () => {
    received.push({
      url: req.url ?? '',
      contentType: req.headers['content-type'],
      body,
    });
    if (req.url === '/ok') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
      return;
    }
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('boom');
  });
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as AddressInfo).port;
const base = `http://127.0.0.1:${port}`;

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** 单次尝试、短超时：失败用例不必等默认 3 次退避 */
function channel(): WebhookChannel {
  return new WebhookChannel({ maxRetries: 1, timeout: 1000 });
}

describe('WebhookChannel.sendMessage — 真实 POST', () => {
  it('2xx ⇒ true，且服务端收到 JSON 正文', async () => {
    received.length = 0;
    const ok = await channel().sendMessage(`${base}/ok`, '审批结果：已批准');
    expect(ok).toBe(true);
    expect(received).toHaveLength(1);
    expect(received[0].contentType).toContain('application/json');
    const payload = JSON.parse(received[0].body) as Record<string, unknown>;
    expect(payload.text).toBe('审批结果：已批准');
    expect(payload.source).toBe('Liri');
    expect(typeof payload.timestamp).toBe('number');
  });

  it('非 2xx ⇒ false（不再谎报投递成功）', async () => {
    received.length = 0;
    expect(await channel().sendMessage(`${base}/fail`, 'x')).toBe(false);
    expect(received).toHaveLength(1);
  });

  it('非法 URL / 非 http(s) 协议 ⇒ false 且不抛', async () => {
    expect(await channel().sendMessage('not-a-url', 'x')).toBe(false);
    expect(await channel().sendMessage('ftp://example.com/hook', 'x')).toBe(
      false
    );
  });

  it('不可达端点 ⇒ false（网络错误被归一，不抛）', async () => {
    expect(await channel().sendMessage('http://127.0.0.1:9/hook', 'x')).toBe(
      false
    );
  });
});

describe('WebhookChannelPlugin.sendTextMessage — 如实回传 SendResult', () => {
  const plugin = createWebhookChannel();
  const original = webhookChannel.sendMessage.bind(webhookChannel);

  function stub(result: boolean): void {
    webhookChannel.sendMessage = (async () => result) as never;
  }

  it('底层投递成功 ⇒ {success:true}', async () => {
    stub(true);
    try {
      const res = await (
        plugin as unknown as {
          sendTextMessage: (
            target: string,
            content: string
          ) => Promise<{ success: boolean }>;
        }
      ).sendTextMessage(`${base}/ok`, 'x');
      expect(res.success).toBe(true);
    } finally {
      webhookChannel.sendMessage = original;
    }
  });

  it('底层投递失败 ⇒ {success:false}（差异率分子可被观察到）', async () => {
    stub(false);
    try {
      const res = await (
        plugin as unknown as {
          sendTextMessage: (
            target: string,
            content: string
          ) => Promise<{ success: boolean; error?: string }>;
        }
      ).sendTextMessage(`${base}/fail`, 'x');
      expect(res.success).toBe(false);
      expect(res.error).toContain('webhook 投递失败');
    } finally {
      webhookChannel.sendMessage = original;
    }
  });
});
