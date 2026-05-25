/**
 * Slack 通道配置模式定义
 * 对标 IRC config-schema.ts 模式
 */

export interface SlackConfig {
  botToken: string;
  appToken: string;
  signingSecret: string;
  channels: string[];
}

const DEFAULTS: Partial<SlackConfig> = {
  channels: [],
};

export function getDefaultSlackConfig(): SlackConfig {
  return {
    botToken: '',
    appToken: '',
    signingSecret: '',
    channels: DEFAULTS.channels!,
  };
}

export function validateSlackConfig(raw: Record<string, unknown>): string[] {
  const errors: string[] = [];

  if (!raw['botToken'] || typeof raw['botToken'] !== 'string') {
    errors.push('botToken: 必须是非空字符串（Slack Bot Token）');
  }
  if (raw['appToken'] !== undefined && typeof raw['appToken'] !== 'string') {
    errors.push('appToken: 必须是一个字符串');
  }
  if (raw['channels'] !== undefined && !Array.isArray(raw['channels'])) {
    errors.push('channels: 必须是数组');
  }

  return errors;
}
