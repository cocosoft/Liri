/**
 * LINE 出站请求形状桩（2026-11-01，通道 upstream 契约第二批）。
 *
 * 与 `telegramRequestShape.test.ts` 同口径：把「发一条文本」钉死在
 * **端点 + 方法 + 授权头 + JSON 形状**上，fetch 全量 mock（无真实 Token / 无网络）。
 */
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { createLineChannel } from '../../src/channels/line/LineChannel';

interface Call {
  url: string;
  init?: RequestInit;
}

const realFetch = globalThis.fetch;
let calls: Call[] = [];
let respond: (url: string) => {
  ok: boolean;
  body?: unknown;
  text?: string;
} = () => ({ ok: true, body: {} });

function mockFetch(
  fn: (url: string) => { ok: boolean; body?: unknown; text?: string }
): void {
  respond = fn;
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const r = respond(url);
    return {
      ok: r.ok,
      status: r.ok ? 200 : 400,
      json: async () => r.body ?? {},
      text: async () => r.text ?? '',
    } as unknown as Response;
  }) as typeof fetch;
}

beforeEach(() => {
  mockFetch(() => ({ ok: true, body: {} }));
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('LINE 出站请求形状', () => {
  it('sendText ⇒ POST /v2/bot/message/push，Bearer 授权 + to/messages[text]', async () => {
    const ch = createLineChannel();
    await ch.lifecycle.connect({
      channelAccessToken: 'LTOKEN',
      channelSecret: 'LSECRET',
    });
    calls = [];

    const r = await ch.outbound.sendText('U1', '你好');

    expect(r.success).toBe(true);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call!.url).toBe('https://api.line.me/v2/bot/message/push');
    expect(call!.init?.method).toBe('POST');
    const headers = call!.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer LTOKEN');
    expect(JSON.parse(String(call!.init?.body))).toEqual({
      to: 'U1',
      messages: [{ type: 'text', text: '你好' }],
    });
  });

  it('上游非 2xx ⇒ success=false 且错误含状态码与响应体', async () => {
    const ch = createLineChannel();
    await ch.lifecycle.connect({
      channelAccessToken: 'LTOKEN',
      channelSecret: 'LSECRET',
    });
    mockFetch(() => ({ ok: false, text: '{"message":"invalid token"}' }));
    calls = [];

    const r = await ch.outbound.sendText('U1', 'hi');

    expect(r.success).toBe(false);
    expect(r.error).toContain('LINE API 400');
    expect(r.error).toContain('invalid token');
  });
});
