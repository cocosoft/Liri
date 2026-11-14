/**
 * Twitter/X 通道配置模式定义
 * 对标 IRC config-schema.ts 模式
 */

export interface TwitterConfig {
  enabled?: boolean;
  apiKey: string;
  apiSecretKey: string;
  accessToken: string;
  accessTokenSecret: string;
  bearerToken?: string;
}

const DEFAULTS: Partial<TwitterConfig> = {};

export function getDefaultTwitterConfig(): TwitterConfig {
  return {
    enabled: false,
    apiKey: '',
    apiSecretKey: '',
    accessToken: '',
    accessTokenSecret: '',
    bearerToken: '',
  };
}

export function validateTwitterConfig(raw: Record<string, unknown>): string[] {
  const errors: string[] = [];

  if (!raw['apiKey'] || typeof raw['apiKey'] !== 'string') {
    errors.push('apiKey: 必须是非空字符串（Twitter API Key）');
  }
  if (!raw['apiSecretKey'] || typeof raw['apiSecretKey'] !== 'string') {
    errors.push('apiSecretKey: 必须是非空字符串（Twitter API Secret）');
  }
  if (!raw['accessToken'] || typeof raw['accessToken'] !== 'string') {
    errors.push('accessToken: 必须是非空字符串（Twitter Access Token）');
  }
  if (
    !raw['accessTokenSecret'] ||
    typeof raw['accessTokenSecret'] !== 'string'
  ) {
    errors.push('accessTokenSecret: 必须是非空字符串（Twitter Access Secret）');
  }

  return errors;
}
