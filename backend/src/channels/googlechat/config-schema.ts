/**
 * Google Chat 通道配置模式定义
 * 对标 OpenClaw extensions/googlechat/src/config-schema.ts
 */

export interface GoogleChatConfig {
  serviceAccountEmail: string;
  serviceAccountKey: string;
  spaceId?: string;
  webhookPort?: number;
  scope?: string;
  tokenUrl?: string;
}

const DEFAULTS: Partial<GoogleChatConfig> = {
  webhookPort: 8084,
  scope: 'https://www.googleapis.com/auth/chat.bot',
  tokenUrl: 'https://oauth2.googleapis.com/token',
};

export function getDefaultGoogleChatConfig(): GoogleChatConfig {
  return {
    serviceAccountEmail: '',
    serviceAccountKey: '',
    webhookPort: DEFAULTS.webhookPort,
    scope: DEFAULTS.scope,
    tokenUrl: DEFAULTS.tokenUrl,
  };
}

export function validateGoogleChatConfig(
  raw: Record<string, unknown>
): string[] {
  const errors: string[] = [];
  if (
    !raw['serviceAccountEmail'] ||
    typeof raw['serviceAccountEmail'] !== 'string'
  ) {
    errors.push('serviceAccountEmail: 必须是一个非空字符串');
  }
  if (
    !raw['serviceAccountKey'] ||
    typeof raw['serviceAccountKey'] !== 'string'
  ) {
    errors.push('serviceAccountKey: 必须是一个非空字符串');
  }
  if (raw['webhookPort'] !== undefined) {
    const p = Number(raw['webhookPort']);
    if (!Number.isInteger(p) || p < 1024 || p > 65535) {
      errors.push('webhookPort: 必须在 1024-65535 范围内');
    }
  }
  return errors;
}
