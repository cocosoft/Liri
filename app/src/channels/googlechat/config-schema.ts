/**
 * Google Chat 通道配置模式定义
 * 对标 OpenClaw extensions/googlechat/src/config-schema.ts
 */

export interface GoogleChatConfig {
  clientEmail: string;
  privateKey: string;
  spaceIds?: string[];
  webhookPort?: number;
  scope?: string;
  tokenUrl?: string;
}

const DEFAULTS: Partial<GoogleChatConfig> = {
  webhookPort: 8088,
  scope: 'https://www.googleapis.com/auth/chat.bot',
  tokenUrl: 'https://oauth2.googleapis.com/token',
};

export function getDefaultGoogleChatConfig(): GoogleChatConfig {
  return {
    clientEmail: '',
    privateKey: '',
    spaceIds: [],
    webhookPort: DEFAULTS.webhookPort,
    scope: DEFAULTS.scope,
    tokenUrl: DEFAULTS.tokenUrl,
  };
}

export function validateGoogleChatConfig(
  raw: Record<string, unknown>
): string[] {
  const errors: string[] = [];
  if (!raw['clientEmail'] || typeof raw['clientEmail'] !== 'string') {
    errors.push('clientEmail: 必须是一个非空字符串');
  }
  if (!raw['privateKey'] || typeof raw['privateKey'] !== 'string') {
    errors.push('privateKey: 必须是一个非空字符串');
  }
  if (raw['webhookPort'] !== undefined) {
    const p = Number(raw['webhookPort']);
    if (!Number.isInteger(p) || p < 1024 || p > 65535) {
      errors.push('webhookPort: 必须在 1024-65535 范围内');
    }
  }
  return errors;
}
