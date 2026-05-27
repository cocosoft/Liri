/**
 * IRC 健康探针模块
 * 对标 OpenClaw extensions/irc/src/probe.ts
 */

export interface ProbeResult {
  healthy: boolean;
  status: string;
  timestamp: number;
  detail?: {
    connected: boolean;
    server: string;
    uptimeMs?: number;
  };
}

export function ircProbe(
  connected: boolean,
  server: string,
  uptimeMs?: number
): ProbeResult {
  return {
    healthy: connected,
    status: connected ? 'healthy' : 'unhealthy',
    timestamp: Date.now(),
    detail: { connected, server, uptimeMs },
  };
}
