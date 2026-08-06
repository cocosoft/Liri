/**
 * SMS 通道配置模式定义
 * 对标 IRC config-schema.ts 模式
 */

export interface SmsConfig {
  provider: string;
  /** Twilio SID */
  accountSid?: string;
  /** Twilio Auth Token */
  authToken?: string;
  /** 阿里云/腾讯云等 API Key */
  apiKey?: string;
  /** 自定义 API Secret */
  apiSecret?: string;
  maxRetries?: number;
  timeout?: number;
  fromNumber: string;
}

const DEFAULTS: Partial<SmsConfig> = {
  provider: 'custom',
};

export function getDefaultSmsConfig(): SmsConfig {
  return {
    provider: DEFAULTS.provider!,
    accountSid: '',
    authToken: '',
    apiKey: '',
    apiSecret: '',
    maxRetries: 3,
    timeout: 10000,
    fromNumber: '',
  };
}

export function validateSmsConfig(raw: Record<string, unknown>): string[] {
  const errors: string[] = [];

  if (!raw['fromNumber'] || typeof raw['fromNumber'] !== 'string') {
    errors.push('fromNumber: 必须是非空字符串（发送号码）');
  }
  if (raw['provider'] !== undefined && typeof raw['provider'] !== 'string') {
    errors.push('provider: 必须是字符串');
  }

  return errors;
}
