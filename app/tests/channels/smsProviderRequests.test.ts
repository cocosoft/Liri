/**
 * SMS provider 请求构造（纯函数）契约（2026-11-01）。
 *
 * 背景：`SmsChannel.sendMessage` 目前只 emit 事件、**不发任何 HTTP** ⇒ 没有真实发送可测。
 * 本用例钉住 `buildSmsProviderRequest` 的产出形状（URL / 方法 / 鉴权 / body），
 * 并对**当前配置模型无法表达**的两家（阿里云 / 腾讯云）断言「明确拒绝 + 说明缺什么」，
 * 不允许返回半成品请求。
 */
import { describe, expect, it } from 'bun:test';
import { buildSmsProviderRequest } from '../../src/channels/sms/providerRequests';

const base = {
  to: '+8613900000000',
  text: '你好',
  from: '+8613800000000',
};

describe('SMS provider 请求构造（纯函数）', () => {
  it('twilio：/Accounts/<sid>/Messages.json + Basic 鉴权 + form body', () => {
    const r = buildSmsProviderRequest({
      ...base,
      provider: 'twilio',
      credentials: { accountSid: 'AC123', authToken: 'tok' },
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.request.method).toBe('POST');
    expect(r.request.url).toBe(
      'https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json'
    );
    expect(r.request.headers['Content-Type']).toBe(
      'application/x-www-form-urlencoded'
    );
    expect(r.request.headers.Authorization).toBe(
      `Basic ${Buffer.from('AC123:tok', 'utf-8').toString('base64')}`
    );
    const form = new URLSearchParams(r.request.body);
    expect(form.get('To')).toBe('+8613900000000');
    expect(form.get('From')).toBe('+8613800000000');
    expect(form.get('Body')).toBe('你好');
  });

  it('twilio：缺凭据 ⇒ 明确拒绝（不返回半成品）', () => {
    const r = buildSmsProviderRequest({
      ...base,
      provider: 'twilio',
      credentials: {},
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain('accountSid');
  });

  it('custom：endpoint + JSON body（无 apiKey 时不带 Authorization）', () => {
    const r = buildSmsProviderRequest({
      ...base,
      provider: 'custom',
      endpoint: 'https://sms.example.com/send',
      credentials: {},
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.request.url).toBe('https://sms.example.com/send');
    expect(r.request.headers['Content-Type']).toBe('application/json');
    expect(r.request.headers.Authorization).toBeUndefined();
    expect(JSON.parse(r.request.body)).toEqual({
      to: '+8613900000000',
      from: '+8613800000000',
      text: '你好',
    });
  });

  it('custom：有 apiKey ⇒ Bearer；缺 endpoint ⇒ 明确拒绝', () => {
    const withKey = buildSmsProviderRequest({
      ...base,
      provider: 'custom',
      endpoint: 'https://sms.example.com/send',
      credentials: { apiKey: 'k1' },
    });
    expect(withKey.ok).toBe(true);
    if (withKey.ok) {
      expect(withKey.request.headers.Authorization).toBe('Bearer k1');
    }

    const noEndpoint = buildSmsProviderRequest({
      ...base,
      provider: 'custom',
      credentials: {},
    });
    expect(noEndpoint.ok).toBe(false);
    if (!noEndpoint.ok) expect(noEndpoint.reason).toContain('endpoint');
  });

  it('aliyun / tencent：当前配置模型缺模板/签名字段 ⇒ 明确拒绝并说明缺什么', () => {
    for (const provider of ['aliyun', 'tencent'] as const) {
      const r = buildSmsProviderRequest({
        ...base,
        provider,
        credentials: { apiKey: 'k', apiSecret: 's' },
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reason).toContain('暂不可构造');
        expect(r.reason.length).toBeGreaterThan(10);
      }
    }
  });

  it('未知 provider ⇒ 明确拒绝（不静默当 custom）', () => {
    const r = buildSmsProviderRequest({
      ...base,
      // 故意绕过类型：模拟配置里写错 provider
      provider: 'unknown' as unknown as 'custom',
      credentials: {},
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('未知 provider');
  });
});
