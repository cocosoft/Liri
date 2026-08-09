import { ACP_SESSION_ID_PREFIX } from '../types.js';
import type { SessionId } from '../types.js';

// ============ 会话标识符（原 acp/conversation-id.ts 已归集于此） ============

export interface AcpSessionIdentity {
  sessionKey: string;
  backend: string;
  runtimeSessionName: string;
  cwd?: string;
}

export function formatSessionIdentity(input: AcpSessionIdentity): string {
  const parts = [input.backend, input.runtimeSessionName, input.sessionKey];
  return parts.join('/');
}

let counter = 0;

export function generateSessionId(): SessionId {
  counter++;
  return `${ACP_SESSION_ID_PREFIX}${Date.now()}-${counter}` as SessionId;
}

export function isValidSessionId(id: string): id is SessionId {
  return id.startsWith(ACP_SESSION_ID_PREFIX);
}
