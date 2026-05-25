/**
 * Nostr 健康探针模块
 * 对标 IRC probe.ts 模式
 */

export interface ProbeResult {
  healthy: boolean;
  status: string;
  timestamp: number;
  detail?: {
    connected: boolean;
    hasPrivateKey: boolean;
    uptimeMs?: number;
  };
}

export function nostrProbe(
  connected: boolean,
  hasPrivateKey: boolean,
  uptimeMs?: number
): ProbeResult {
  const healthy = connected && hasPrivateKey;
  return {
    healthy,
    status: healthy ? 'healthy' : 'unhealthy',
    timestamp: Date.now(),
    detail: { connected, hasPrivateKey, uptimeMs },
  };
}
