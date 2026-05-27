/**
 * 钉钉通道配置模式定义
 * 对标 OpenClaw extensions/irc/src/config-schema.ts
 */

export interface DingTalkConfig {
  appKey: string;
  appSecret: string;
  webhookUrl: string;
  webhookPort: number;
  agentId?: string;
}

const DEFAULTS: Partial<DingTalkConfig> = {
  webhookPort: 8084,
};

export function getDefaultDingTalkConfig(): DingTalkConfig {
  return {
    appKey: '',
    appSecret: '',
    webhookUrl: '',
    webhookPort: DEFAULTS.webhookPort!,
  };
}

export function validateDingTalkConfig(raw: Record<string, unknown>): string[] {
  const errors: string[] = [];

  if (!raw['appKey'] || typeof raw['appKey'] !== 'string') {
    errors.push('appKey: 必须是非空字符串（钉钉应用 AppKey）');
  }
  if (!raw['appSecret'] || typeof raw['appSecret'] !== 'string') {
    errors.push('appSecret: 必须是非空字符串（钉钉应用 AppSecret）');
  }
  if (raw['webhookPort'] !== undefined) {
    const p = Number(raw['webhookPort']);
    if (!Number.isInteger(p) || p < 1024 || p > 65535) {
      errors.push('webhookPort: 必须在 1024-65535 范围内');
    }
  }

  return errors;
}
