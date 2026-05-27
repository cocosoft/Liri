import { EventEmitter } from 'events';
import {
  AcpMessage,
  AcpSessionInfo,
  AcpSessionStatus,
  AcpAgentInfo,
} from './types.js';

interface SessionEventMap {
  'session:created': [session: AcpSessionInfo];
  'session:ended': [sessionId: string];
  'session:timeout': [sessionId: string];
  message: [message: AcpMessage, session: AcpSessionInfo];
  error: [error: Error];
}

let _sessionIdCounter = 0;
function nextSessionId(): string {
  _sessionIdCounter++;
  return `acp-sess-${Date.now()}-${_sessionIdCounter}`;
}

export class AcpSessionManager extends EventEmitter {
  private sessions: Map<string, AcpSessionInfo> = new Map();
  private sessionMessages: Map<string, AcpMessage[]> = new Map();
  private sessionAgents: Map<string, Map<string, AcpAgentInfo>> = new Map();
  private timeoutTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private maxSessions: number;
  private sessionTimeoutMs: number;

  constructor(maxSessions: number = 100, sessionTimeoutMs: number = 3600000) {
    super();
    this.maxSessions = maxSessions;
    this.sessionTimeoutMs = sessionTimeoutMs;
  }

  createSession(
    agents: string[],
    metadata?: Record<string, unknown>
  ): AcpSessionInfo {
    if (this.sessions.size >= this.maxSessions) {
      const oldest = Array.from(this.sessions.values()).sort(
        (a, b) => a.createdAt - b.createdAt
      )[0];

      if (oldest) {
        this.endSession(oldest.id);
      }
    }

    const session: AcpSessionInfo = {
      id: nextSessionId(),
      agents,
      status: 'active',
      createdAt: Date.now(),
      messageCount: 0,
      metadata,
    };

    this.sessions.set(session.id, session);
    this.sessionMessages.set(session.id, []);
    this.sessionAgents.set(session.id, new Map());
    this.startTimeout(session.id);

    this.emit('session:created', session);

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
    this.cancelTimeout(sessionId);

    this.emit('session:ended', sessionId);

    return true;
  }

  listSessions(status?: AcpSessionStatus): AcpSessionInfo[] {
    const all = Array.from(this.sessions.values());

    if (status) {
      return all.filter((s) => s.status === status);
    }

    return all;
  }

  recordMessage(sessionId: string, message: AcpMessage): boolean {
    const session = this.sessions.get(sessionId);

    if (!session || session.status !== 'active') {
      return false;
    }

    const messages = this.sessionMessages.get(sessionId);

    if (messages) {
      messages.push(message);
    }

    session.messageCount++;
    this.refreshTimeout(sessionId);

    this.emit('message', message, session);

    return true;
  }

  getMessages(sessionId: string, limit?: number): AcpMessage[] {
    const messages = this.sessionMessages.get(sessionId);

    if (!messages) {
      return [];
    }

    if (limit && limit > 0) {
      return messages.slice(-limit);
    }

    return [...messages];
  }

  registerAgent(sessionId: string, agent: AcpAgentInfo): boolean {
    const agents = this.sessionAgents.get(sessionId);

    if (!agents) {
      return false;
    }

    agents.set(agent.id, agent);

    const session = this.sessions.get(sessionId);
    if (session && !session.agents.includes(agent.id)) {
      session.agents.push(agent.id);
    }

    return true;
  }

  getAgents(sessionId: string): AcpAgentInfo[] {
    const agents = this.sessionAgents.get(sessionId);

    if (!agents) {
      return [];
    }

    return Array.from(agents.values());
  }

  clear(): void {
    for (const [id] of this.timeoutTimers) {
      this.cancelTimeout(id);
    }

    this.sessions.clear();
    this.sessionMessages.clear();
    this.sessionAgents.clear();
    this.timeoutTimers.clear();
  }

  getSessionCount(): number {
    return this.sessions.size;
  }

  getActiveSessionCount(): number {
    return Array.from(this.sessions.values()).filter(
      (s) => s.status === 'active'
    ).length;
  }

  private startTimeout(sessionId: string): void {
    const timer = setTimeout(() => {
      const session = this.sessions.get(sessionId);

      if (session && session.status === 'active') {
        session.status = 'timeout' as AcpSessionStatus;
        session.endedAt = Date.now();
        this.timeoutTimers.delete(sessionId);
        this.emit('session:timeout', sessionId);
      }
    }, this.sessionTimeoutMs);

    this.timeoutTimers.set(sessionId, timer);
  }

  private refreshTimeout(sessionId: string): void {
    this.cancelTimeout(sessionId);
    this.startTimeout(sessionId);
  }

  private cancelTimeout(sessionId: string): void {
    const timer = this.timeoutTimers.get(sessionId);

    if (timer) {
      clearTimeout(timer);
      this.timeoutTimers.delete(sessionId);
    }
  }
}

/** @deprecated 使用 AcpSessionManager */
export { AcpSessionManager as AclSessionManager };
