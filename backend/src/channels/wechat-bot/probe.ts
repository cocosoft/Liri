/**
 * 微信机器人健康探针模块
 * 对标 IRC probe.ts 模式
 */

export interface ProbeResult {
  healthy: boolean;
  status: string;
  timestamp: number;
  detail?: {
    connected: boolean;
    hasWebhookUrl: boolean;
    uptimeMs?: number;
  };
}

export function wechatBotProbe(
  connected: boolean,
  hasWebhookUrl: boolean,
  uptimeMs?: number
): ProbeResult {
  const healthy = connected && hasWebhookUrl;
  return {
    healthy,
    status: healthy ? 'healthy' : 'unhealthy',
    timestamp: Date.now(),
    detail: { connected, hasWebhookUrl, uptimeMs },
  };
}
