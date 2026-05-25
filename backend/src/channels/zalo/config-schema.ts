/**
 * Zalo 通道配置模式定义
 * 对标 IRC config-schema.ts 模式
 */

export interface ZaloConfig {
  appId: string;
  secretKey: string;
  accessToken: string;
  oauthCode?: string;
}

const DEFAULTS: Partial<ZaloConfig> = {};

export function getDefaultZaloConfig(): ZaloConfig {
  return {
    appId: '',
    secretKey: '',
    accessToken: '',
  };
}

export function validateZaloConfig(raw: Record<string, unknown>): string[] {
  const errors: string[] = [];

  if (!raw['appId'] || typeof raw['appId'] !== 'string') {
    errors.push('appId: 必须是非空字符串（Zalo App ID）');
  }
  if (!raw['secretKey'] || typeof raw['secretKey'] !== 'string') {
    errors.push('secretKey: 必须是非空字符串（Zalo Secret Key）');
  }
  if (!raw['accessToken'] || typeof raw['accessToken'] !== 'string') {
    errors.push('accessToken: 必须是非空字符串（Zalo Access Token）');
  }

  return errors;
}
