/**
 * 元宝通道配置模式定义
 * 对标 IRC config-schema.ts 模式
 */

export interface YuanbaoConfig {
  apiKey: string;
  apiUrl: string;
}

const DEFAULTS: Partial<YuanbaoConfig> = {};

export function getDefaultYuanbaoConfig(): YuanbaoConfig {
  return {
    apiKey: '',
    apiUrl: '',
  };
}

export function validateYuanbaoConfig(raw: Record<string, unknown>): string[] {
  const errors: string[] = [];

  if (!raw['apiKey'] || typeof raw['apiKey'] !== 'string') {
    errors.push('apiKey: 必须是非空字符串（元宝 API Key）');
  }
  if (raw['apiUrl'] !== undefined && typeof raw['apiUrl'] !== 'string') {
    errors.push('apiUrl: 必须是字符串');
  }

  return errors;
}
