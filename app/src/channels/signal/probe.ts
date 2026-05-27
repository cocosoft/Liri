/**
 * Signal 健康探针模块
 * 对标 IRC probe.ts 模式
 */

export interface ProbeResult {
  healthy: boolean;
  status: string;
  timestamp: number;
  detail?: {
    connected: boolean;
    hasPhoneNumber: boolean;
    uptimeMs?: number;
  };
}

export function signalProbe(
  connected: boolean,
  hasPhoneNumber: boolean,
  uptimeMs?: number
): ProbeResult {
  const healthy = connected && hasPhoneNumber;
  return {
    healthy,
    status: healthy ? 'healthy' : 'unhealthy',
    timestamp: Date.now(),
    detail: { connected, hasPhoneNumber, uptimeMs },
  };
}
