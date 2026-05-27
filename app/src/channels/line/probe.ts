/**
 * LINE 健康探针模块
 * 对标 OpenClaw extensions/line/src/probe.ts
 */

export interface ProbeResult {
  healthy: boolean;
  status: string;
  timestamp: number;
  detail?: {
    connected: boolean;
    hasAccessToken: boolean;
    webhookPort?: number;
  };
}

export function lineProbe(
  connected: boolean,
  hasAccessToken: boolean,
  webhookPort?: number
): ProbeResult {
  return {
    healthy: connected && hasAccessToken,
    status: !connected
      ? 'disconnected'
      : hasAccessToken
        ? 'healthy'
        : 'no_token',
    timestamp: Date.now(),
    detail: { connected, hasAccessToken, webhookPort },
  };
}
