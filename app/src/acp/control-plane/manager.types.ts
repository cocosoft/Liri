import type { SessionId, AcpServerOptions } from '../types.js';
import type {
  AcpRuntime,
  AcpRuntimeHandle,
  AcpRuntimeEvent,
  AcpRuntimeStatus,
  AcpRuntimeCapabilities,
} from '../runtime/types.js';
import type { AcpSessionStore } from '../session.js';
import type { GatewayClient } from '../server.js';

export interface AcpSessionManagerConfig {
  runtime: AcpRuntime;
  sessionStore: AcpSessionStore;
  serverOptions: AcpServerOptions;
}

export interface AcpSessionManagerState {
  sessions: Map<SessionId, AcpRuntimeHandle>;
  clients: Map<string, GatewayClient>;
  activeRuns: Map<string, AbortController>;
}

export interface AcpSessionManagerEvents {
  onSessionCreated: (sessionId: SessionId) => void;
  onSessionClosed: (sessionId: SessionId) => void;
  onError: (error: Error) => void;
}
