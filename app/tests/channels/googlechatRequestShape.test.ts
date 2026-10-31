/**
 * Google Chat 出站请求形状桩（2026-11-01，通道 upstream 契约第二批）。
 *
 * 锁两段线上协议：① 服务账号 JWT → OAuth `token` 换 access_token（真实 RSA 签名，私钥为
 * 测试内**临时生成**，不涉及任何真实凭据）；② `POST /v1/spaces/<space>/messages` 的
 * `{ text }` 形状与 Bearer 头。fetch 全量 mock，无网络。
 */
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import { createGoogleChatChannel } from '../../src/channels/googlechat/GoogleChatChannel';

interface Call {
  url: string;
  init?: RequestInit;
}

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const realFetch = globalThis.fetch;
let calls: Call[] = [];

function mockFetch(): void {
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const body = url.includes('token')
      ? { access_token: 'GAT' }
      : { name: 'spaces/s1/messages/m1' };
    return { ok: true, json: async () => body } as unknown as Response;
  }) as typeof fetch;
}

beforeEach(() => {
  mockFetch();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

async function connected(): Promise<
  ReturnType<typeof createGoogleChatChannel>
> {
  const ch = createGoogleChatChannel();
  await ch.lifecycle.connect({
    clientEmail: 'svc@example.iam.gserviceaccount.com',
    privateKey,
  });
  calls = []; // 丢弃连接期的 OAuth，只观察发送
  return ch;
}

describe('Google Chat 出站请求形状', () => {
  it('sendText ⇒ POST /v1/spaces/<id>/messages，Bearer 授权 + { text }', async () => {
    const ch = await connected();

    const r = await ch.outbound.sendText('s1', '你好');

    expect(r.success).toBe(true);
    expect(r.messageId).toBe('spaces/s1/messages/m1');
    // sendText 会先换一次 token，再发消息 ⇒ 最后一条是消息请求
    const last = calls[calls.length - 1]!;
    expect(last.url).toBe('https://chat.googleapis.com/v1/spaces/s1/messages');
    expect(last.init?.method).toBe('POST');
    const headers = last.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer GAT');
    expect(JSON.parse(String(last.init?.body))).toEqual({ text: '你好' });
  });

  it('目标已是 spaces/ 前缀 ⇒ 不重复拼接', async () => {
    const ch = await connected();

    await ch.outbound.sendText('spaces/s2', 'hi');

    const last = calls[calls.length - 1]!;
    expect(last.url).toBe('https://chat.googleapis.com/v1/spaces/s2/messages');
  });
});
