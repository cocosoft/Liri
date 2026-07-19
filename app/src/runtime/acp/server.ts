import { EventEmitter } from 'events';
import {
  AcpServerConfig,
  AcpMessage,
  AcpHandshake,
  AcpAgentInfo,
  AcpMessageHandler,
  AcpHandlerRegistration,
  AcpMetrics,
  AcpSessionInfo,
  AcpSessionStatus,
} from './types.js';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'runtime:acp:server',
  level: LogLevel.INFO,
});

let _serverIdCounter = 0;
function nextServerId(): string {
  _serverIdCounter++;
  return `srv-${Date.now()}-${_serverIdCounter}`;
}

function matchPattern(pattern: string, type: string): boolean {
  if (pattern === '*') {
    return true;
  }
  if (pattern.endsWith('*')) {
    return type.startsWith(pattern.slice(0, -1));
  }
  return pattern === type;
}

export class AcpTransportServer extends EventEmitter {
  private config: AcpServerConfig;
  private running = false;
  private clients: Map<string, AcpAgentInfo> = new Map();
  private sessions: Map<string, AcpSessionInfo> = new Map();
  private handlers: Map<string, AcpHandlerRegistration> = new Map();
  private startTime = 0;
  private heartbeatTimers: Map<string, ReturnType<typeof setInterval>> =
    new Map();
  private metrics: AcpMetrics = {
    totalMessagesSent: 0,
    totalMessagesReceived: 0,
    activeSessions: 0,
    connectedClients: 0,
    uptimeMs: 0,
    errors: 0,
  };

  constructor(config: AcpServerConfig) {
    super();
    this.config = config;
  }

  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.startTime = Date.now();
    this.emit('started');
  }

  stop(): void {
    if (!this.running) {
      return;
    }

    this.running = false;

    for (const [, timer] of this.heartbeatTimers) {
      clearInterval(timer);
    }
    this.heartbeatTimers.clear();

    this.clients.clear();
    this.emit('stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  handleConnect(agent: AcpAgentInfo, sessionId?: string): AcpMessage {
    this.clients.set(agent.id, agent);
    this.emit('client:connected', agent);
    this.startClientHeartbeat(agent.id);

    if (sessionId) {
      this.ensureSession(sessionId, [this.config.agent.id, agent.id]);
    }

    return {
      id: nextServerId(),
      type: 'handshake_response',
      role: 'response',
      sender: this.config.agent.id,
      target: agent.id,
      sessionId,
      payload: { agent: this.config.agent, timestamp: Date.now() },
      priority: 'high',
      correlationId: undefined,
      timestamp: Date.now(),
    };
  }

  handleDisconnect(agentId: string): void {
    this.clients.delete(agentId);
    this.stopClientHeartbeat(agentId);
    this.emit('client:disconnected', agentId);
  }

  registerHandler(
    pattern: string,
    handler: AcpMessageHandler,
    description?: string
  ): void {
    this.handlers.set(pattern, { pattern, handler, description });
  }

  unregisterHandler(pattern: string): boolean {
    return this.handlers.delete(pattern);
  }

  getHandler(pattern: string): AcpHandlerRegistration | undefined {
    return this.handlers.get(pattern);
  }

  listHandlers(): AcpHandlerRegistration[] {
    return Array.from(this.handlers.values());
  }

  async handleMessage(message: AcpMessage): Promise<AcpMessage | void> {
    if (!this.running) {
      return;
    }

    this.metrics.totalMessagesReceived++;

    if (message.type === 'handshake') {
      const handshake = message.payload as AcpHandshake;
      return this.handleConnect(handshake.agent, message.sessionId);
    }

    if (message.type === 'bye') {
      this.handleDisconnect(message.sender);
      return;
    }

    if (message.sessionId) {
      this.ensureSession(message.sessionId, [
        this.config.agent.id,
        message.sender,
      ]);
    }

    for (const [, registration] of this.handlers) {
      if (matchPattern(registration.pattern, message.type)) {
        try {
          const result = await registration.handler(message, {
            agent: this.clients.get(message.sender) || {
              id: message.sender,
              name: message.sender,
              version: '0',
              capabilities: [],
              transport: this.config.transport.type,
            },
            sessionId: message.sessionId,
          });

          if (result && message.role === 'request') {
            result.correlationId = message.id;
            this.metrics.totalMessagesSent++;
            return result;
          }

          return result;
        } catch (err) {
          this.metrics.errors++;
          if (message.role === 'request') {
            return {
              id: nextServerId(),
              type: 'error',
              role: 'response' as const,
              sender: this.config.agent.id,
              target: message.sender,
              sessionId: message.sessionId,
              payload: { code: 'HANDLER_ERROR', message: String(err) },
              priority: 'high' as const,
              correlationId: message.id,
              timestamp: Date.now(),
            };
          }
        }
      }
    }

    if (message.role === 'request') {
      return {
        id: nextServerId(),
        type: 'error',
        role: 'response' as const,
        sender: this.config.agent.id,
        target: message.sender,
        sessionId: message.sessionId,
        payload: {
          code: 'NO_HANDLER',
          message: `No handler for: ${message.type}`,
        },
        priority: 'normal' as const,
        correlationId: message.id,
        timestamp: Date.now(),
      };
    }
  }

  getClient(agentId: string): AcpAgentInfo | undefined {
    return this.clients.get(agentId);
  }

  listClients(): AcpAgentInfo[] {
    return Array.from(this.clients.values());
  }

  createSession(agents: string[]): AcpSessionInfo {
    const session: AcpSessionInfo = {
      id: nextServerId(),
      agents,
      status: 'active',
      createdAt: Date.now(),
      messageCount: 0,
    };

    this.sessions.set(session.id, session);
    return session;
  }

  getSession(sessionId: string): AcpSessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  endSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return false;
    }

    session.status = 'ended' as AcpSessionStatus;
    session.endedAt = Date.now();

    return true;
  }

  listSessions(status?: AcpSessionStatus): AcpSessionInfo[] {
    const all = Array.from(this.sessions.values());

    if (status) {
      return all.filter((s) => s.status === status);
    }

    return all;
  }

  getConfig(): AcpServerConfig {
    return { ...this.config };
  }

  getMetrics(): AcpMetrics {
    return {
      ...this.metrics,
      uptimeMs: this.startTime > 0 ? Date.now() - this.startTime : 0,
      activeSessions: Array.from(this.sessions.values()).filter(
        (s) => s.status === 'active'
      ).length,
      connectedClients: this.clients.size,
    };
  }

  private ensureSession(sessionId: string, agents: string[]): void {
    if (!this.sessions.has(sessionId)) {
      const session: AcpSessionInfo = {
        id: sessionId,
        agents,
        status: 'active',
        createdAt: Date.now(),
        messageCount: 0,
      };

      this.sessions.set(sessionId, session);
    }
  }

  private startClientHeartbeat(clientId: string): void {
    const interval = this.config.heartbeatInterval || 30000;

    const timer = setInterval(() => {
      if (!this.clients.has(clientId)) {
        this.stopClientHeartbeat(clientId);
        return;
      }
    }, interval);

    this.heartbeatTimers.set(clientId, timer);
  }

  private stopClientHeartbeat(clientId: string): void {
    const timer = this.heartbeatTimers.get(clientId);

    if (timer) {
      clearInterval(timer);
      this.heartbeatTimers.delete(clientId);
    }
  }
}

/** @deprecated 使用 AcpTransportServer */
export { AcpTransportServer as AclServer };
