/**
 * Telegram 出站请求形状桩（2026-11-01，通道 upstream 契约第一批）。
 *
 * 为什么需要：通道数量多、上游 API 改动靠人肉回归。本用例把**最常走的 sendMessage**
 * 钉在「端点 + 方法 + JSON 形状」上 —— Telegram 若改路径/字段（或本仓误改转义口径），
 * 这里先红，不需要真实 Token 与网络（fetch 全量 mock）。
 *
 * 覆盖：① 连接（getMe）后的 sendMessage 端点与 body；② HTML 转义；
 * ③ 超长文本按 `maxMessageLength` 分片（不截断丢尾）；④ 上游 `ok:false` 透传为失败结果。
 */
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { createTelegramChannel } from '../../src/channels/telegram/TelegramChannel';

interface Call {
  url: string;
  init?: RequestInit;
}

const realFetch = globalThis.fetch;
let calls: Call[] = [];
let responseBody: unknown = { ok: true, result: { message_id: 42 } };

function mockFetch(body: unknown): void {
  responseBody = body;
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return {
      ok: true,
      json: async () => responseBody,
    } as unknown as Response;
  }) as typeof fetch;
}

beforeEach(() => {
  mockFetch({ ok: true, result: { message_id: 42 } });
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

async function connect(
  token = 'T'
): Promise<ReturnType<typeof createTelegramChannel>> {
  const ch = createTelegramChannel();
  await ch.lifecycle.connect({ botToken: token });
  calls = []; // 丢弃 getMe，只观察 sendMessage
  return ch;
}

describe('Telegram 出站请求形状', () => {
  it('sendText ⇒ POST /bot<token>/sendMessage，body 为 chat_id/text/parse_mode', async () => {
    const ch = await connect('TOKEN');
    const r = await ch.outbound.sendText('chat-1', '你好 <b>&');

    expect(r.success).toBe(true);
    expect(r.messageId).toBe('42');
    expect(calls).toHaveLength(1);

    const [call] = calls;
    expect(call!.url).toContain('/botTOKEN/sendMessage');
    expect(call!.init?.method).toBe('POST');
    const body = JSON.parse(String(call!.init?.body)) as Record<
      string,
      unknown
    >;
    expect(body['chat_id']).toBe('chat-1');
    // BUG-8：HTML 解析模式下 `<` / `>` / `&` 必须转义，否则上游 400（逐字锁线上文本）
    expect(body['text']).toBe('你好 &lt;b&gt;&amp;');
    expect(body['parse_mode']).toBe('HTML');
  });

  it('超长文本 ⇒ 分片多次发送（不截断丢尾）', async () => {
    const ch = await connect();
    const long = 'a'.repeat(ch.meta.maxMessageLength + 10);
    const r = await ch.outbound.sendText('chat-1', long);

    expect(r.success).toBe(true);
    expect(calls.length).toBe(2);
    const texts = calls.map(
      (c) =>
        (JSON.parse(String(c.init?.body)) as Record<string, string>)['text'] ??
        ''
    );
    expect(texts.join('')).toBe(long);
  });

  it('上游 ok:false ⇒ success=false 且透传 description', async () => {
    const ch = await connect();
    mockFetch({ ok: false, description: 'Bad Request: chat not found' });
    const r = await ch.outbound.sendText('chat-x', 'hi');

    expect(r.success).toBe(false);
    expect(r.error).toContain('chat not found');
  });
});
