/**
 * LINE 通道配置模式定义
 * 对标 OpenClaw extensions/line/src/config-schema.ts
 */

export interface LineConfig {
  channelSecret: string;
  channelAccessToken: string;
  webhookPort?: number;
  apiBase?: string;
}

const DEFAULTS: Partial<LineConfig> = {
  webhookPort: 8086,
  apiBase: 'https://api.line.me/v2/bot',
};

export function getDefaultLineConfig(): LineConfig {
  return {
    channelSecret: '',
    channelAccessToken: '',
    webhookPort: DEFAULTS.webhookPort,
    apiBase: DEFAULTS.apiBase,
  };
}

export function validateLineConfig(raw: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (!raw['channelSecret'] || typeof raw['channelSecret'] !== 'string') {
    errors.push('channelSecret: 必须是一个非空字符串');
  }
  if (
    !raw['channelAccessToken'] ||
    typeof raw['channelAccessToken'] !== 'string'
  ) {
    errors.push('channelAccessToken: 必须是一个非空字符串');
  }
  if (raw['webhookPort'] !== undefined) {
    const p = Number(raw['webhookPort']);
    if (!Number.isInteger(p) || p < 1024 || p > 65535) {
      errors.push('webhookPort: 必须在 1024-65535 范围内');
    }
  }
  return errors;
}
