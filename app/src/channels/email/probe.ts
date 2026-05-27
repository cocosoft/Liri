/**
 * 邮件健康探针模块
 * 对标 OpenClaw extensions/irc/src/probe.ts
 */

export interface ProbeResult {
  healthy: boolean;
  status: string;
  timestamp: number;
  detail?: {
    connected: boolean;
    host: string;
    port: number;
    uptimeMs?: number;
  };
}

export function emailProbe(
  connected: boolean,
  host: string,
  port: number,
  uptimeMs?: number
): ProbeResult {
  return {
    healthy: connected,
    status: connected ? 'healthy' : 'unhealthy',
    timestamp: Date.now(),
    detail: { connected, host, port, uptimeMs },
  };
}
