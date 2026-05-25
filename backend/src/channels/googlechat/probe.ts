/**
 * Google Chat 健康探针模块
 * 对标 OpenClaw extensions/googlechat/src/probe.ts
 */

export interface ProbeResult {
  healthy: boolean;
  status: string;
  timestamp: number;
  detail?: {
    connected: boolean;
    hasToken: boolean;
  };
}

export function googleChatProbe(
  connected: boolean,
  hasToken: boolean
): ProbeResult {
  return {
    healthy: connected && hasToken,
    status:
      !connected ? 'disconnected' : hasToken ? 'healthy' : 'no_token',
    timestamp: Date.now(),
    detail: { connected, hasToken },
  };
}
