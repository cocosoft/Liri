/**
 * 元宝通道配置模式定义
 * 对标 IRC config-schema.ts 模式
 */

export interface YuanbaoConfig {
  enabled?: boolean;
  appId?: string;
  appKey: string;
  botId?: string;
  apiBaseUrl: string;
  webhookSecret?: string;
  timeout?: number;
}

const DEFAULTS: Partial<YuanbaoConfig> = {};

export function getDefaultYuanbaoConfig(): YuanbaoConfig {
  return {
    enabled: false,
    appId: '',
    appKey: '',
    botId: '',
    apiBaseUrl: 'https://api.yuanbao.tencent.com',
    webhookSecret: '',
    timeout: 10000,
  };
}

export function validateYuanbaoConfig(raw: Record<string, unknown>): string[] {
  const errors: string[] = [];

  if (!raw['appKey'] || typeof raw['appKey'] !== 'string') {
    errors.push('appKey: 必须是非空字符串（元宝 API Key）');
  }
  if (
    raw['apiBaseUrl'] !== undefined &&
    typeof raw['apiBaseUrl'] !== 'string'
  ) {
    errors.push('apiBaseUrl: 必须是字符串');
  }

  return errors;
}
