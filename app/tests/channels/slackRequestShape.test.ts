/**
 * Slack 出站请求形状桩（2026-11-01，通道 upstream 契约第一批）。
 *
 * 与 `telegramRequestShape.test.ts` 同口径：把最常见的「发一条文本」钉死在
 * **端点 + 方法 + 授权头 + JSON 形状**上，fetch 全量 mock（无真实 Token / 无网络）。
 * 上游若改路径或字段、或本仓误改 payload ⇒ 这里先红。
 */
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { createSlackChannel } from '../../src/channels/slack/SlackChannel';

interface Call {
  url: string;
  init?: RequestInit;
}

const realFetch = globalThis.fetch;
let calls: Call[] = [];
let responder: (url: string) => unknown = () => ({ ok: true });

function mockFetch(fn: (url: string) => unknown): void {
  responder = fn;
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return {
      ok: true,
      json: async () => responder(url),
    } as unknown as Response;
  }) as typeof fetch;
}

beforeEach(() => {
  mockFetch(() => ({ ok: true }));
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('Slack 出站请求形状', () => {
  it('sendText ⇒ POST https://slack.com/api/chat.postMessage，Bearer 授权 + channel/text', async () => {
    const ch = createSlackChannel();
    await ch.lifecycle.connect({ botToken: 'SBOT' });
    calls = [];

    const r = await ch.outbound.sendText('C123', '你好');

    expect(r.success).toBe(true);
    const [call] = calls;
    expect(call!.url).toBe('https://slack.com/api/chat.postMessage');
    expect(call!.init?.method).toBe('POST');
    const headers = call!.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer SBOT');
    expect(JSON.parse(String(call!.init?.body))).toEqual({
      channel: 'C123',
      text: '你好',
    });
  });

  it('上游 ok:false ⇒ success=false 且透传 error 码', async () => {
    mockFetch(() => ({ ok: false, error: 'channel_not_found' }));
    const ch = createSlackChannel();
    await ch.lifecycle.connect({ botToken: 'SBOT' });
    calls = [];

    const r = await ch.outbound.sendText('C404', 'hi');

    expect(r.success).toBe(false);
    expect(r.error).toBe('channel_not_found');
  });
});
