/**
 * SMS provider 请求构造（**纯函数**，2026-11-01）
 *
 * 背景：`SmsChannel.sendMessage` 当前只 emit 事件并返回 true —— **没有任何 provider HTTP 调用**。
 * 本模块把各家「发一条短信」的请求形状先落成可测的纯函数，为接线做准备；**不发起网络请求**。
 *
 * 覆盖范围（如实）：
 *   · `twilio`  完整（REST + Basic Auth + form body）；
 *   · `custom`  完整（用户自填 endpoint + JSON body）；
 *   · `aliyun` / `tencent`  **暂不可构造**：当前 `SmsConfig` 缺签名与模板字段
 *     （阿里云需 SignName / TemplateCode，腾讯云需 SdkAppId / TemplateId / 签名算法），
 *     返回 `ok:false` 并点明缺什么 —— 不臆造半个请求。
 */

export type SmsProvider = 'twilio' | 'aliyun' | 'tencent' | 'custom';

export interface SmsCredentials {
  accountSid?: string;
  authToken?: string;
  apiKey?: string;
  apiSecret?: string;
}

export interface SmsProviderRequest {
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  /** 已序列化的请求体（表单或 JSON 字符串） */
  body: string;
}

export type BuildResult =
  | { ok: true; request: SmsProviderRequest }
  | { ok: false; reason: string };

export interface BuildSmsProviderRequestInput {
  provider: SmsProvider;
  to: string;
  text: string;
  from: string;
  credentials: SmsCredentials;
  endpoint?: string;
}

const TWILIO_BASE = 'https://api.twilio.com/2010-04-01/Accounts';

/** Twilio：`POST /Accounts/{Sid}/Messages.json`，Basic Auth，form 编码 */
function buildTwilio(input: BuildSmsProviderRequestInput): BuildResult {
  const { accountSid, authToken } = input.credentials;
  if (!accountSid || !authToken) {
    return { ok: false, reason: 'Twilio 缺少 accountSid / authToken' };
  }
  if (!input.from) {
    return { ok: false, reason: 'SMS 缺少发件人号码（from）' };
  }
  const body = new URLSearchParams({
    To: input.to,
    From: input.from,
    Body: input.text,
  }).toString();
  return {
    ok: true,
    request: {
      url: `${TWILIO_BASE}/${encodeURIComponent(accountSid)}/Messages.json`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`, 'utf-8').toString('base64')}`,
      },
      body,
    },
  };
}

/** 自定义网关：必须给 endpoint；有 apiKey 时带 Bearer */
function buildCustom(input: BuildSmsProviderRequestInput): BuildResult {
  if (!input.endpoint) {
    return { ok: false, reason: 'custom provider 缺少 endpoint' };
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (input.credentials.apiKey) {
    headers.Authorization = `Bearer ${input.credentials.apiKey}`;
  }
  return {
    ok: true,
    request: {
      url: input.endpoint,
      method: 'POST',
      headers,
      body: JSON.stringify({
        to: input.to,
        from: input.from,
        text: input.text,
      }),
    },
  };
}

/**
 * 构造 provider 请求（不发起网络请求）。
 *
 * @returns `ok:false` 时 `reason` 必须能直接告诉配置缺什么 —— 不要返回"半成品"请求。
 */
export function buildSmsProviderRequest(
  input: BuildSmsProviderRequestInput
): BuildResult {
  switch (input.provider) {
    case 'twilio':
      return buildTwilio(input);
    case 'custom':
      return buildCustom(input);
    case 'aliyun':
      return {
        ok: false,
        reason:
          '阿里云短信暂不可构造：配置缺 SignName / TemplateCode（且需 RPC 签名），请先扩展 SmsConfig 再接线',
      };
    case 'tencent':
      return {
        ok: false,
        reason:
          '腾讯云短信暂不可构造：配置缺 SdkAppId / TemplateId（且需 TC3 签名），请先扩展 SmsConfig 再接线',
      };
    default:
      return {
        ok: false,
        reason: `未知 provider: ${String((input as { provider?: unknown }).provider)}`,
      };
  }
}
