/**
 * Webhook 通道配置模式定义
 * 对标 IRC config-schema.ts 模式
 */

export interface WebhookConfig {
  listenPort: number;
  listenHost: string;
  path: string;
  endpoints: string[];
  secret: string;
}

const DEFAULTS: Partial<WebhookConfig> = {
  listenPort: 9100,
  listenHost: '0.0.0.0',
  path: '/webhook',
};

export function getDefaultWebhookConfig(): WebhookConfig {
  return {
    listenPort: DEFAULTS.listenPort!,
    listenHost: DEFAULTS.listenHost!,
    path: DEFAULTS.path!,
    endpoints: [],
    secret: '',
  };
}

export function validateWebhookConfig(raw: Record<string, unknown>): string[] {
  const errors: string[] = [];

  if (raw['secret'] !== undefined && typeof raw['secret'] !== 'string') {
    errors.push('secret: 必须是字符串');
  }
  if (raw['listenPort'] !== undefined) {
    const p = Number(raw['listenPort']);
    if (!Number.isInteger(p) || p < 1024 || p > 65535) {
      errors.push('listenPort: 必须在 1024-65535 范围内');
    }
  }
  if (raw['path'] !== undefined && typeof raw['path'] !== 'string') {
    errors.push('path: 必须是字符串');
  }

  return errors;
}
