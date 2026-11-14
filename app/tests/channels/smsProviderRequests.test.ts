/**
 * SMS provider 请求构造（纯函数）契约（2026-11-01）。
 *
 * 背景：`SmsChannel.sendMessage` 曾经只 emit 事件、**不发任何 HTTP** ⇒ 没有真实发送可测。
 * 本用例钉住 `buildSmsProviderRequest` 的产出形状（URL / 方法 / 鉴权 / body）：
 *   · twilio / custom —— 形状断言；
 *   · aliyun —— 参数集 + **用测试自己的 percentEncode/HMAC-SHA1 独立复算签名**（不信任实现内部）；
 *   · tencent —— 当前配置模型无法表达，断言「明确拒绝 + 说明缺什么」，不允许返回半成品请求。
 */
import { describe, expect, it } from 'bun:test';
import { createHmac } from 'node:crypto';
import { buildSmsProviderRequest } from '@modules/channels/sms/providerRequests';

const base = {
  to: '+8613900000000',
  text: '你好',
  from: '+8613800000000',
};

/** 测试侧的独立百分号编码实现（按阿里云官方「签名机制」语义，不复用被测代码） */
function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

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

  it('aliyun：RPC 表单参数齐全，签名可用独立实现复算', () => {
    const r = buildSmsProviderRequest({
      ...base,
      provider: 'aliyun',
      credentials: { apiKey: 'test-ak', apiSecret: 'test-sk' },
      signName: '测试签名',
      templateCode: 'SMS_0001',
      now: new Date('2026-11-01T00:00:00Z'),
      nonce: 'fixed-nonce',
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.request.method).toBe('POST');
    expect(r.request.url).toBe('https://dysmsapi.aliyuncs.com/');
    expect(r.request.headers['Content-Type']).toBe(
      'application/x-www-form-urlencoded'
    );

    const form = new URLSearchParams(r.request.body);
    expect(form.get('AccessKeyId')).toBe('test-ak');
    expect(form.get('Action')).toBe('SendSms');
    expect(form.get('Format')).toBe('JSON');
    expect(form.get('Version')).toBe('2017-05-25');
    expect(form.get('PhoneNumbers')).toBe('+8613900000000');
    expect(form.get('SignName')).toBe('测试签名');
    expect(form.get('TemplateCode')).toBe('SMS_0001');
    expect(form.get('RegionId')).toBe('cn-hangzhou');
    expect(form.get('SignatureMethod')).toBe('HMAC-SHA1');
    expect(form.get('SignatureVersion')).toBe('1.0');
    expect(form.get('SignatureNonce')).toBe('fixed-nonce');
    expect(form.get('Timestamp')).toBe('2026-11-01T00:00:00Z');
    expect(JSON.parse(form.get('TemplateParam')!)).toEqual({ content: '你好' });

    // 独立复算：参数集 → 排序拼接 → stringToSign → HMAC-SHA1(secret + "&")
    const params: Record<string, string> = {
      AccessKeyId: 'test-ak',
      Action: 'SendSms',
      Format: 'JSON',
      PhoneNumbers: '+8613900000000',
      RegionId: 'cn-hangzhou',
      SignName: '测试签名',
      SignatureMethod: 'HMAC-SHA1',
      SignatureNonce: 'fixed-nonce',
      SignatureVersion: '1.0',
      TemplateCode: 'SMS_0001',
      TemplateParam: JSON.stringify({ content: '你好' }),
      Timestamp: '2026-11-01T00:00:00Z',
      Version: '2017-05-25',
    };
    const canonical = Object.keys(params)
      .sort()
      .map((k) => `${percentEncode(k)}=${percentEncode(params[k]!)}`)
      .join('&');
    const expected = createHmac('sha1', 'test-sk&')
      .update(`POST&${percentEncode('/')}&${percentEncode(canonical)}`, 'utf-8')
      .digest('base64');
    expect(form.get('Signature')).toBe(expected);

    // 签名覆盖全部业务参数：body 里除 Signature 外不得有额外键
    expect([...form.keys()].sort()).toEqual(
      [...Object.keys(params), 'Signature'].sort()
    );
  });

  it('aliyun：缺 SignName / TemplateCode / 凭据 ⇒ 明确拒绝（不返回半成品）', () => {
    const credentials = { apiKey: 'k', apiSecret: 's' };

    const noSign = buildSmsProviderRequest({
      ...base,
      provider: 'aliyun',
      credentials,
      templateCode: 'SMS_0001',
    });
    expect(noSign.ok).toBe(false);
    if (!noSign.ok) expect(noSign.reason).toContain('SignName');

    const noTemplate = buildSmsProviderRequest({
      ...base,
      provider: 'aliyun',
      credentials,
      signName: '测试签名',
    });
    expect(noTemplate.ok).toBe(false);
    if (!noTemplate.ok) expect(noTemplate.reason).toContain('TemplateCode');

    const noCredential = buildSmsProviderRequest({
      ...base,
      provider: 'aliyun',
      credentials: {},
      signName: '测试签名',
      templateCode: 'SMS_0001',
    });
    expect(noCredential.ok).toBe(false);
    if (!noCredential.ok) expect(noCredential.reason).toContain('AccessKeyId');
  });

  it('tencent：当前配置模型缺 SdkAppId / TemplateId ⇒ 明确拒绝并说明缺什么', () => {
    const r = buildSmsProviderRequest({
      ...base,
      provider: 'tencent',
      credentials: { apiKey: 'k', apiSecret: 's' },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain('暂不可构造');
      expect(r.reason.length).toBeGreaterThan(10);
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
