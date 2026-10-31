/**
 * 企业微信（WeCom）出站请求形状桩（2026-11-01，通道 upstream 契约第二批）。
 *
 * 锁两段线上协议：① `gettoken` 换 access_token；② `message/send?access_token=…`
 * 的 `touser / msgtype / agentid / text.content` 形状（含空目标回退 `@all`、
 * 2048 字符截断、errcode 非 0 透传）。fetch 全量 mock，无真实凭据 / 无网络。
 */
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { createWecomChannel } from '../../src/channels/wecom/WeComChannel';

interface Call {
  url: string;
  init?: RequestInit;
}

const realFetch = globalThis.fetch;
let calls: Call[] = [];
let sendResponse: { errcode: number; errmsg?: string } = { errcode: 0 };

function mockFetch(): void {
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const body = url.includes('/gettoken')
      ? { errcode: 0, access_token: 'WAT', expires_in: 7200 }
      : sendResponse;
    return { ok: true, json: async () => body } as unknown as Response;
  }) as typeof fetch;
}

beforeEach(() => {
  sendResponse = { errcode: 0 };
  mockFetch();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

async function connected(): Promise<ReturnType<typeof createWecomChannel>> {
  const ch = createWecomChannel();
  await ch.lifecycle.connect({
    corpId: 'CORP',
    corpSecret: 'SECRET',
    agentId: '1001',
  });
  calls = []; // 丢弃 gettoken，只观察 message/send
  return ch;
}

describe('企业微信 出站请求形状', () => {
  it('connect ⇒ GET /cgi-bin/gettoken?corpid&corpsecret', async () => {
    calls = [];
    const ch = createWecomChannel();
    await ch.lifecycle.connect({
      corpId: 'CORP',
      corpSecret: 'SECRET',
      agentId: '1001',
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      'https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=CORP&corpsecret=SECRET'
    );
  });

  it('sendText ⇒ POST /cgi-bin/message/send?access_token，body 为 touser/msgtype/agentid/text', async () => {
    const ch = await connected();

    const r = await ch.outbound.sendText('u1', '你好');

    expect(r.success).toBe(true);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call!.url).toContain(
      'https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=WAT'
    );
    expect(call!.init?.method).toBe('POST');
    expect(JSON.parse(String(call!.init?.body))).toEqual({
      touser: 'u1',
      msgtype: 'text',
      agentid: 1001,
      text: { content: '你好' },
    });
  });

  it('空目标 ⇒ touser 回退 @all（群发语义）', async () => {
    const ch = await connected();

    await ch.outbound.sendText('', 'hi');

    const body = JSON.parse(String(calls[0]!.init?.body)) as Record<
      string,
      unknown
    >;
    expect(body['touser']).toBe('@all');
  });

  it('超长文本 ⇒ 截断到 2048 字符（企业微信 text.content 上限）', async () => {
    const ch = await connected();

    await ch.outbound.sendText('u1', 'x'.repeat(3000));

    const body = JSON.parse(String(calls[0]!.init?.body)) as {
      text: { content: string };
    };
    expect(body.text.content.length).toBe(2048);
  });

  it('errcode 非 0 ⇒ success=false 且透传 errmsg', async () => {
    const ch = await connected();
    sendResponse = { errcode: 40001, errmsg: 'invalid credential' };

    const r = await ch.outbound.sendText('u1', 'hi');

    expect(r.success).toBe(false);
    expect(r.error).toBe('invalid credential');
  });
});
