import type { SessionId, AcpSession } from './types.js';
import type { AcpSessionIdentity } from './runtime/session-identity.js';

export interface MappedSessionInfo {
  internalSessionId: SessionId;
  sessionKey: string;
  cwd: string;
  createdAt: number;
  lastActivityAt: number;
  active: boolean;
}

export function mapSessionToInfo(session: AcpSession): MappedSessionInfo {
  return {
    internalSessionId: session.sessionId,
    sessionKey: session.sessionKey,
    cwd: session.cwd,
    createdAt: session.createdAt,
    lastActivityAt: session.lastTouchedAt,
    active: session.activeRunId !== null,
  };
}

export function mapSessionIdentityToSessionKey(identity: AcpSessionIdentity): string {
  return identity.sessionKey;
}
