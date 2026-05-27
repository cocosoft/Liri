/**
 * 钉钉健康探针模块
 * 对标 IRC probe.ts 模式
 */

export interface ProbeResult {
  healthy: boolean;
  status: string;
  timestamp: number;
  detail?: {
    connected: boolean;
    hasAccessToken: boolean;
    uptimeMs?: number;
  };
}

export function dingTalkProbe(
  connected: boolean,
  hasAccessToken: boolean,
  uptimeMs?: number
): ProbeResult {
  const healthy = connected && hasAccessToken;
  return {
    healthy,
    status: healthy ? 'healthy' : 'unhealthy',
    timestamp: Date.now(),
    detail: { connected, hasAccessToken, uptimeMs },
  };
}
