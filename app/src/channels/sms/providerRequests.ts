/**
 * SMS provider 请求构造（**纯函数**，2026-11-01）
 *
 * 背景：`SmsChannel.sendMessage` 曾只 emit 事件并返回 true —— **没有任何 provider HTTP 调用**。
 * 本模块把各家「发一条短信」的请求形状落成可测的纯函数（`SmsChannel` 只负责 `fetch` 它），
 * 本模块**不发起网络请求**。
 *
 * 覆盖范围（如实）：
 *   · `twilio`  完整（REST + Basic Auth + form body）；
 *   · `custom`  完整（用户自填 endpoint + JSON body）；
 *   · `aliyun`  完整（RPC 风格 + HMAC-SHA1 签名 + form body，见 `buildAliyun`）；
 *   · `tencent` **暂不可构造**：当前 `SmsConfig` 缺 SdkAppId / TemplateId（且需 TC3 签名），
 *     返回 `ok:false` 并点明缺什么 —— 不臆造半个请求。
 */

import { createHmac, randomUUID } from 'node:crypto';

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
  /** 阿里云：短信签名（控制台报备名称） */
  signName?: string;
  /** 阿里云：短信模板编号 */
  templateCode?: string;
  /** 阿里云：地域（默认 cn-hangzhou） */
  regionId?: string;
  /** 测试注入：固定签名时间（生产不传，避免同一秒内不可复现） */
  now?: Date;
  /** 测试注入：固定 nonce（生产不传） */
  nonce?: string;
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

const ALIYUN_DEFAULT_ENDPOINT = 'https://dysmsapi.aliyuncs.com/';
const ALIYUN_API_VERSION = '2017-05-25';

/**
 * 阿里云 RPC 签名用的百分号编码（对齐官方 Java SDK 的 `URLEncoder` 语义）：
 * 先 `encodeURIComponent`，再把 `!'()*` 手动转义 —— 这五个字符 JS 不编码而 Java 编码。
 */
function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

/** 阿里云要求的时间戳：UTC ISO8601 秒级（`2017-05-25T10:00:00Z`），不带毫秒 */
function aliyunTimestamp(now: Date): string {
  return `${now.toISOString().slice(0, 19)}Z`;
}

/**
 * 阿里云短信：`POST https://dysmsapi.aliyuncs.com/`（RPC 风格，参数全在 form body）。
 *
 * 签名（官方「签名机制」）：
 *   canonicalizedQuery = 参数按 key 字节序排序后 `percentEncode(k)=percentEncode(v)` 用 `&` 连接
 *   stringToSign       = `POST&percentEncode("/")&percentEncode(canonicalizedQuery)`
 *   signature          = Base64(HMAC-SHA1(accessKeySecret + "&", stringToSign))
 *
 * **模板参数约定**：本仓发送的是自由文本，故填 `TemplateParam={"content":"<text>"}`，
 * 短信模板须含 `${content}` 变量；模板/签名都来自配置（`templateCode` / `signName`），
 * 不在代码里写死。
 */
function buildAliyun(input: BuildSmsProviderRequestInput): BuildResult {
  const { apiKey, apiSecret } = input.credentials;
  if (!apiKey || !apiSecret) {
    return {
      ok: false,
      reason: '阿里云短信缺少 AccessKeyId / AccessKeySecret',
    };
  }
  if (!input.signName) {
    return {
      ok: false,
      reason: '阿里云短信缺少 SignName（控制台报备的短信签名）',
    };
  }
  if (!input.templateCode) {
    return { ok: false, reason: '阿里云短信缺少 TemplateCode（短信模板编号）' };
  }
  if (!input.to) {
    return { ok: false, reason: '阿里云短信缺少接收号码（to）' };
  }

  const params: Record<string, string> = {
    AccessKeyId: apiKey,
    Action: 'SendSms',
    Format: 'JSON',
    PhoneNumbers: input.to,
    RegionId: input.regionId ?? 'cn-hangzhou',
    SignName: input.signName,
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: input.nonce ?? randomUUID(),
    SignatureVersion: '1.0',
    TemplateCode: input.templateCode,
    TemplateParam: JSON.stringify({ content: input.text }),
    Timestamp: aliyunTimestamp(input.now ?? new Date()),
    Version: ALIYUN_API_VERSION,
  };

  const canonicalizedQuery = Object.keys(params)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k]!)}`)
    .join('&');

  const stringToSign = `POST&${percentEncode('/')}&${percentEncode(canonicalizedQuery)}`;
  const signature = createHmac('sha1', `${apiSecret}&`)
    .update(stringToSign, 'utf-8')
    .digest('base64');

  return {
    ok: true,
    request: {
      url: input.endpoint ?? ALIYUN_DEFAULT_ENDPOINT,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `${canonicalizedQuery}&Signature=${percentEncode(signature)}`,
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
      return buildAliyun(input);
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
