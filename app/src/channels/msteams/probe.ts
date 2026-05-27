/**
 * Microsoft Teams 健康探针模块
 * 对标 OpenClaw extensions/msteams/src/probe.ts
 */

export interface ProbeResult {
  healthy: boolean;
  status: string;
  timestamp: number;
  detail?: {
    connected: boolean;
    hasToken: boolean;
    botEndpoint?: string;
  };
}

export function msteamsProbe(
  connected: boolean,
  hasToken: boolean,
  botEndpoint?: string
): ProbeResult {
  return {
    healthy: connected && hasToken,
    status: !connected ? 'disconnected' : hasToken ? 'healthy' : 'no_token',
    timestamp: Date.now(),
    detail: { connected, hasToken, botEndpoint },
  };
}
