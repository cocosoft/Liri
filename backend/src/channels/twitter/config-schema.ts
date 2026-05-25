/**
 * Twitter/X 通道配置模式定义
 * 对标 IRC config-schema.ts 模式
 */

export interface TwitterConfig {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessSecret: string;
  bearerToken?: string;
}

const DEFAULTS: Partial<TwitterConfig> = {};

export function getDefaultTwitterConfig(): TwitterConfig {
  return {
    apiKey: '',
    apiSecret: '',
    accessToken: '',
    accessSecret: '',
  };
}

export function validateTwitterConfig(raw: Record<string, unknown>): string[] {
  const errors: string[] = [];

  if (!raw['apiKey'] || typeof raw['apiKey'] !== 'string') {
    errors.push('apiKey: 必须是非空字符串（Twitter API Key）');
  }
  if (!raw['apiSecret'] || typeof raw['apiSecret'] !== 'string') {
    errors.push('apiSecret: 必须是非空字符串（Twitter API Secret）');
  }
  if (!raw['accessToken'] || typeof raw['accessToken'] !== 'string') {
    errors.push('accessToken: 必须是非空字符串（Twitter Access Token）');
  }
  if (!raw['accessSecret'] || typeof raw['accessSecret'] !== 'string') {
    errors.push('accessSecret: 必须是非空字符串（Twitter Access Secret）');
  }

  return errors;
}
