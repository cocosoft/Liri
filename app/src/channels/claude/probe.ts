/**
 * Claude 健康探针模块
 * 对标 IRC probe.ts 模式
 */

export interface ProbeResult {
  healthy: boolean;
  status: string;
  timestamp: number;
  detail?: {
    connected: boolean;
    hasApiKey: boolean;
    uptimeMs?: number;
  };
}

export function claudeProbe(
  connected: boolean,
  hasApiKey: boolean,
  uptimeMs?: number
): ProbeResult {
  const healthy = connected && hasApiKey;
  return {
    healthy,
    status: healthy ? 'healthy' : 'unhealthy',
    timestamp: Date.now(),
    detail: { connected, hasApiKey, uptimeMs },
  };
}
