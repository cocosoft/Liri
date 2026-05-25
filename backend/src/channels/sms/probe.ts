/**
 * SMS 健康探针模块
 * 对标 IRC probe.ts 模式
 */

export interface ProbeResult {
  healthy: boolean;
  status: string;
  timestamp: number;
  detail?: {
    connected: boolean;
    hasAccountSid: boolean;
    uptimeMs?: number;
  };
}

export function smsProbe(
  connected: boolean,
  hasAccountSid: boolean,
  uptimeMs?: number
): ProbeResult {
  const healthy = connected && hasAccountSid;
  return {
    healthy,
    status: healthy ? 'healthy' : 'unhealthy',
    timestamp: Date.now(),
    detail: { connected, hasAccountSid, uptimeMs },
  };
}
