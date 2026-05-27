/**
 * WhatsApp 通道配置模式定义
 * 对标 IRC config-schema.ts 模式
 */

export interface WhatsAppConfig {
  phoneNumberId: string;
  accessToken: string;
  webhookVerifyToken: string;
  apiVersion: string;
}

const DEFAULTS: Partial<WhatsAppConfig> = {
  apiVersion: 'v21.0',
};

export function getDefaultWhatsAppConfig(): WhatsAppConfig {
  return {
    phoneNumberId: '',
    accessToken: '',
    webhookVerifyToken: '',
    apiVersion: DEFAULTS.apiVersion!,
  };
}

export function validateWhatsAppConfig(raw: Record<string, unknown>): string[] {
  const errors: string[] = [];

  if (!raw['phoneNumberId'] || typeof raw['phoneNumberId'] !== 'string') {
    errors.push('phoneNumberId: 必须是非空字符串（WhatsApp Phone Number ID）');
  }
  if (!raw['accessToken'] || typeof raw['accessToken'] !== 'string') {
    errors.push('accessToken: 必须是非空字符串（WhatsApp Access Token）');
  }

  return errors;
}
