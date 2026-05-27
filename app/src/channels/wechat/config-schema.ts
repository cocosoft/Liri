/**
 * 微信公众号通道配置模式定义
 * 对标 IRC config-schema.ts 模式
 */

export interface WechatConfig {
  appId: string;
  appSecret: string;
  token: string;
  encodingAESKey?: string;
}

const DEFAULTS: Partial<WechatConfig> = {};

export function getDefaultWechatConfig(): WechatConfig {
  return {
    appId: '',
    appSecret: '',
    token: '',
  };
}

export function validateWechatConfig(raw: Record<string, unknown>): string[] {
  const errors: string[] = [];

  if (!raw['appId'] || typeof raw['appId'] !== 'string') {
    errors.push('appId: 必须是非空字符串（微信公众号 AppID）');
  }
  if (!raw['appSecret'] || typeof raw['appSecret'] !== 'string') {
    errors.push('appSecret: 必须是非空字符串（微信公众号 AppSecret）');
  }
  if (!raw['token'] || typeof raw['token'] !== 'string') {
    errors.push('token: 必须是非空字符串（微信公众号 Token）');
  }

  return errors;
}
