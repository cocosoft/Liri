import { ACP_SESSION_ID_PREFIX } from './types.js';
import type { SessionId } from './types.js';

let counter = 0;

export function generateSessionId(): SessionId {
  counter++;
  return `${ACP_SESSION_ID_PREFIX}${Date.now()}-${counter}` as SessionId;
}

export function isValidSessionId(id: string): id is SessionId {
  return id.startsWith(ACP_SESSION_ID_PREFIX);
}
