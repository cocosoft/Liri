/**
 * Nostr 通道配置模式定义
 * 对标 IRC config-schema.ts 模式
 */

export interface NostrConfig {
  relays: string[];
  privateKey?: string;
  publicKey: string;
}

const DEFAULTS: Partial<NostrConfig> = {
  relays: ['wss://relay.damus.io'],
};

export function getDefaultNostrConfig(): NostrConfig {
  return {
    relays: DEFAULTS.relays!,
    privateKey: '',
    publicKey: '',
  };
}

export function validateNostrConfig(raw: Record<string, unknown>): string[] {
  const errors: string[] = [];

  if (raw['relays'] !== undefined) {
    if (!Array.isArray(raw['relays'])) {
      errors.push('relays: 必须是数组');
    } else if ((raw['relays'] as string[]).length === 0) {
      errors.push('relays: 至少需要指定一个 Relay 地址');
    }
  }

  return errors;
}
