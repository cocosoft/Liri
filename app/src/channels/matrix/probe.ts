/**
 * Matrix 健康探针模块
 * 对标 OpenClaw extensions/matrix/src/probe.ts
 */

export interface ProbeResult {
  healthy: boolean;
  status: string;
  timestamp: number;
  detail?: {
    connected: boolean;
    homeserverUrl: string;
    lastSyncAt?: number;
  };
}

export function matrixProbe(
  connected: boolean,
  homeserverUrl: string,
  lastSyncAt?: number | null
): ProbeResult {
  return {
    healthy: connected && !!lastSyncAt,
    status: connected ? (lastSyncAt ? 'healthy' : 'syncing') : 'unhealthy',
    timestamp: Date.now(),
    detail: {
      connected,
      homeserverUrl,
      lastSyncAt: lastSyncAt ?? undefined,
    },
  };
}
