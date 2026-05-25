/**
 * Telegram 通道配置模式定义
 * 对标 IRC config-schema.ts 模式
 */

export interface TelegramConfig {
  botToken: string;
  webhookUrl: string;
  webhookPort: number;
  pollingIntervalMs: number;
}

const DEFAULTS: Partial<TelegramConfig> = {
  webhookPort: 8443,
  pollingIntervalMs: 300,
};

export function getDefaultTelegramConfig(): TelegramConfig {
  return {
    botToken: '',
    webhookUrl: '',
    webhookPort: DEFAULTS.webhookPort!,
    pollingIntervalMs: DEFAULTS.pollingIntervalMs!,
  };
}

export function validateTelegramConfig(raw: Record<string, unknown>): string[] {
  const errors: string[] = [];

  if (!raw['botToken'] || typeof raw['botToken'] !== 'string') {
    errors.push('botToken: 必须是非空字符串（Telegram Bot Token）');
  }
  if (raw['webhookPort'] !== undefined) {
    const p = Number(raw['webhookPort']);
    if (!Number.isInteger(p) || p < 1024 || p > 65535) {
      errors.push('webhookPort: 必须在 1024-65535 范围内');
    }
  }
  if (raw['pollingIntervalMs'] !== undefined) {
    const n = Number(raw['pollingIntervalMs']);
    if (!Number.isInteger(n) || n < 100) {
      errors.push('pollingIntervalMs: 必须 >= 100ms');
    }
  }

  return errors;
}
