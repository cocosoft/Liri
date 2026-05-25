/**
 * Discord 通道配置模式定义
 * 对标 OpenClaw extensions/discord/src/config-schema.ts
 */

export interface DiscordConfig {
  botToken: string;
  intents?: number;
  gatewayUrl?: string;
  restBaseUrl?: string;
  reconnectDelayMs?: number;
  maxReconnectAttempts?: number;
}

const DEFAULTS: Partial<DiscordConfig> = {
  intents: 513,  // GUILD_MESSAGES | DIRECT_MESSAGES
  gatewayUrl: 'wss://gateway.discord.gg/?v=10&encoding=json',
  restBaseUrl: 'https://discord.com/api/v10',
  reconnectDelayMs: 5000,
  maxReconnectAttempts: 10,
};

export function getDefaultDiscordConfig(): DiscordConfig {
  return {
    botToken: '',
    intents: DEFAULTS.intents,
    gatewayUrl: DEFAULTS.gatewayUrl,
    restBaseUrl: DEFAULTS.restBaseUrl,
    reconnectDelayMs: DEFAULTS.reconnectDelayMs,
    maxReconnectAttempts: DEFAULTS.maxReconnectAttempts,
  };
}

export function validateDiscordConfig(raw: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (!raw['botToken'] || typeof raw['botToken'] !== 'string') {
    errors.push('botToken: 必须是一个非空字符串');
  }
  if (raw['intents'] !== undefined) {
    const i = Number(raw['intents']);
    if (!Number.isInteger(i) || i < 0) {
      errors.push('intents: 必须是一个非负整数');
    }
  }
  if (raw['reconnectDelayMs'] !== undefined) {
    const d = Number(raw['reconnectDelayMs']);
    if (!Number.isInteger(d) || d < 1000) {
      errors.push('reconnectDelayMs: 必须 >= 1000 毫秒');
    }
  }
  return errors;
}
