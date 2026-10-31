/**
 * Discord 出站请求形状桩（2026-11-01，通道 upstream 契约第一批）。
 *
 * 与 `telegramRequestShape.test.ts` 同口径：把最常见的「发一条文本」钉死在
 * **端点 + 方法 + 授权头 + JSON 形状**上，fetch 全量 mock（无真实 Token / 无网络）。
 * 上游若改路径或字段、或本仓误改 payload ⇒ 这里先红。
 */
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { createDiscordChannel } from '../../src/channels/discord/DiscordChannel';

interface Call {
  url: string;
  init?: RequestInit;
}

const realFetch = globalThis.fetch;
let calls: Call[] = [];

function mockFetch(fn: (url: string) => unknown): void {
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return { ok: true, json: async () => fn(url) } as unknown as Response;
  }) as typeof fetch;
}

beforeEach(() => {
  mockFetch((url) =>
    url.includes('/gateway/bot')
      ? { url: 'wss://gateway.discord.gg' }
      : { id: 'app-1' }
  );
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('Discord 出站请求形状', () => {
  it('sendText ⇒ POST /api/v10/channels/<id>/messages，Bot 授权 + content/allowed_mentions', async () => {
    const ch = createDiscordChannel();
    await ch.lifecycle.connect({ botToken: 'DTOKEN' });
    calls = [];

    const r = await ch.outbound.sendText('chan-1', '你好');

    expect(r.success).toBe(true);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call!.url).toContain('/api/v10/channels/chan-1/messages');
    expect(call!.init?.method).toBe('POST');
    const headers = call!.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bot DTOKEN');
    const body = JSON.parse(String(call!.init?.body)) as Record<
      string,
      unknown
    >;
    expect(body['content']).toBe('你好');
    // 明确关闭回复自己的提及（避免机器人互相触发）
    expect(body['allowed_mentions']).toEqual({
      parse: ['users', 'roles'],
      replied_user: false,
    });
  });
});
