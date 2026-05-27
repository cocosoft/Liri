/**
 * SMS 通道配置模式定义
 * 对标 IRC config-schema.ts 模式
 */

export interface SmsConfig {
  provider: string;
  apiKey: string;
  fromNumber: string;
  region?: string;
}

const DEFAULTS: Partial<SmsConfig> = {
  provider: 'twilio',
};

export function getDefaultSmsConfig(): SmsConfig {
  return {
    provider: DEFAULTS.provider!,
    apiKey: '',
    fromNumber: '',
  };
}

export function validateSmsConfig(raw: Record<string, unknown>): string[] {
  const errors: string[] = [];

  if (!raw['apiKey'] || typeof raw['apiKey'] !== 'string') {
    errors.push('apiKey: 必须是非空字符串（SMS 服务商 API Key）');
  }
  if (!raw['fromNumber'] || typeof raw['fromNumber'] !== 'string') {
    errors.push('fromNumber: 必须是非空字符串（发送号码）');
  }
  if (raw['provider'] !== undefined && typeof raw['provider'] !== 'string') {
    errors.push('provider: 必须是字符串');
  }

  return errors;
}
