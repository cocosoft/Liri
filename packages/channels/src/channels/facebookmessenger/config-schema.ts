/**
 * Facebook Messenger 通道配置模式定义
 * 对标 IRC config-schema.ts 模式
 */

export interface FacebookMessengerConfig {
  pageAccessToken: string;
  verifyToken: string;
  appSecret: string;
  pageId: string;
}

const DEFAULTS: Partial<FacebookMessengerConfig> = {};

export function getDefaultFacebookMessengerConfig(): FacebookMessengerConfig {
  return {
    pageAccessToken: '',
    verifyToken: '',
    appSecret: '',
    pageId: '',
  };
}

export function validateFacebookMessengerConfig(
  raw: Record<string, unknown>
): string[] {
  const errors: string[] = [];

  if (!raw['pageAccessToken'] || typeof raw['pageAccessToken'] !== 'string') {
    errors.push(
      'pageAccessToken: 必须是非空字符串（Facebook Page Access Token）'
    );
  }
  if (!raw['verifyToken'] || typeof raw['verifyToken'] !== 'string') {
    errors.push('verifyToken: 必须是非空字符串（Webhook Verify Token）');
  }
  if (raw['appSecret'] !== undefined && typeof raw['appSecret'] !== 'string') {
    errors.push('appSecret: 必须是一个字符串');
  }
  if (raw['pageId'] !== undefined && typeof raw['pageId'] !== 'string') {
    errors.push('pageId: 必须是一个字符串');
  }

  return errors;
}
