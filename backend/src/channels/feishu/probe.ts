/**
 * 飞书健康探针模块
 * 对标 OpenClaw extensions/feishu/src/probe.ts
 */

export interface ProbeResult {
  healthy: boolean;
  status: string;
  timestamp: number;
  detail?: {
    connected: boolean;
    hasToken: boolean;
    tokenExpiresAt?: number;
  };
}

export function feishuProbe(
  connected: boolean,
  hasToken: boolean,
  tokenExpiresAt?: number
): ProbeResult {
  const tokenOk = hasToken && (!tokenExpiresAt || tokenExpiresAt > Date.now());

  return {
    healthy: connected && tokenOk,
    status:
      !connected ? 'disconnected' : tokenOk ? 'healthy' : 'token_expired',
    timestamp: Date.now(),
    detail: { connected, hasToken, tokenExpiresAt },
  };
}
