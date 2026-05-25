/**
 * Webhook 健康探针模块
 * 对标 IRC probe.ts 模式
 */

export interface ProbeResult {
  healthy: boolean;
  status: string;
  timestamp: number;
  detail?: {
    connected: boolean;
    hasSecret: boolean;
    uptimeMs?: number;
  };
}

export function webhookProbe(
  connected: boolean,
  hasSecret: boolean,
  uptimeMs?: number
): ProbeResult {
  const healthy = connected && hasSecret;
  return {
    healthy,
    status: healthy ? 'healthy' : 'unhealthy',
    timestamp: Date.now(),
    detail: { connected, hasSecret, uptimeMs },
  };
}
