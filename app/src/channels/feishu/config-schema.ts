/**
 * 飞书通道配置模式定义
 * 对标 OpenClaw extensions/feishu/src/config-schema.ts
 */

export interface FeishuConfig {
  appId: string;
  appSecret: string;
  verifyToken?: string;
  webhookPort?: number;
  useWebSocket?: boolean;
  wsReconnectDelayMs?: number;
  wsMaxReconnectAttempts?: number;
  wsPingIntervalS?: number;
  apiBase?: string;
}

const DEFAULTS: Partial<FeishuConfig> = {
  webhookPort: 8083,
  useWebSocket: false,
  wsReconnectDelayMs: 5000,
  wsMaxReconnectAttempts: 10,
  wsPingIntervalS: 30,
  apiBase: 'https://open.feishu.cn/open-apis',
};

export function getDefaultFeishuConfig(): FeishuConfig {
  return {
    appId: '',
    appSecret: '',
    verifyToken: '',
    webhookPort: DEFAULTS.webhookPort,
    useWebSocket: DEFAULTS.useWebSocket,
    wsReconnectDelayMs: DEFAULTS.wsReconnectDelayMs,
    wsMaxReconnectAttempts: DEFAULTS.wsMaxReconnectAttempts,
    wsPingIntervalS: DEFAULTS.wsPingIntervalS,
    apiBase: DEFAULTS.apiBase,
  };
}

export function validateFeishuConfig(raw: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (!raw['appId'] || typeof raw['appId'] !== 'string') {
    errors.push('appId: 必须是一个非空字符串');
  }
  if (!raw['appSecret'] || typeof raw['appSecret'] !== 'string') {
    errors.push('appSecret: 必须是一个非空字符串');
  }
  if (raw['webhookPort'] !== undefined) {
    const p = Number(raw['webhookPort']);
    if (!Number.isInteger(p) || p < 1024 || p > 65535) {
      errors.push('webhookPort: 必须在 1024-65535 范围内');
    }
  }
  if (raw['wsPingIntervalS'] !== undefined) {
    const s = Number(raw['wsPingIntervalS']);
    if (!Number.isInteger(s) || s < 5 || s > 300) {
      errors.push('wsPingIntervalS: 必须在 5-300 秒范围内');
    }
  }
  return errors;
}
