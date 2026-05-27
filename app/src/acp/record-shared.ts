import type { SessionId } from './types.js';

export interface SharedRecord {
  sessionId: SessionId;
  key: string;
  value: string;
  createdAt: number;
}

export function createSharedRecord(
  sessionId: SessionId,
  key: string,
  value: string
): SharedRecord {
  return {
    sessionId,
    key,
    value,
    createdAt: Date.now(),
  };
}
