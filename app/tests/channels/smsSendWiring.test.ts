/**
 * SMS 发送接线（2026-11-01）。
 *
 * 修复前的两个缺陷：① 插件层忽略 `sendMessage` 返回值 ⇒ **一律报成功**；
 * ② `onConnect` 忽略传入 config，对单例调 connect()（恒 false）却无人检查。
 * 本用例钉住接线后的行为：真实 fetch、上游非 2xx 如实失败、不可构造的 provider 明确拒绝、
 * 未连接不谎报、缺凭据时连接失败。
 */
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import {
  SmsChannel,
  createSmsChannel,
} from '../../src/channels/sms/SmsChannel';

const realFetch = globalThis.fetch;
let calls: Array<{ url: string; init?: RequestInit }> = [];
let status = 201;

function mockFetch(): void {
  calls = [];
  status = 201;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return {
      ok: status >= 200 && status < 300,
      status,
    } as unknown as Response;
  }) as typeof fetch;
}

beforeEach(() => {
  mockFetch();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const twilio = {
  enabled: true,
  provider: 'twilio' as const,
  fromNumber: '+8613800000000',
  accountSid: 'AC123',
  authToken: 'tok',
  maxRetries: 3,
  timeout: 5000,
};

describe('SMS 发送接线', () => {
  it('twilio：连接后发送 ⇒ 发一次 POST，返回 true', async () => {
    const ch = new SmsChannel(twilio);
    expect(await ch.connect()).toBe(true);

    expect(await ch.sendMessage('+8613900000000', '你好')).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('/Accounts/AC123/Messages.json');
    expect(calls[0]!.init?.method).toBe('POST');
  });

  it('上游非 2xx ⇒ false 且错误含状态码', async () => {
    const ch = new SmsChannel(twilio);
    await ch.connect();
    status = 500;

    expect(await ch.sendMessage('+8613900000000', 'hi')).toBe(false);
    expect(ch.getLastError()).toContain('500');
  });

  it('aliyun（缺模板字段）⇒ false 且原因点明 TemplateCode，不发请求', async () => {
    const ch = new SmsChannel({
      enabled: true,
      provider: 'aliyun',
      fromNumber: '+8613800000000',
      apiKey: 'k',
      apiSecret: 's',
      signName: '测试签名',
      maxRetries: 3,
      timeout: 5000,
    });
    expect(await ch.connect()).toBe(true);

    expect(await ch.sendMessage('+8613900000000', 'hi')).toBe(false);
    expect(ch.getLastError()).toContain('TemplateCode');
    expect(calls).toHaveLength(0); // 不可构造时不发请求
  });

  it('aliyun（配置完整）⇒ 真实 POST 到 dysmsapi，表单含签名', async () => {
    const ch = new SmsChannel({
      enabled: true,
      provider: 'aliyun',
      fromNumber: '+8613800000000',
      apiKey: 'test-ak',
      apiSecret: 'test-sk',
      signName: '测试签名',
      templateCode: 'SMS_0001',
      maxRetries: 3,
      timeout: 5000,
    });
    expect(await ch.connect()).toBe(true);

    expect(await ch.sendMessage('+8613900000000', '你好')).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://dysmsapi.aliyuncs.com/');
    expect(calls[0]!.init?.method).toBe('POST');

    const form = new URLSearchParams(String(calls[0]!.init?.body));
    expect(form.get('Action')).toBe('SendSms');
    expect(form.get('SignName')).toBe('测试签名');
    expect(form.get('TemplateCode')).toBe('SMS_0001');
    expect(form.get('Signature')).toBeTruthy();
  });

  it('未连接 ⇒ false（不谎报）', async () => {
    const ch = new SmsChannel(twilio);

    expect(await ch.sendMessage('+8613900000000', 'hi')).toBe(false);
    expect(ch.getLastError()).toContain('未连接');
  });

  it('插件层：连接后 sendText 如实反映结果', async () => {
    const plugin = createSmsChannel();
    await plugin.lifecycle.connect({
      provider: 'twilio',
      fromNumber: '+8613800000000',
      accountSid: 'AC123',
      authToken: 'tok',
    });
    try {
      const ok = await plugin.outbound.sendText('+8613900000000', '你好');
      expect(ok.success).toBe(true);

      status = 429;
      const failed = await plugin.outbound.sendText('+8613900000000', 'again');
      expect(failed.success).toBe(false);
      expect(failed.error).toContain('429');
    } finally {
      await plugin.lifecycle.disconnect();
    }
  });

  it('插件层：缺 Twilio 凭证 ⇒ 连接即失败（不假装已连接）', async () => {
    const plugin = createSmsChannel();

    await expect(
      plugin.lifecycle.connect({
        provider: 'twilio',
        fromNumber: '+8613800000000',
      })
    ).rejects.toThrow(/Twilio 凭证未配置/);
  });
});
