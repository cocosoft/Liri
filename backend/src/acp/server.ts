import type { AcpServerOptions, SessionId } from './types.js';
import type { AcpRuntime, AcpRuntimeHandle } from './runtime/types.js';
import type { AcpSessionStore } from './session.js';

export interface AgentSideConnection {
  send(event: string, data: unknown): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
  close(): void;
}

export interface GatewayClient {
  id: string;
  connectedAt: number;
  sessionId?: SessionId;
  connection: AgentSideConnection;
}

export class AcpGateway {
  private clients: Map<string, GatewayClient> = new Map();
  private runtime: AcpRuntime;
  private sessionStore: AcpSessionStore;
  private options: AcpServerOptions;

  constructor(runtime: AcpRuntime, sessionStore: AcpSessionStore, options: AcpServerOptions = {}) {
    this.runtime = runtime;
    this.sessionStore = sessionStore;
    this.options = options;
  }

  getClient(clientId: string): GatewayClient | undefined {
    return this.clients.get(clientId);
  }

  listClients(): GatewayClient[] {
    return Array.from(this.clients.values());
  }

  registerClient(client: GatewayClient): void {
    this.clients.set(client.id, client);
  }

  unregisterClient(clientId: string): boolean {
    return this.clients.delete(clientId);
  }

  getRuntime(): AcpRuntime {
    return this.runtime;
  }

  getSessionStore(): AcpSessionStore {
    return this.sessionStore;
  }

  getOptions(): AcpServerOptions {
    return this.options;
  }
}

export function createAcpGateway(
  runtime: AcpRuntime,
  sessionStore: AcpSessionStore,
  options?: AcpServerOptions
): AcpGateway {
  return new AcpGateway(runtime, sessionStore, options);
}
