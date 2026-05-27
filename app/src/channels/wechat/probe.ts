/**
 * 微信健康探针模块
 * 对标 IRC probe.ts 模式
 */

export interface ProbeResult {
  healthy: boolean;
  status: string;
  timestamp: number;
  detail?: {
    connected: boolean;
    hasAppId: boolean;
    uptimeMs?: number;
  };
}

export function wechatProbe(
  connected: boolean,
  hasAppId: boolean,
  uptimeMs?: number
): ProbeResult {
  const healthy = connected && hasAppId;
  return {
    healthy,
    status: healthy ? 'healthy' : 'unhealthy',
    timestamp: Date.now(),
    detail: { connected, hasAppId, uptimeMs },
  };
}
