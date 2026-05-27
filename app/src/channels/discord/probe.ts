/**
 * Discord 健康探针模块
 * 对标 OpenClaw extensions/discord/src/probe.ts
 */

export interface ProbeResult {
  healthy: boolean;
  status: string;
  timestamp: number;
  detail?: {
    connected: boolean;
    gatewayReady: boolean;
    lastHeartbeatAck?: number;
  };
}

export function discordProbe(
  connected: boolean,
  gatewayReady: boolean,
  lastHeartbeatAck?: number | null
): ProbeResult {
  return {
    healthy: connected && gatewayReady,
    status: !connected
      ? 'disconnected'
      : gatewayReady
        ? 'healthy'
        : 'connecting',
    timestamp: Date.now(),
    detail: {
      connected,
      gatewayReady,
      lastHeartbeatAck: lastHeartbeatAck ?? undefined,
    },
  };
}
