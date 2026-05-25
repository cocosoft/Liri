/**
 * 微信机器人通道配置模式定义
 * 对标 IRC config-schema.ts 模式
 */

export interface WechatBotConfig {
  mode: 'ilink' | 'wcf';
  ilinkHost?: string;
  ilinkPort?: number;
  wcfHost?: string;
  wcfPort?: number;
  autoReconnect: boolean;
}

const DEFAULTS: Partial<WechatBotConfig> = {
  ilinkHost: '127.0.0.1',
  ilinkPort: 10086,
  wcfHost: '127.0.0.1',
  wcfPort: 10080,
  autoReconnect: true,
};

export function getDefaultWechatBotConfig(): WechatBotConfig {
  return {
    mode: 'ilink',
    ilinkHost: DEFAULTS.ilinkHost,
    ilinkPort: DEFAULTS.ilinkPort,
    wcfHost: DEFAULTS.wcfHost,
    wcfPort: DEFAULTS.wcfPort,
    autoReconnect: DEFAULTS.autoReconnect!,
  };
}

export function validateWechatBotConfig(
  raw: Record<string, unknown>
): string[] {
  const errors: string[] = [];

  if (raw['mode'] !== undefined && raw['mode'] !== 'ilink' && raw['mode'] !== 'wcf') {
    errors.push('mode: 必须是 "ilink" 或 "wcf"');
  }
  if (raw['ilinkPort'] !== undefined) {
    const p = Number(raw['ilinkPort']);
    if (!Number.isInteger(p) || p < 1 || p > 65535) {
      errors.push('ilinkPort: 必须在 1-65535 范围内');
    }
  }
  if (raw['wcfPort'] !== undefined) {
    const p = Number(raw['wcfPort']);
    if (!Number.isInteger(p) || p < 1 || p > 65535) {
      errors.push('wcfPort: 必须在 1-65535 范围内');
    }
  }

  return errors;
}
