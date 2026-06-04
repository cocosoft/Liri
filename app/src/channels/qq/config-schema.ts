/**
 * QQ Bot 通道配置模式定义
 * 对标 IRC config-schema.ts 模式
 */

export interface QQConfig {
  appId: string;
  clientSecret: string;
}

const DEFAULTS: Partial<QQConfig> = {};

export function getDefaultQQConfig(): QQConfig {
  return {
    appId: '',
    clientSecret: '',
  };
}

export function validateQQConfig(raw: Record<string, unknown>): string[] {
  const errors: string[] = [];

  if (!raw['appId'] || typeof raw['appId'] !== 'string') {
    errors.push('appId: 必须是非空字符串（QQ Bot AppID）');
  }
  if (!raw['clientSecret'] || typeof raw['clientSecret'] !== 'string') {
    errors.push('clientSecret: 必须是非空字符串（QQ Bot ClientSecret）');
  }

  return errors;
}
