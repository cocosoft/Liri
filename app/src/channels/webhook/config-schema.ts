/**
 * Webhook 通道配置模式定义
 * 对标 IRC config-schema.ts 模式
 */

export interface WebhookConfig {
  port: number;
  path: string;
  secret: string;
}

const DEFAULTS: Partial<WebhookConfig> = {
  port: 9000,
  path: '/webhook',
};

export function getDefaultWebhookConfig(): WebhookConfig {
  return {
    port: DEFAULTS.port!,
    path: DEFAULTS.path!,
    secret: '',
  };
}

export function validateWebhookConfig(raw: Record<string, unknown>): string[] {
  const errors: string[] = [];

  if (!raw['secret'] || typeof raw['secret'] !== 'string') {
    errors.push('secret: 必须是非空字符串（Webhook 签名密钥）');
  }
  if (raw['port'] !== undefined) {
    const p = Number(raw['port']);
    if (!Number.isInteger(p) || p < 1024 || p > 65535) {
      errors.push('port: 必须在 1024-65535 范围内');
    }
  }
  if (raw['path'] !== undefined && typeof raw['path'] !== 'string') {
    errors.push('path: 必须是字符串');
  }

  return errors;
}
