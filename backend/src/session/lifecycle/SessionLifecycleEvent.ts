/**
 * SessionLifecycleEvent — 会话生命周期事件类型
 * 对标 OpenClaw SessionLifecycleEvent + session-lifecycle-events.ts
 */

export type SessionEventType =
  | 'session:created'
  | 'session:activated'
  | 'session:paused'
  | 'session:resumed'
  | 'session:reset'
  | 'session:switched'
  | 'session:compacted'
  | 'session:pruned'
  | 'session:archived'
  | 'session:deleted'
  | 'session:expired'
  | 'session:token_threshold'
  | 'session:error';

export interface SessionLifecycleEvent {
  type: SessionEventType;
  sessionKey: string;
  sessionId: string;
  timestamp: number;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export function createSessionLifecycleEvent(
  type: SessionEventType,
  sessionId: string,
  options?: { sessionKey?: string; reason?: string; metadata?: Record<string, unknown> },
): SessionLifecycleEvent {
  return {
    type,
    sessionKey: options?.sessionKey ?? sessionId,
    sessionId,
    timestamp: Date.now(),
    reason: options?.reason,
    metadata: options?.metadata,
  };
}
