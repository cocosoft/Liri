/**
 * 企业微信健康探针模块
 * 对标 IRC probe.ts 模式
 */

export interface ProbeResult {
  healthy: boolean;
  status: string;
  timestamp: number;
  detail?: {
    connected: boolean;
    hasCorpId: boolean;
    uptimeMs?: number;
  };
}

export function wecomProbe(
  connected: boolean,
  hasCorpId: boolean,
  uptimeMs?: number
): ProbeResult {
  const healthy = connected && hasCorpId;
  return {
    healthy,
    status: healthy ? 'healthy' : 'unhealthy',
    timestamp: Date.now(),
    detail: { connected, hasCorpId, uptimeMs },
  };
}
