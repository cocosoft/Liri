/**
 * WhatsApp 健康探针模块
 * 对标 IRC probe.ts 模式
 */

export interface ProbeResult {
  healthy: boolean;
  status: string;
  timestamp: number;
  detail?: {
    connected: boolean;
    hasPhoneNumberId: boolean;
    uptimeMs?: number;
  };
}

export function whatsappProbe(
  connected: boolean,
  hasPhoneNumberId: boolean,
  uptimeMs?: number
): ProbeResult {
  const healthy = connected && hasPhoneNumberId;
  return {
    healthy,
    status: healthy ? 'healthy' : 'unhealthy',
    timestamp: Date.now(),
    detail: { connected, hasPhoneNumberId, uptimeMs },
  };
}
