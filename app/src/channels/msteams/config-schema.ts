/**
 * Microsoft Teams 通道配置模式定义
 * 对标 OpenClaw extensions/msteams/src/config-schema.ts
 */

export interface MSTeamsConfig {
  tenantId: string;
  appId: string;
  appPassword: string;
  botEndpoint?: string;
  webhookPort?: number;
  microsoftLoginBase?: string;
  botFrameworkBase?: string;
}

const DEFAULTS: Partial<MSTeamsConfig> = {
  webhookPort: 8089,
  microsoftLoginBase: 'https://login.microsoftonline.com',
  botFrameworkBase: 'https://smba.trafficmanager.net/amer',
};

export function getDefaultMSTeamsConfig(): MSTeamsConfig {
  return {
    tenantId: '',
    appId: '',
    appPassword: '',
    webhookPort: DEFAULTS.webhookPort,
    microsoftLoginBase: DEFAULTS.microsoftLoginBase,
    botFrameworkBase: DEFAULTS.botFrameworkBase,
  };
}

export function validateMSTeamsConfig(raw: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (!raw['tenantId'] || typeof raw['tenantId'] !== 'string') {
    errors.push('tenantId: 必须是一个非空字符串');
  }
  if (!raw['appId'] || typeof raw['appId'] !== 'string') {
    errors.push('appId: 必须是一个非空字符串');
  }
  if (!raw['appPassword'] || typeof raw['appPassword'] !== 'string') {
    errors.push('appPassword: 必须是一个非空字符串');
  }
  if (raw['webhookPort'] !== undefined) {
    const p = Number(raw['webhookPort']);
    if (!Number.isInteger(p) || p < 1024 || p > 65535) {
      errors.push('webhookPort: 必须在 1024-65535 范围内');
    }
  }
  return errors;
}
